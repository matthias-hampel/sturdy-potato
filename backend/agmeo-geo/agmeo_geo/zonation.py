"""Soil sampling zones from a field raster: the zone delineation of the reference app's soil planner.

Ported from AGVOLUTION/agmeo (``lib/b2b-maps/zonationSmoothed.ts``, ``fcm.ts``,
``segmentation.ts``, ``featurePreservingSmoothing.ts``). Pipeline per field:

1. Values of one raster layer (NDVI/NDRE/NDMI of a clear acquisition, or the multi-year
   productivity map) on the field's 10 m grid, the boundary buffered by two pixels so edge
   cells take part; missing pixels take the layer mean.
2. Pre-classification smoothing: feature-preserving smoothing (edge-aware; removes tramline
   striping) whose strength follows the "coarseness" knob (0..1, default 0.35).
3. Number of zones: manual, or "auto" — fuzzy c-means for k = 2..kMax (kMax by field size)
   scored on fuzziness (FPI), entropy (NCE) and silhouette; the largest k whose silhouette
   stays ≥ 0.55 wins, else the rank-sum winner.
4. Classification by method:
   - ``fcm``      fuzzy c-means (m = 2), defuzzified;
   - ``kmeans``   hard k-means, k-means++ seeding, four deterministic restarts;
   - ``segment``  equal-area (quantile) classes of the values (lvl0 models);
   - ``probe``    fcm, then forced contiguity: every zone one connected area of at least half
                  its equal share of the field, walkable for the sampler;
   - ``probe-v2`` probe with pixel coordinates as extra clustering features (compact,
                  non-interlocking blocks), a boundary-straightening majority flow and edges
                  snapped to 30 m blocks.
5. Cleanup: 3×3 majority filter and merge of patches smaller than the minimum zone size
   (``merge``), or only the diagonal-pinch fix (``fix-kws``). A requested zone count is a
   promise: a class that vanished is restored by splitting the largest patch.
6. Vectorised, simplified as a coverage (probe-v2 keeps the straight pixel edges), clipped to
   the boundary; probe methods fold stray parts into the neighbour with the longest shared
   edge. Zones are numbered by their mean value, zone 1 lowest.

Deviations from the reference: the satellite layers come from agmeo's own field rasters
(no TWI or soil-map sources, no DSM texture enrichment); smoothing of the vectorised edges is
a topology-preserving coverage simplification instead of Chaikin curves.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import shapely
from rasterio.features import shapes
from scipy import ndimage
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import unary_union

METHODS = ("fcm", "kmeans", "segment", "probe", "probe-v2")
CLEANUPS = ("merge", "fix-kws")
DEFAULT_COARSENESS = 0.35
DEFAULT_MIN_ZONE_HA = 0.25
SILHOUETTE_FLOOR = 0.55
PROBE_V2_MAJORITY_PASSES = 20
PROBE_V2_BLOCK_PX = 3
EDGE_BUFFER_PX = 2
FOUR = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)


def k_max_for_area(area_ha: float) -> int:
    """Field-size cap for the automatic zone count."""
    if area_ha < 4:
        return 2
    if area_ha < 8:
        return 3
    if area_ha < 15:
        return 4
    return 5


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------


def default_seed(data: np.ndarray) -> int:
    """Deterministic seed from the data, so repeated runs give the same zones."""
    n = data.shape[1]
    h = (n * 2654435761) & 0xFFFFFFFF
    step = max(1, n // 7)
    for i in range(0, n, step):
        h = ((h ^ math.floor(float(data[0, i]) * 1000)) * 16777619) & 0xFFFFFFFF
    return h


def fuzzy_c_means(
    data: np.ndarray,
    k: int,
    m: float = 2.0,
    max_iter: int = 300,
    epsilon: float = 1e-4,
    seed: int | None = None,
) -> tuple[np.ndarray, np.ndarray, int]:
    """Fuzzy c-means. ``data`` is (layers, pixels); returns membership (k, pixels), centroids, iterations."""
    d, n = data.shape
    rng = np.random.default_rng(default_seed(data) if seed is None else seed)
    u = rng.random((k, n)) + 0.01
    u /= u.sum(axis=0, keepdims=True)
    exp = 2 / (m - 1)
    centroids = np.zeros((k, d))
    it = 0
    for it in range(max_iter):
        w = u**m
        denom = w.sum(axis=1, keepdims=True)
        centroids = (w @ data.T) / np.where(denom > 0, denom, 1)
        dist = np.sqrt(((data.T[None, :, :] - centroids[:, None, :]) ** 2).sum(axis=2))
        zero = dist == 0
        with np.errstate(divide="ignore"):
            inv = np.where(zero, 0, dist ** (-exp))
        new = inv / np.where(inv.sum(axis=0, keepdims=True) > 0, inv.sum(axis=0, keepdims=True), 1)
        on_centroid = zero.any(axis=0)
        if on_centroid.any():
            first = zero.argmax(axis=0)
            new[:, on_centroid] = 0
            new[first[on_centroid], np.nonzero(on_centroid)[0]] = 1
        delta = float(np.abs(new - u).max())
        u = new
        if delta < epsilon:
            break
    return u, centroids, it


def defuzzify(membership: np.ndarray) -> np.ndarray:
    return membership.argmax(axis=0).astype(np.int16)


def fpi(membership: np.ndarray) -> float:
    """Fuzziness performance index, lower = crisper."""
    k, n = membership.shape
    f = float((membership**2).sum()) / n
    return 1 - (k * f - 1) / (k - 1)


def nce(membership: np.ndarray) -> float:
    """Normalised classification entropy, lower = more organised."""
    k, n = membership.shape
    u = membership[membership > 1e-10]
    return float(-(u * np.log(u)).sum()) / (n * math.log(k))


def silhouette(data: np.ndarray, labels: np.ndarray, k: int, max_samples: int = 2000) -> float:
    n = labels.size
    idx = (
        np.floor(np.arange(max_samples) * (n / max_samples)).astype(int) if n > max_samples else np.arange(n)
    )
    x = data[:, idx].T
    lab = labels[idx]
    dist = np.sqrt(((x[:, None, :] - x[None, :, :]) ** 2).sum(axis=2))
    np.fill_diagonal(dist, np.nan)
    total = 0.0
    for i in range(len(idx)):
        own = lab == lab[i]
        own[i] = False
        a = float(np.nanmean(dist[i, own])) if own.any() else 0.0
        b = math.inf
        for c in range(k):
            if c == lab[i]:
                continue
            sel = lab == c
            if sel.any():
                b = min(b, float(np.nanmean(dist[i, sel])))
        if b == math.inf:
            b = 0.0
        denom = max(a, b)
        total += (b - a) / denom if denom > 0 else 0.0
    return total / len(idx)


def select_optimal_k(data: np.ndarray, min_k: int = 2, max_k: int = 8, prefer_more_zones: bool = True) -> int:
    """Automatic zone count from FPI, NCE and silhouette of fuzzy c-means runs."""
    n = data.shape[1]
    max_k = max(min_k, min(max_k, math.floor(math.sqrt(n / 2))))
    metrics = []
    for k in range(min_k, max_k + 1):
        best = None
        base = default_seed(data)
        for run in range(3):
            membership, _, _ = fuzzy_c_means(data, k, seed=(base + run * 0x9E3779B1) & 0xFFFFFFFF)
            score = fpi(membership)
            if best is None or score < best[0]:
                best = (score, nce(membership), membership)
        sil = silhouette(data, defuzzify(best[2]), k)
        metrics.append({"k": k, "fpi": best[0], "nce": best[1], "silhouette": sil})
    rank = {m["k"]: 0 for m in metrics}
    for key, reverse in (("fpi", False), ("nce", False), ("silhouette", True)):
        for i, m in enumerate(sorted(metrics, key=lambda x: x[key], reverse=reverse)):
            rank[m["k"]] += i
    best_k = min(metrics, key=lambda x: (rank[x["k"]], x["k"]))["k"]
    if prefer_more_zones:
        passing = [m["k"] for m in metrics if m["silhouette"] >= SILHOUETTE_FLOOR]
        if passing:
            best_k = max(passing)
    return best_k


def kmeans(
    data: np.ndarray, k: int, max_iter: int = 100, restarts: int = 4, seed: int | None = None
) -> np.ndarray:
    """Hard k-means with k-means++ seeding and deterministic restarts; returns labels."""
    base = default_seed(data) if seed is None else seed
    x = data.T
    n = x.shape[0]
    best_labels, best_inertia = None, math.inf
    for r in range(max(1, restarts)):
        rng = np.random.default_rng((base + r * 0x9E3779B1) & 0xFFFFFFFF)
        centroids = [x[min(n - 1, int(rng.random() * n))]]
        dist2 = np.full(n, np.inf)
        for _ in range(1, k):
            dist2 = np.minimum(dist2, ((x - centroids[-1]) ** 2).sum(axis=1))
            target = rng.random() * dist2.sum()
            pick = int(np.searchsorted(np.cumsum(dist2), target)) if target > 0 else n - 1
            centroids.append(x[min(pick, n - 1)])
        c = np.array(centroids, dtype=float)
        labels = np.full(n, -1)
        for it in range(max_iter):
            new = ((x[:, None, :] - c[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
            if it > 0 and np.array_equal(new, labels):
                break
            labels = new
            for j in range(k):
                sel = labels == j
                c[j] = x[sel].mean(axis=0) if sel.any() else x[min(n - 1, int(rng.random() * n))]
        inertia = float(((x - c[labels]) ** 2).sum())
        if inertia < best_inertia:
            best_inertia, best_labels = inertia, labels
    return best_labels.astype(np.int16)


def segment_equal_number_pixels(values: np.ndarray, k: int) -> np.ndarray:
    """Equal-area (quantile) classes 0..k-1, low to high: rank mapped linearly and rounded."""
    n = values.size
    if n <= 1 or k <= 1:
        return np.zeros(n, dtype=np.int16)
    ranks = np.searchsorted(np.sort(values), values, side="left")
    return np.clip(np.round(ranks * (k - 1) / (n - 1)), 0, k - 1).astype(np.int16)


def z_score(data: np.ndarray) -> np.ndarray:
    mean = data.mean(axis=1, keepdims=True)
    std = data.std(axis=1, keepdims=True)
    return (data - mean) / np.where(std > 0, std, 1)


# ---------------------------------------------------------------------------
# Feature-preserving smoothing (Lindsay et al. 2019, as ported in the reference)
# ---------------------------------------------------------------------------


def fps_options(coarseness: float) -> dict:
    c = min(1.0, max(0.0, coarseness))
    return {
        "max_norm_diff": 15 + c * 20,
        "num_iter": round(3 + c * 9),
        "max_z_diff_sigma": 0.75 + c * 1.75,
        "filter_size": 11,
    }


def _shift(a: np.ndarray, dx: int, dy: int, fill) -> np.ndarray:
    """a[y + dy, x + dx] at every (y, x); outside the grid → fill."""
    out = np.full_like(a, fill)
    h, w = a.shape
    ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
    xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
    out[yd, xd] = a[ys, xs]
    return out


DX_NV = (1, 1, 1, 0, -1, -1, -1, 0)
DY_NV = (-1, 0, 1, 1, 1, 0, -1, -1)


def feature_preserving_smoothing(
    grid: np.ndarray,
    max_norm_diff: float = 15,
    max_z_diff: float = math.inf,
    filter_size: int = 11,
    num_iter: int = 3,
    res: float = 10.0,
) -> np.ndarray:
    """Edge-aware smoothing of one band; NaN = nodata, passed through."""
    ok = np.isfinite(grid)
    threshold = math.cos(math.radians(max_norm_diff))

    def angle(a1, b1, a2, b2):
        return (a1 * a2 + b1 * b2 + 1) / np.sqrt((a1 * a1 + b1 * b1 + 1) * (a2 * a2 + b2 * b2 + 1))

    # 1) surface normals (Horn); out-of-range neighbours take the centre value.
    v = []
    for i in range(8):
        n = _shift(grid, DX_NV[i], DY_NV[i], np.nan)
        inside = _shift(np.ones_like(grid, dtype=bool), DX_NV[i], DY_NV[i], False)
        v.append(np.where(inside, n, grid))
    eight = res * 8
    a = np.where(ok, -(v[2] - v[4] + 2 * (v[1] - v[5]) + v[0] - v[6]) / eight, 0.0)
    b = np.where(ok, -(v[6] - v[4] + 2 * (v[7] - v[3]) + v[0] - v[2]) / eight, 0.0)
    a = np.nan_to_num(a)
    b = np.nan_to_num(b)

    # 2) smooth the normals, weighting neighbours by similarity.
    mid = filter_size // 2
    sw = np.zeros_like(grid)
    sa = np.zeros_like(grid)
    sb = np.zeros_like(grid)
    for dy in range(-mid, mid + 1):
        for dx in range(-mid, mid + 1):
            na = _shift(a, dx, dy, 0.0)
            nb = _shift(b, dx, dy, 0.0)
            nok = _shift(ok, dx, dy, False)
            diff = angle(a, b, na, nb)
            w = np.where(nok & (diff > threshold), (diff - threshold) ** 2, 0.0)
            sw += w
            sa += na * w
            sb += nb * w
    a_s = np.where(sw > 0, sa / np.where(sw > 0, sw, 1), 0.0)
    b_s = np.where(sw > 0, sb / np.where(sw > 0, sw, 1), 0.0)

    # 3) Jacobi updates of the values from the smoothed normals.
    x_off = (-res, -res, -res, 0.0, res, res, res, 0.0)
    y_off = (-res, 0.0, res, res, res, 0.0, -res, -res)
    out = grid.copy()
    for _ in range(num_iter):
        prev = out
        sw = np.zeros_like(grid)
        z = np.zeros_like(grid)
        for n in range(8):
            zn = _shift(prev, DX_NV[n], DY_NV[n], np.nan)
            na = _shift(a_s, DX_NV[n], DY_NV[n], 0.0)
            nb = _shift(b_s, DX_NV[n], DY_NV[n], 0.0)
            diff = angle(a_s, b_s, na, nb)
            use = np.isfinite(zn) & (diff > threshold)
            w = np.where(use, (diff - threshold) ** 2, 0.0)
            sw += w
            z += np.where(use, -(na * x_off[n] + nb * y_off[n] - np.nan_to_num(zn)) * w, 0.0)
        cand = np.where(sw > 0, z / np.where(sw > 0, sw, 1), grid)
        out = np.where(ok & (sw > 0) & (np.abs(cand - grid) <= max_z_diff), cand, grid)
    return out


# ---------------------------------------------------------------------------
# Class-grid cleanup (-1 = outside)
# ---------------------------------------------------------------------------


def majority_filter(classes: np.ndarray, k: int, radius: int = 1) -> np.ndarray:
    """Majority of the (2r+1)² window per valid pixel; ties keep the centre class."""
    size = 2 * radius + 1
    counts = np.stack(
        [
            ndimage.uniform_filter((classes == c).astype(float), size=size, mode="constant") * size * size
            for c in range(k)
        ]
    )
    centre = np.clip(classes, 0, k - 1)
    centre_count = np.take_along_axis(counts, centre[None], axis=0)[0]
    best = counts.argmax(axis=0)
    best_count = counts.max(axis=0)
    out = np.where(best_count > centre_count + 1e-9, best, classes)
    return np.where(classes < 0, -1, out).astype(np.int16)


def _components(classes: np.ndarray, k: int):
    """Connected patches (4-neighbourhood): list of (class, pixel mask)."""
    out = []
    for c in range(k):
        labelled, count = ndimage.label(classes == c, structure=FOUR)
        for i in range(1, count + 1):
            out.append((c, labelled == i))
    return out


def _neighbour_counts(classes: np.ndarray, mask: np.ndarray, k: int) -> np.ndarray:
    ring = ndimage.binary_dilation(mask, structure=FOUR) & ~mask
    vals = classes[ring]
    vals = vals[vals >= 0]
    return np.bincount(vals, minlength=k)[:k] if vals.size else np.zeros(k, dtype=int)


def merge_small_components(classes: np.ndarray, k: int, min_pixels: float) -> None:
    """Patches below min_pixels join the neighbour class they touch most; every class keeps its largest patch."""
    changed = True
    while changed:
        changed = False
        comps = _components(classes, k)
        largest: dict[int, int] = {}
        for i, (c, m) in enumerate(comps):
            if c not in largest or m.sum() > comps[largest[c]][1].sum():
                largest[c] = i
        for i, (c, m) in enumerate(comps):
            if m.sum() >= min_pixels or largest.get(c) == i:
                continue
            if not (classes[m] == c).all():
                continue
            counts = _neighbour_counts(classes, m, k)
            counts[c] = 0
            if counts.max() > 0:
                classes[m] = int(counts.argmax())
                changed = True


def _split_far_half(classes: np.ndarray, source_mask: np.ndarray, target: int) -> int:
    ys, xs = np.nonzero(source_mask)
    if ys.size < 2:
        return 0
    along_x = (xs.max() - xs.min()) >= (ys.max() - ys.min())
    pos = xs if along_x else ys
    order = np.lexsort((ys * classes.shape[1] + xs, pos))
    far = order[ys.size >> 1 :]
    classes[ys[far], xs[far]] = target
    return far.size


def ensure_class_count(classes: np.ndarray, k: int) -> int:
    """Restore every missing class by splitting the largest patch along its longer axis."""
    restored = 0
    while True:
        present = set(np.unique(classes[classes >= 0]).tolist())
        missing = next((c for c in range(k) if c not in present), None)
        if missing is None:
            return restored
        comps = _components(classes, k)
        if not comps:
            return restored
        _, largest = max(comps, key=lambda cm: cm[1].sum())
        if largest.sum() < 2:
            return restored
        _split_far_half(classes, largest, missing)
        restored += 1


def rebalance_min_share(classes: np.ndarray, k: int) -> int:
    """Probe floor: every zone holds at least half its equal share of the field."""
    if k < 2:
        return 0
    valid = int((classes >= 0).sum())
    floor = math.ceil(valid / k / 2)
    if floor < 2:
        return 0
    moved = 0
    for _ in range(k * 2 + 1):
        sizes = np.bincount(classes[classes >= 0], minlength=k)[:k]
        small = [c for c in range(k) if 0 < sizes[c] < floor]
        if not small:
            break
        c = min(small, key=lambda x: sizes[x])
        mask = classes == c
        counts = _neighbour_counts(classes, mask, k)
        counts[c] = 0
        if counts.max() == 0:
            break
        classes[mask] = int(counts.argmax())
        sizes = np.bincount(classes[classes >= 0], minlength=k)[:k]
        others = [x for x in range(k) if x != c]
        largest = max(others, key=lambda x: sizes[x])
        moved += int(mask.sum()) + _split_far_half(classes, classes == largest, c)
        merge_small_components(classes, k, math.inf)
    return moved


def quantize_to_blocks(classes: np.ndarray, k: int, block: int) -> None:
    h, w = classes.shape
    for by in range(0, h, block):
        for bx in range(0, w, block):
            cell = classes[by : by + block, bx : bx + block]
            vals = cell[cell >= 0]
            if vals.size == 0:
                continue
            best = int(np.bincount(vals, minlength=k).argmax())
            cell[cell >= 0] = best


def fix_kws_polygons(classes: np.ndarray) -> None:
    """Remove diagonal corner-only contacts of a class (lvl0 topology fix)."""
    h, w = classes.shape
    for _ in range(1000):
        changed = False
        for r in range(h - 1):
            for c in range(w - 1):
                tl, tr, ll, lr = classes[r, c], classes[r, c + 1], classes[r + 1, c], classes[r + 1, c + 1]
                if tl >= 0 and lr >= 0 and tl == lr and tl != tr and tl != ll:
                    classes[r + 1, c] = lr
                    changed = True
                elif tr >= 0 and ll >= 0 and tr == ll and tr != tl and tr != lr:
                    classes[r, c] = tr
                    changed = True
        if not changed:
            return


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


@dataclass
class ZonationParams:
    method: str = "fcm"
    zone_count: int | None = None  # None = automatic
    min_zone_ha: float = DEFAULT_MIN_ZONE_HA
    coarseness: float = DEFAULT_COARSENESS
    cleanup: str = "merge"


@dataclass
class ZoneResult:
    number: int
    geometry: MultiPolygon  # grid CRS
    area_ha: float
    mean_value: float | None


@dataclass
class ClassResult:
    classes: np.ndarray
    zone_count: int
    values: np.ndarray = field(repr=False)


def classify_grid(
    values: np.ndarray,
    data_mask: np.ndarray,
    interior: np.ndarray,
    params: ZonationParams,
    pixel_area_ha: float = 0.01,
) -> ClassResult:
    """Class grid 0..k-1 (−1 outside the data mask). ``values`` may hold NaN inside the mask."""
    if params.method not in METHODS:
        raise ValueError(f"unknown method {params.method}")
    method = params.method
    known = data_mask & np.isfinite(values)
    if not known.any():
        raise ValueError("no_values")
    filled = np.where(data_mask, np.where(np.isfinite(values), values, np.nanmean(values[known])), np.nan)
    opts = fps_options(params.coarseness)
    std = float(np.nanstd(filled[data_mask])) or 1.0
    smoothed = feature_preserving_smoothing(
        filled, opts["max_norm_diff"], opts["max_z_diff_sigma"] * std, opts["filter_size"], opts["num_iter"]
    )
    rows, cols = np.nonzero(data_mask)
    layer = smoothed[rows, cols]
    data = layer[None, :]
    if method == "probe-v2":
        data = z_score(data)
        weight = 0.75 + 1.75 * params.coarseness
        xs, ys = cols - cols.mean(), rows - rows.mean()
        scale = math.sqrt(float((xs**2 + ys**2).sum()) / (2 * xs.size)) or 1.0
        data = np.vstack([data, xs / scale * weight, ys / scale * weight])

    area_ha = float(interior.sum()) * pixel_area_ha
    if params.zone_count is None:
        k = select_optimal_k(data, 2, max(2, min(k_max_for_area(area_ha), 8)))
    else:
        k = max(1, min(127, int(params.zone_count)))

    classes = np.full(values.shape, -1, dtype=np.int16)
    if k == 1:
        labels = np.zeros(rows.size, dtype=np.int16)
    elif method == "segment":
        labels = segment_equal_number_pixels(data.mean(axis=0), k)
    elif method == "kmeans":
        labels = kmeans(data, k)
    else:
        labels = defuzzify(fuzzy_c_means(data, k, max_iter=80, epsilon=1e-3)[0])
    classes[rows, cols] = labels

    if k > 1:
        if method in ("probe", "probe-v2"):
            classes = majority_filter(classes, k, 1)
            if method == "probe-v2":
                for _ in range(PROBE_V2_MAJORITY_PASSES):
                    nxt = majority_filter(classes, k, 4)
                    if np.array_equal(nxt, classes):
                        break
                    classes = nxt
            classes[~interior] = -1
            merge_small_components(classes, k, math.inf)
            rebalance_min_share(classes, k)
            if method == "probe-v2":
                quantize_to_blocks(classes, k, PROBE_V2_BLOCK_PX)
                merge_small_components(classes, k, math.inf)
        elif params.cleanup == "fix-kws":
            fix_kws_polygons(classes)
        else:
            classes = majority_filter(classes, k, 1)
            min_pixels = max(5, math.ceil(params.min_zone_ha / pixel_area_ha))
            merge_small_components(classes, k, min_pixels)
        ensure_class_count(classes, k)
    return ClassResult(classes=classes, zone_count=k, values=values)


def _fill_nearest(classes: np.ndarray) -> np.ndarray:
    known = classes >= 0
    if known.all() or not known.any():
        return classes
    _, (r, c) = ndimage.distance_transform_edt(~known, return_indices=True)
    return classes[r, c]


def _shared_edge(a, b) -> float:
    inter = a.boundary.intersection(b.boundary)
    return inter.length if not inter.is_empty else 0.0


def single_part(zones: dict[int, MultiPolygon]) -> dict[int, MultiPolygon]:
    """Every part but a zone's largest joins the touching zone with the longest shared edge."""
    zones = dict(zones)
    for _ in range(3):
        moved = False
        for number in list(zones):
            parts = sorted(zones[number].geoms, key=lambda p: -p.area)
            if len(parts) <= 1:
                continue
            keep = [parts[0]]
            for part in parts[1:]:
                if part.area < 1:
                    continue
                best, best_len = None, 0.0
                for other, geom in zones.items():
                    if other == number:
                        continue
                    length = _shared_edge(part, geom)
                    if length > best_len:
                        best, best_len = other, length
                if best is None:
                    keep.append(part)
                    continue
                merged = unary_union([zones[best], part])
                zones[best] = _as_multi(merged)
                moved = True
            zones[number] = MultiPolygon(keep)
        if not moved:
            break
    return zones


def _as_multi(geometry) -> MultiPolygon:
    polygons = [g for g in getattr(geometry, "geoms", [geometry]) if isinstance(g, Polygon) and g.area > 0.5]
    return MultiPolygon(polygons)


def vectorise_classes(
    classes: np.ndarray, transform, boundary, k: int, method: str, resolution: float = 10.0
) -> dict[int, MultiPolygon]:
    """Class polygons in the grid CRS, clipped to the boundary, covering it completely."""
    full = _fill_nearest(classes).astype(np.int32)
    parts: dict[int, list] = {c: [] for c in range(k)}
    for geometry, value in shapes(full, transform=transform):
        if int(value) in parts:
            parts[int(value)].append(shape(geometry))
    numbers = [c for c in range(k) if parts[c]]
    merged = [unary_union(parts[c]) for c in numbers]
    if method != "probe-v2":
        merged = list(shapely.coverage_simplify(merged, tolerance=0.6 * resolution))
    out: dict[int, MultiPolygon] = {}
    for c, geometry in zip(numbers, merged, strict=True):
        clipped = _as_multi(shapely.make_valid(geometry).intersection(boundary))
        if not clipped.is_empty:
            out[c] = clipped
    # Coverage: fold anything of the boundary no zone covers into the zone touching it most.
    covered = unary_union(list(out.values())) if out else None
    if covered is not None:
        gaps = boundary.difference(covered)
        for gap in getattr(gaps, "geoms", [gaps]):
            if gap.is_empty or gap.geom_type != "Polygon" or gap.area < 0.01:
                continue
            best = max(out, key=lambda c: _shared_edge(gap, out[c]) + (1e-9 if gap.intersects(out[c]) else 0))
            out[best] = _as_multi(unary_union([out[best], gap]))
    if method in ("probe", "probe-v2"):
        out = single_part(out)
    return out


def zonate(values: np.ndarray, grid, params: ZonationParams) -> list[ZoneResult]:
    """Zones of one field raster on its field grid (see module docstring)."""
    interior = grid.mask()
    buffered = grid.mask(grid.geometry.buffer(EDGE_BUFFER_PX * 10.0))
    data_mask = buffered & np.isfinite(values) | interior
    result = classify_grid(values, data_mask, interior, params)
    polygons = vectorise_classes(
        result.classes, grid.transform, grid.geometry, result.zone_count, params.method
    )
    stats = []
    for c, polygon in polygons.items():
        sel = (result.classes == c) & interior & np.isfinite(values)
        mean = float(np.nanmean(values[sel])) if sel.any() else None
        stats.append((c, polygon, mean))
    stats.sort(key=lambda s: (math.inf if s[2] is None else s[2], s[0]))
    return [
        ZoneResult(number=i + 1, geometry=polygon, area_ha=polygon.area / 10_000, mean_value=mean)
        for i, (_, polygon, mean) in enumerate(stats)
    ]

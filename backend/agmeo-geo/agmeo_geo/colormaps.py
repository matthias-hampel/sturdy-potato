"""Display scales for raster tiles. Mirrors INDEX_SCALES / RELATIVE_SCALE in
packages/contracts/src/insights.ts; keep both in sync."""

SCALES = {
    "ndvi": (0.2, 0.9, ["#eef4e0", "#c3dfa5", "#86bd67", "#458f3c", "#1a5a1f"]),
    "ndre": (0.1, 0.6, ["#eef4e0", "#c3dfa5", "#86bd67", "#458f3c", "#1a5a1f"]),
    "ndmi": (-0.2, 0.5, ["#e7f0f8", "#b5d0e8", "#76a9d3", "#3a78b2", "#164a7e"]),
    "evi": (0.1, 0.8, ["#eef4e0", "#c3dfa5", "#86bd67", "#458f3c", "#1a5a1f"]),
    "bsi": (-0.3, 0.3, ["#f5efe6", "#e2c9a6", "#c49a64", "#94683a", "#5c3d1e"]),
    "ndti": (0.0, 0.3, ["#f6f3e1", "#e6dba3", "#c8b25f", "#958033", "#5e5119"]),
    "savi": (0.1, 0.7, ["#eef4e0", "#c3dfa5", "#86bd67", "#458f3c", "#1a5a1f"]),
    "lai": (0.0, 6.0, ["#f3f6e4", "#cfe3a6", "#93c464", "#4f9a3a", "#1f6324"]),
}

# Within-field contrast and productivity: below the field's typical value (brown), around it
# (neutral grey) and above it (green). Diverging, two hues and a neutral midpoint.
RELATIVE = ["#8a5a1e", "#c49a5c", "#e6e4de", "#86b866", "#2e6f2b"]


def _rgb(color: str) -> tuple[int, int, int]:
    return tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))


def ramp(colors: list[str]) -> dict[int, tuple[int, int, int, int]]:
    """256-entry colormap interpolating the stops evenly over 0..255."""
    stops = [_rgb(c) for c in colors]
    result = {}
    for value in range(256):
        position = value / 255 * (len(stops) - 1)
        i = min(len(stops) - 2, int(position))
        f = position - i
        a, b = stops[i], stops[i + 1]
        result[value] = (*tuple(round(a[k] + (b[k] - a[k]) * f) for k in range(3)), 255)
    return result


def colormap(index: str) -> dict[int, tuple[int, int, int, int]]:
    """256-entry colormap for values rescaled from [min, max] to 0..255."""
    return ramp(SCALES[index][2])

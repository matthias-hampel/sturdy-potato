//! OpenStreetMap background tiles, warped into the raster's pixel grid.
use crate::raster::{Raster, Region};
use anyhow::{Context, Result, ensure};
use image::{Rgba, RgbaImage};
use std::{
    collections::HashMap,
    f64::consts::PI,
    fs,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

pub const ATTRIBUTION: &str = "© OpenStreetMap contributors";
pub const COPYRIGHT_URL: &str = "https://www.openstreetmap.org/copyright";
const TILE_URL: &str = "https://tile.openstreetmap.org";
const TILE: f64 = 256.;
const MAX_ZOOM: u8 = 19;
const MAX_TILES: usize = 64;
const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
const GRID: u32 = 16;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Projection {
    Geographic,
    WebMercator,
    Utm { zone: u32, south: bool },
}

impl Projection {
    pub fn from_crs(crs: &str) -> Option<Self> {
        let code: u32 = crs.strip_prefix("EPSG:")?.parse().ok()?;
        match code {
            4326 | 4258 => Some(Self::Geographic),
            3857 | 3785 | 900913 => Some(Self::WebMercator),
            32601..=32660 => Some(Self::Utm {
                zone: code - 32600,
                south: false,
            }),
            32701..=32760 => Some(Self::Utm {
                zone: code - 32700,
                south: true,
            }),
            25828..=25838 => Some(Self::Utm {
                zone: code - 25800,
                south: false,
            }),
            _ => None,
        }
    }

    /// Longitude and latitude in degrees.
    pub fn lon_lat(self, x: f64, y: f64) -> (f64, f64) {
        match self {
            Self::Geographic => (x, y),
            Self::WebMercator => {
                const R: f64 = 6_378_137.;
                (
                    (x / R).to_degrees(),
                    (2. * (y / R).exp().atan() - PI / 2.).to_degrees(),
                )
            }
            Self::Utm { zone, south } => utm_inverse(x, y, zone, south),
        }
    }
}

/// Krüger series on WGS84. ETRS89 (GRS80) differs by well under a millimetre here.
fn utm_inverse(easting: f64, northing: f64, zone: u32, south: bool) -> (f64, f64) {
    const F: f64 = 1. / 298.257_223_563;
    const K0: f64 = 0.9996;
    let n = F / (2. - F);
    let (n2, n3) = (n * n, n * n * n);
    let a = 6_378_137. / (1. + n) * (1. + n2 / 4. + n2 * n2 / 64.);
    let beta = [
        n / 2. - 2. / 3. * n2 + 37. / 96. * n3,
        n2 / 48. + n3 / 15.,
        17. / 480. * n3,
    ];
    let delta = [
        2. * n - 2. / 3. * n2 - 2. * n3,
        7. / 3. * n2 - 8. / 5. * n3,
        56. / 15. * n3,
    ];
    let xi = (northing - if south { 10_000_000. } else { 0. }) / (K0 * a);
    let eta = (easting - 500_000.) / (K0 * a);
    let (mut xi1, mut eta1) = (xi, eta);
    for (j, b) in beta.iter().enumerate() {
        let k = 2. * (j + 1) as f64;
        xi1 -= b * (k * xi).sin() * (k * eta).cosh();
        eta1 -= b * (k * xi).cos() * (k * eta).sinh();
    }
    let chi = (xi1.sin() / eta1.cosh()).asin();
    let lat = chi
        + delta
            .iter()
            .enumerate()
            .map(|(j, d)| d * (2. * (j + 1) as f64 * chi).sin())
            .sum::<f64>();
    let lon = (zone as f64 * 6. - 183.).to_radians() + eta1.sinh().atan2(xi1.cos());
    (lon.to_degrees(), lat.to_degrees())
}

/// Web Mercator pixel position at zoom 0 (one 256-pixel tile spans the world).
fn world(lon: f64, lat: f64) -> (f64, f64) {
    let lat = lat.clamp(-85.051_128_78, 85.051_128_78).to_radians();
    (
        (lon + 180.) / 360. * TILE,
        (1. - lat.tan().asinh() / PI) / 2. * TILE,
    )
}

pub struct Basemap {
    pub image: RgbaImage,
    pub region: Region,
    pub zoom: u8,
    pub missing: usize,
}

/// Render the map behind `region`, with `edge` pixels on the longer side.
pub fn render(
    raster: &Raster,
    region: Region,
    edge: u32,
    tile: impl Fn(u8, u32, u32) -> Result<Arc<RgbaImage>> + Sync,
    cancelled: impl Fn() -> bool + Sync,
) -> Result<Basemap> {
    let projection = Projection::from_crs(&raster.crs).with_context(|| {
        format!(
            "not available for {} (supported: EPSG:4326, EPSG:3857, WGS84/ETRS89 UTM)",
            raster.crs
        )
    })?;
    ensure!(raster.transform.is_some(), "the file has no georeferencing");
    let ratio = edge as f64 / region.width.max(region.height);
    let out_w = (region.width * ratio).round().max(1.) as u32;
    let out_h = (region.height * ratio).round().max(1.) as u32;
    // Reprojection is smooth at preview scale: project a coarse grid and interpolate.
    let (gw, gh) = (out_w.div_ceil(GRID) + 1, out_h.div_ceil(GRID) + 1);
    let grid: Vec<(f64, f64)> = (0..gh * gw)
        .map(|i| {
            let x = region.x + ((i % gw) * GRID) as f64 * region.width / out_w as f64;
            let y = region.y + ((i / gw) * GRID) as f64 * region.height / out_h as f64;
            let (mx, my) = raster.map_point(x, y).unwrap_or((f64::NAN, f64::NAN));
            let (lon, lat) = projection.lon_lat(mx, my);
            world(lon, lat)
        })
        .collect();
    let at = |gx: u32, gy: u32| grid[(gy * gw + gx) as usize];
    // World position at the centre of output pixel (x, y).
    let world_at = |x: u32, y: u32| {
        let gx = (x as f64 + 0.5) / GRID as f64;
        let gy = (y as f64 + 0.5) / GRID as f64;
        let (x0, y0) = (gx.floor() as u32, gy.floor() as u32);
        let lerp =
            |a: (f64, f64), b: (f64, f64), t: f64| (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
        let top = lerp(at(x0, y0), at(x0 + 1, y0), gx.fract());
        let bottom = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), gx.fract());
        lerp(top, bottom, gy.fract())
    };
    let (cx, cy) = ((gw - 1) / 2, (gh - 1) / 2);
    let step = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).hypot(a.1 - b.1) / GRID as f64;
    let scale = (step(at(cx + 1, cy), at(cx, cy)) * step(at(cx, cy + 1), at(cx, cy))).sqrt();
    // The projections are monotonic, so the view's extremes lie on its border.
    let border: Vec<_> = (0..out_w)
        .flat_map(|x| [(x, 0), (x, out_h - 1)])
        .chain((0..out_h).flat_map(|y| [(0, y), (out_w - 1, y)]))
        .map(|(x, y)| world_at(x, y))
        .filter(|p| p.0.is_finite() && p.1.is_finite())
        .collect();
    ensure!(
        scale.is_finite() && scale > 0. && !border.is_empty(),
        "the view is outside the map projection"
    );
    let (min_x, max_x, min_y, max_y) = border.iter().fold(
        (f64::MAX, f64::MIN, f64::MAX, f64::MIN),
        |(a, b, c, d), p| (a.min(p.0), b.max(p.0), c.min(p.1), d.max(p.1)),
    );
    let mut zoom = (-scale.log2()).round().clamp(0., MAX_ZOOM as f64) as u8;
    let tiles = loop {
        let n = 1i64 << zoom;
        let index = |v: f64| (v * n as f64 / TILE).floor() as i64;
        let ys = index(min_y).max(0)..=index(max_y).min(n - 1);
        let xs = index(min_x)..=index(max_x).min(index(min_x) + n - 1);
        let keys: Vec<(u32, u32)> = ys
            .flat_map(|y| xs.clone().map(move |x| (x.rem_euclid(n) as u32, y as u32)))
            .collect();
        if keys.len() <= MAX_TILES || zoom == 0 {
            break keys;
        }
        zoom -= 1;
    };

    // At most two connections, per the OSM tile usage policy.
    let next = AtomicUsize::new(0);
    let fetched = Mutex::new(HashMap::new());
    let failure = Mutex::new(None);
    std::thread::scope(|s| {
        for _ in 0..2 {
            s.spawn(|| {
                while let Some(&(x, y)) = tiles.get(next.fetch_add(1, Ordering::Relaxed)) {
                    if cancelled() {
                        return;
                    }
                    match tile(zoom, x, y) {
                        Ok(image) => {
                            fetched.lock().unwrap().insert((x, y), image);
                        }
                        Err(e) => {
                            failure.lock().unwrap().get_or_insert(e);
                        }
                    }
                }
            });
        }
    });
    ensure!(!cancelled(), "Cancelled");
    let fetched = fetched.into_inner().unwrap();
    if fetched.is_empty()
        && let Some(e) = failure.into_inner().unwrap()
    {
        return Err(e);
    }

    let n = (1u32 << zoom) as f64;
    let image = RgbaImage::from_fn(out_w, out_h, |x, y| {
        let (wx, wy) = world_at(x, y);
        let (tx, ty) = (wx * n / TILE, wy * n / TILE);
        if !tx.is_finite() || !(0. ..n).contains(&ty) {
            return Rgba([0, 0, 0, 0]);
        }
        let key = (tx.floor().rem_euclid(n) as u32, ty.floor() as u32);
        let Some(image) = fetched.get(&key) else {
            return Rgba([0, 0, 0, 0]);
        };
        let px = (((tx - tx.floor()) * image.width() as f64) as u32).min(image.width() - 1);
        let py = (((ty - ty.floor()) * image.height() as f64) as u32).min(image.height() - 1);
        *image.get_pixel(px, py)
    });
    Ok(Basemap {
        image,
        region,
        zoom,
        missing: tiles.len() - fetched.len(),
    })
}

/// OSM tiles with a memory cache and a 7-day disk cache.
pub struct Tiles {
    agent: ureq::Agent,
    directory: Option<PathBuf>,
    memory: Mutex<HashMap<(u8, u32, u32), Arc<RgbaImage>>>,
}

impl Default for Tiles {
    fn default() -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(15)))
            .user_agent(concat!(
                "geotiff-viewer/",
                env!("CARGO_PKG_VERSION"),
                " (native desktop GeoTIFF viewer)"
            ))
            .build()
            .new_agent();
        let directory = std::env::var_os("HOME").map(|home| {
            PathBuf::from(home).join("Library/Caches/dev.sturdypotato.geotiff-viewer/osm-tiles")
        });
        Self {
            agent,
            directory,
            memory: Mutex::default(),
        }
    }
}

impl Tiles {
    pub fn get(&self, z: u8, x: u32, y: u32) -> Result<Arc<RgbaImage>> {
        if let Some(tile) = self.memory.lock().unwrap().get(&(z, x, y)) {
            return Ok(tile.clone());
        }
        let file = self
            .directory
            .as_ref()
            .map(|d| d.join(format!("{z}/{x}/{y}.png")));
        let cached = file.as_ref().and_then(|f| {
            let age = fs::metadata(f).ok()?.modified().ok()?.elapsed().ok()?;
            Some((fs::read(f).ok()?, age < MAX_AGE))
        });
        let bytes = match cached {
            Some((bytes, true)) => bytes,
            stale => match self.download(z, x, y) {
                Ok(bytes) => {
                    if let Some(file) = &file {
                        store(file, &bytes);
                    }
                    bytes
                }
                Err(e) => stale.map(|(bytes, _)| bytes).ok_or(e)?,
            },
        };
        let tile = Arc::new(
            image::load_from_memory(&bytes)
                .with_context(|| format!("Cannot decode map tile {z}/{x}/{y}"))?
                .to_rgba8(),
        );
        let mut memory = self.memory.lock().unwrap();
        if memory.len() >= 256 {
            memory.clear();
        }
        memory.insert((z, x, y), tile.clone());
        Ok(tile)
    }

    fn download(&self, z: u8, x: u32, y: u32) -> Result<Vec<u8>> {
        let mut response = self
            .agent
            .get(format!("{TILE_URL}/{z}/{x}/{y}.png"))
            .call()
            .with_context(|| format!("Cannot download map tile {z}/{x}/{y}"))?;
        Ok(response.body_mut().read_to_vec()?)
    }
}

/// Write via a temporary file so concurrent readers never see a partial tile.
fn store(file: &std::path::Path, bytes: &[u8]) {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let Some(parent) = file.parent() else { return };
    let temporary = parent.join(format!(
        ".{}-{}.tmp",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    if fs::create_dir_all(parent).is_ok()
        && fs::write(&temporary, bytes).is_ok()
        && fs::rename(&temporary, file).is_err()
    {
        let _ = fs::remove_file(&temporary);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: (f64, f64), b: (f64, f64)) -> bool {
        (a.0 - b.0).abs() < 1e-7 && (a.1 - b.1).abs() < 1e-7
    }

    #[test]
    fn utm_matches_proj() {
        // Reference values from pyproj (PROJ 9).
        let cases = [
            (
                "EPSG:32632",
                691000.,
                5335000.,
                (11.567501229, 48.139558349),
            ),
            (
                "EPSG:32733",
                250000.,
                8000000.,
                (12.638002080, -18.074252808),
            ),
            (
                "EPSG:25833",
                389000.,
                5819000.,
                (13.364413980, 52.509806057),
            ),
        ];
        for (crs, e, n, expected) in cases {
            let p = Projection::from_crs(crs).unwrap();
            assert!(
                close(p.lon_lat(e, n), expected),
                "{crs}: {:?}",
                p.lon_lat(e, n)
            );
        }
        assert_eq!(Projection::from_crs("EPSG:31467"), None);
        assert_eq!(Projection::from_crs("CRS not identified"), None);
        let mercator = Projection::WebMercator.lon_lat(20037508.342789244, 0.);
        assert!(close(mercator, (180., 0.)));
    }

    #[test]
    fn warps_tiles_into_raster_pixels() {
        const HALF: f64 = 20037508.342789244;
        let raster = Raster {
            path: PathBuf::new(),
            width: 256,
            height: 256,
            bands: vec![],
            levels: vec![],
            nodata: None,
            crs: "EPSG:3857".into(),
            transform: Some([-HALF, 2. * HALF / 256., 0., HALF, 0., -2. * HALF / 256.]),
            pixel_is_point: false,
            cache: Default::default(),
        };
        let color = |z: u8, x: u32, y: u32| Rgba([z, x as u8, y as u8, 255]);
        let map = render(
            &raster,
            raster.full(),
            512,
            |z, x, y| {
                anyhow::ensure!((x, y) != (1, 0), "offline");
                Ok(Arc::new(RgbaImage::from_pixel(256, 256, color(z, x, y))))
            },
            || false,
        )
        .unwrap();
        assert_eq!((map.zoom, map.missing), (1, 1));
        assert_eq!(map.image.dimensions(), (512, 512));
        assert_eq!(*map.image.get_pixel(10, 10), color(1, 0, 0));
        assert_eq!(map.image.get_pixel(500, 10)[3], 0);
        assert_eq!(*map.image.get_pixel(500, 500), color(1, 1, 1));
    }
}

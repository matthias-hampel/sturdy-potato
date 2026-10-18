//! Read local TIFF tiles on demand. No GDAL or archive-backend dependency.
use anyhow::{Context, Result, bail, ensure};
use std::{
    collections::{BTreeMap, HashMap},
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use tiff::{
    decoder::{Decoder, DecodingResult},
    tags::Tag,
};

type Reader = Decoder<BufReader<File>>;

/// Accept an overview up to this much coarser than the preview: a 1400-pixel preview
/// read from a 1372-pixel overview looks the same, but decodes 4× less data.
const OVERVIEW_TOLERANCE: f64 = 1.1;
/// Largest display plane; leaves room for the interpolation margin within `read`'s 2048 limit.
pub const MAX_DISPLAY_EDGE: u32 = 2040;
const CACHE_VALUES: usize = 32 << 20;

/// (IFD, chunk, band)
type ChunkKey = (usize, u32, usize);

#[derive(Clone, Debug)]
pub struct Band {
    pub name: String,
    pub formula: String,
    pub scale: f64,
    pub offset: f64,
}

#[derive(Clone, Debug)]
pub struct Level {
    pub ifd: usize,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug)]
pub struct Raster {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub bands: Vec<Band>,
    pub levels: Vec<Level>,
    pub nodata: Option<f64>,
    pub crs: String,
    pub transform: Option<[f64; 6]>,
    pub pixel_is_point: bool,
    pub cache: Arc<ChunkCache>,
}

/// Cleaned single-band values per decoded tile/strip, so panning only decodes new chunks.
#[derive(Default)]
pub struct ChunkCache(Mutex<Lru>);

#[derive(Default)]
struct Lru {
    tick: u64,
    entries: HashMap<ChunkKey, (u64, Arc<Vec<f64>>)>,
}

impl std::fmt::Debug for ChunkCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ChunkCache")
    }
}

impl ChunkCache {
    fn get(&self, key: ChunkKey) -> Option<Arc<Vec<f64>>> {
        let mut lru = self.0.lock().unwrap();
        lru.tick += 1;
        let tick = lru.tick;
        let entry = lru.entries.get_mut(&key)?;
        entry.0 = tick;
        Some(entry.1.clone())
    }

    fn insert(&self, key: ChunkKey, values: Arc<Vec<f64>>) {
        let mut lru = self.0.lock().unwrap();
        lru.tick += 1;
        let tick = lru.tick;
        let entries = &mut lru.entries;
        entries.insert(key, (tick, values));
        // Evict least recently used chunks beyond the budget (~256 MB).
        while entries.len() > 1 && entries.values().map(|e| e.1.len()).sum::<usize>() > CACHE_VALUES
        {
            let oldest = *entries.iter().min_by_key(|(_, e)| e.0).unwrap().0;
            entries.remove(&oldest);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Region {
    pub fn full(width: u32, height: u32) -> Self {
        Self {
            x: 0.,
            y: 0.,
            width: width as f64,
            height: height as f64,
        }
    }

    pub fn zoom(self, factor: f64, anchor: (f64, f64), full: Self) -> Self {
        let width = (self.width / factor).clamp(full.width.min(8.), full.width);
        let height = width * full.height / full.width;
        Self {
            x: (self.x + anchor.0 * (self.width - width)).clamp(0., full.width - width),
            y: (self.y + anchor.1 * (self.height - height))
                .clamp(0., (full.height - height).max(0.)),
            width,
            height,
        }
    }

    pub fn pan(self, dx: f64, dy: f64, full: Self) -> Self {
        Self {
            x: (self.x + dx).clamp(0., (full.width - self.width).max(0.)),
            y: (self.y + dy).clamp(0., (full.height - self.height).max(0.)),
            ..self
        }
    }
}

/// How native pixels are enlarged when a view has fewer pixels than the screen.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Upsampling {
    /// Each native pixel becomes a visible square.
    Nearest,
    /// Bicubic (Catmull-Rom) interpolation of values, before colouring.
    Smooth,
}

#[derive(Debug)]
pub struct Plane {
    pub width: u32,
    pub height: u32,
    pub values: Vec<f64>,
    pub region: Region,
    pub overview_factor: f64,
}

fn reader(path: &Path) -> Result<Reader> {
    let file = File::open(path).with_context(|| format!("Cannot open {}", path.display()))?;
    Decoder::new(BufReader::new(file)).context("Cannot decode TIFF header")
}

fn band_metadata(xml: &str, count: usize) -> Vec<Band> {
    let mut bands: Vec<_> = (0..count)
        .map(|i| Band {
            name: format!("Band {}", i + 1),
            formula: String::new(),
            scale: 1.,
            offset: 0.,
        })
        .collect();
    if let Ok(document) = roxmltree::Document::parse(xml.trim_end_matches('\0')) {
        for item in document.descendants().filter(|n| n.has_tag_name("Item")) {
            let Some(index) = item
                .attribute("sample")
                .and_then(|s| s.parse::<usize>().ok())
            else {
                continue;
            };
            let Some(band) = bands.get_mut(index) else {
                continue;
            };
            let text = item.text().unwrap_or("").trim();
            let name = item.attribute("name").unwrap_or("").to_ascii_lowercase();
            let role = item.attribute("role").unwrap_or("");
            if role == "description" || name == "description" {
                band.name = text.to_owned();
            }
            if name == "formula" {
                band.formula = text.to_owned();
            }
            if role == "scale" {
                band.scale = text.parse().unwrap_or(1.);
            }
            if role == "offset" {
                band.offset = text.parse().unwrap_or(0.);
            }
        }
    }
    bands
}

fn key(keys: &[u16], requested: u16) -> Option<u16> {
    keys.get(4..)?.as_chunks::<4>().0.iter().find_map(|entry| {
        (entry[0] == requested && entry[1] == 0 && entry[2] == 1).then_some(entry[3])
    })
}

impl Raster {
    pub fn open(path: &Path) -> Result<Self> {
        let path = path.canonicalize().context("File does not exist")?;
        let mut decoder = reader(&path)?;
        let (width, height) = decoder.dimensions()?;
        ensure!(width > 0 && height > 0, "Empty raster");
        let count = decoder.get_tag_u32(Tag::SamplesPerPixel).unwrap_or(1) as usize;
        ensure!(
            (1..=512).contains(&count),
            "Unsupported band count: {count}"
        );
        let orientation = decoder.get_tag_u32(Tag::Orientation).unwrap_or(1);
        ensure!(
            orientation == 1,
            "TIFF orientation {orientation} is not supported; use top-left orientation"
        );
        let xml = decoder
            .get_tag_ascii_string(Tag::Unknown(42112))
            .unwrap_or_default();
        let bands = band_metadata(&xml, count);
        let nodata = decoder
            .get_tag_ascii_string(Tag::Unknown(42113))
            .ok()
            .and_then(|s| s.trim_end_matches('\0').trim().parse().ok());
        let keys = decoder
            .get_tag_u16_vec(Tag::Unknown(34735))
            .unwrap_or_default();
        let crs = key(&keys, 3072)
            .or_else(|| key(&keys, 2048))
            .filter(|&n| n != 32767)
            .map(|n| format!("EPSG:{n}"))
            .unwrap_or_else(|| "CRS not identified".into());
        let pixel_is_point = key(&keys, 1025) == Some(2);
        let matrix = decoder
            .get_tag_f64_vec(Tag::Unknown(34264))
            .unwrap_or_default();
        let tie = decoder
            .get_tag_f64_vec(Tag::Unknown(33922))
            .unwrap_or_default();
        let scale = decoder
            .get_tag_f64_vec(Tag::Unknown(33550))
            .unwrap_or_default();
        let transform = if matrix.len() == 16 {
            Some([
                matrix[3], matrix[0], matrix[1], matrix[7], matrix[4], matrix[5],
            ])
        } else if tie.len() >= 6 && scale.len() >= 2 {
            Some([
                tie[3] - tie[0] * scale[0],
                scale[0],
                0.,
                tie[4] + tie[1] * scale[1],
                0.,
                -scale[1],
            ])
        } else {
            None
        };
        let mut levels = vec![Level {
            ifd: 0,
            width,
            height,
        }];
        let mut ifd = 0;
        while decoder.more_images() {
            ifd += 1;
            ensure!(ifd < 128, "Too many TIFF image directories");
            decoder.next_image()?;
            let (w, h) = decoder.dimensions()?;
            let samples = decoder.get_tag_u32(Tag::SamplesPerPixel).unwrap_or(1) as usize;
            let subfile = decoder.get_tag_u32(Tag::NewSubfileType).unwrap_or(0);
            if samples == count
                && subfile & 1 != 0
                && subfile & 4 == 0
                && w > 0
                && h > 0
                && w < width
                && h < height
                && (w as f64 * height as f64 / width as f64 - h as f64).abs() <= 1.
            {
                levels.push(Level {
                    ifd,
                    width: w,
                    height: h,
                });
            }
        }
        levels.sort_by_key(|l| std::cmp::Reverse(l.width));
        Ok(Self {
            path,
            width,
            height,
            bands,
            levels,
            nodata,
            crs,
            transform,
            pixel_is_point,
            cache: Arc::default(),
        })
    }

    pub fn full(&self) -> Region {
        Region::full(self.width, self.height)
    }

    pub fn coordinate(&self, column: u32, row: u32) -> Option<(f64, f64)> {
        self.map_point(column as f64 + 0.5, row as f64 + 0.5)
    }

    /// CRS coordinate of a continuous raster position; (0, 0) is the top-left pixel corner.
    pub fn map_point(&self, x: f64, y: f64) -> Option<(f64, f64)> {
        let t = self.transform?;
        let (x, y) = if self.pixel_is_point {
            (x - 0.5, y - 0.5)
        } else {
            (x, y)
        };
        Some((t[0] + x * t[1] + y * t[2], t[3] + x * t[4] + y * t[5]))
    }

    fn clean(&self, value: f64, band: usize) -> f64 {
        if !value.is_finite() || self.nodata.is_some_and(|n| n == value) {
            f64::NAN
        } else {
            value * self.bands[band].scale + self.bands[band].offset
        }
    }

    /// Decode one tile/strip at a time and retain only the requested scalar band.
    pub fn read(
        &self,
        band: usize,
        region: Region,
        edge: u32,
        cancelled: impl Fn() -> bool + Sync,
    ) -> Result<Plane> {
        ensure!(band < self.bands.len(), "Band out of range");
        ensure!(edge > 0 && edge <= 2048, "Preview edge must be 1..2048");
        ensure!(
            region.width.is_finite()
                && region.height.is_finite()
                && region.x.is_finite()
                && region.y.is_finite()
                && region.width > 0.
                && region.height > 0.
                && region.x >= 0.
                && region.y >= 0.
                && region.x + region.width <= self.width as f64 + 1e-6
                && region.y + region.height <= self.height as f64 + 1e-6,
            "Invalid raster window"
        );
        let ratio = (edge as f64 / region.width.max(region.height)).min(1.);
        let out_w = (region.width * ratio).round().max(1.) as u32;
        let out_h = (region.height * ratio).round().max(1.) as u32;
        let desired = (region.width / out_w as f64).min(region.height / out_h as f64);
        let level = self
            .levels
            .iter()
            .rev()
            .find(|l| self.width as f64 / l.width as f64 <= desired * OVERVIEW_TOLERANCE)
            .unwrap_or(&self.levels[0]);
        let mut decoder = reader(&self.path)?;
        decoder.seek_to_image(level.ifd)?;
        let (cw, ch) = decoder.chunk_dimensions();
        ensure!(cw > 0 && ch > 0, "Invalid chunk dimensions");
        let across = level.width.div_ceil(cw);
        let down = level.height.div_ceil(ch);
        let planar = decoder.get_tag_u32(Tag::PlanarConfiguration).unwrap_or(1) == 2;
        let stride = if planar { 1 } else { self.bands.len() };
        let band_offset = if planar { 0 } else { band };
        let mut chunks: BTreeMap<u32, Vec<(usize, u32, u32)>> = BTreeMap::new();
        for y in 0..out_h {
            if cancelled() {
                bail!("Cancelled");
            }
            let sy = (((region.y + (y as f64 + 0.5) * region.height / out_h as f64)
                * level.height as f64
                / self.height as f64)
                .floor() as u32)
                .min(level.height - 1);
            for x in 0..out_w {
                let sx = (((region.x + (x as f64 + 0.5) * region.width / out_w as f64)
                    * level.width as f64
                    / self.width as f64)
                    .floor() as u32)
                    .min(level.width - 1);
                let chunk = (sy / ch) * across
                    + sx / cw
                    + if planar {
                        band as u32 * across * down
                    } else {
                        0
                    };
                chunks
                    .entry(chunk)
                    .or_default()
                    .push(((y * out_w + x) as usize, sx % cw, sy % ch));
            }
        }
        let key = |chunk: u32| (level.ifd, chunk, band);
        let mut decoded: HashMap<u32, Arc<Vec<f64>>> = chunks
            .keys()
            .filter_map(|&c| Some((c, self.cache.get(key(c))?)))
            .collect();
        let missing: Vec<u32> = chunks
            .keys()
            .copied()
            .filter(|c| !decoded.contains_key(c))
            .collect();
        if !missing.is_empty() {
            // Chunks are independent: decode them on all cores, one decoder per thread.
            let threads = std::thread::available_parallelism()
                .map_or(4, |n| n.get())
                .min(8)
                .min(missing.len());
            let next = AtomicUsize::new(0);
            let results = std::thread::scope(|s| {
                let workers: Vec<_> = (0..threads)
                    .map(|_| {
                        s.spawn(|| -> Result<Vec<(u32, Arc<Vec<f64>>)>> {
                            let mut decoder = reader(&self.path)?;
                            decoder.seek_to_image(level.ifd)?;
                            let mut out = Vec::new();
                            while let Some(&chunk) =
                                missing.get(next.fetch_add(1, Ordering::Relaxed))
                            {
                                if cancelled() {
                                    bail!("Cancelled");
                                }
                                let data = decoder.read_chunk(chunk).context(
                                    "Cannot decode tile/strip (unsupported codec or oversized chunk)",
                                )?;
                                let values =
                                    Arc::new(self.extract(&data, stride, band_offset, band));
                                self.cache.insert(key(chunk), values.clone());
                                out.push((chunk, values));
                            }
                            Ok(out)
                        })
                    })
                    .collect();
                workers
                    .into_iter()
                    .map(|w| w.join().expect("decoder thread panicked"))
                    .collect::<Result<Vec<_>>>()
            })?;
            decoded.extend(results.into_iter().flatten());
        }
        let mut values = vec![f64::NAN; (out_w * out_h) as usize];
        for (chunk, points) in chunks {
            let (data_width, _) = decoder.chunk_data_dimensions(chunk);
            let plane = &decoded[&chunk];
            for (destination, x, y) in points {
                values[destination] = *plane
                    .get(y as usize * data_width as usize + x as usize)
                    .context("Decoded chunk has an unexpected sample layout")?;
            }
        }
        Ok(Plane {
            width: out_w,
            height: out_h,
            values,
            region,
            overview_factor: self.width as f64 / level.width as f64,
        })
    }

    /// Always read the original IFD, never a resampled overview.
    pub fn pixel(&self, band: usize, column: u32, row: u32) -> Result<f64> {
        ensure!(
            column < self.width && row < self.height,
            "Pixel out of bounds"
        );
        let mut native = self.clone();
        native.levels.truncate(1);
        let plane = native.read(
            band,
            Region {
                x: column as f64,
                y: row as f64,
                width: 1.,
                height: 1.,
            },
            1,
            || false,
        )?;
        Ok(plane.values[0])
    }
}

impl Raster {
    /// One band of a decoded chunk, with nodata, scale and offset applied.
    fn extract(
        &self,
        data: &DecodingResult,
        stride: usize,
        offset: usize,
        band: usize,
    ) -> Vec<f64> {
        macro_rules! band {
            ($v:expr, $f:expr) => {
                $v.iter()
                    .skip(offset)
                    .step_by(stride)
                    .map(|v| self.clean($f(*v), band))
                    .collect()
            };
        }
        match data {
            DecodingResult::U8(v) => band!(v, f64::from),
            DecodingResult::U16(v) => band!(v, f64::from),
            DecodingResult::U32(v) => band!(v, f64::from),
            DecodingResult::U64(v) => band!(v, |v| v as f64),
            DecodingResult::I8(v) => band!(v, f64::from),
            DecodingResult::I16(v) => band!(v, f64::from),
            DecodingResult::I32(v) => band!(v, f64::from),
            DecodingResult::I64(v) => band!(v, |v| v as f64),
            DecodingResult::F32(v) => band!(v, f64::from),
            DecodingResult::F64(v) => band!(v, f64::from),
            DecodingResult::F16(v) => v
                .iter()
                .skip(offset)
                .step_by(stride)
                .map(|v| self.clean(v.to_f64(), band))
                .collect(),
        }
    }
}

impl Raster {
    /// A plane sized for a display `edge` pixels on its longer side. Coarser views read like
    /// `read`; magnified views interpolate native values up to `edge`, so the GPU does not
    /// stretch a small image. For display only: `pixel` still reads original values.
    pub fn read_display(
        &self,
        band: usize,
        region: Region,
        edge: u32,
        upsampling: Upsampling,
        cancelled: impl Fn() -> bool + Sync,
    ) -> Result<Plane> {
        let edge = edge.clamp(1, MAX_DISPLAY_EDGE);
        let native_edge = region.width.max(region.height);
        if native_edge >= edge as f64 {
            return self.read(band, region, edge, cancelled);
        }
        // Two extra native pixels on each side for the 4×4 bicubic neighbourhood.
        let left = (region.x.floor() - 2.).max(0.);
        let top = (region.y.floor() - 2.).max(0.);
        let window = Region {
            x: left,
            y: top,
            width: ((region.x + region.width).ceil() + 2.).min(self.width as f64) - left,
            height: ((region.y + region.height).ceil() + 2.).min(self.height as f64) - top,
        };
        let native = self.read(band, window, 2048, &cancelled)?;
        let scale = edge as f64 / native_edge;
        let width = ((region.width * scale).round() as u32).clamp(1, edge);
        let height = ((region.height * scale).round() as u32).clamp(1, edge);
        let values = upsample(&native, region, width, height, upsampling, &cancelled)?;
        Ok(Plane {
            width,
            height,
            values,
            region,
            overview_factor: 1.,
        })
    }
}

/// Sample `native` (whose region is a whole-pixel window) at the centres of a
/// `width`×`height` grid covering `region`, in parallel rows.
fn upsample(
    native: &Plane,
    region: Region,
    width: u32,
    height: u32,
    upsampling: Upsampling,
    cancelled: &(impl Fn() -> bool + Sync),
) -> Result<Vec<f64>> {
    let mut values = vec![f64::NAN; (width * height) as usize];
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .min(8) as u32;
    let rows = height.div_ceil(threads);
    std::thread::scope(|s| {
        let workers: Vec<_> = values
            .chunks_mut((rows * width) as usize)
            .enumerate()
            .map(|(chunk, out)| {
                s.spawn(move || -> Result<()> {
                    for (r, row) in out.chunks_mut(width as usize).enumerate() {
                        if cancelled() {
                            bail!("Cancelled");
                        }
                        let y = chunk as u32 * rows + r as u32;
                        // Native pixel centres are at integer positions in this frame.
                        let v = region.y + (y as f64 + 0.5) * region.height / height as f64
                            - native.region.y
                            - 0.5;
                        for (x, value) in row.iter_mut().enumerate() {
                            let u = region.x + (x as f64 + 0.5) * region.width / width as f64
                                - native.region.x
                                - 0.5;
                            *value = sample(native, u, v, upsampling);
                        }
                    }
                    Ok(())
                })
            })
            .collect();
        workers
            .into_iter()
            .try_for_each(|w| w.join().expect("upsampling thread panicked"))
    })?;
    Ok(values)
}

/// Nodata stays nodata over its whole native pixel. Next to nodata, fall back to bilinear,
/// then nearest, so valid values are never mixed with gaps.
fn sample(native: &Plane, u: f64, v: f64, upsampling: Upsampling) -> f64 {
    let (w, h) = (native.width as i64, native.height as i64);
    let at = |x: i64, y: i64| native.values[(y.clamp(0, h - 1) * w + x.clamp(0, w - 1)) as usize];
    let nearest = at((u + 0.5).floor() as i64, (v + 0.5).floor() as i64);
    if upsampling == Upsampling::Nearest || !nearest.is_finite() {
        return nearest;
    }
    let (x0, y0) = (u.floor() as i64, v.floor() as i64);
    let (fx, fy) = (u - x0 as f64, v - y0 as f64);
    let taps: [[f64; 4]; 4] =
        std::array::from_fn(|j| std::array::from_fn(|i| at(x0 - 1 + i as i64, y0 - 1 + j as i64)));
    if taps.iter().flatten().all(|t| t.is_finite()) {
        let (wx, wy) = (catmull_rom(fx), catmull_rom(fy));
        let (mut sum, mut low, mut high) = (0., f64::INFINITY, f64::NEG_INFINITY);
        for (j, row) in taps.iter().enumerate() {
            for (i, &t) in row.iter().enumerate() {
                sum += wx[i] * wy[j] * t;
                low = low.min(t);
                high = high.max(t);
            }
        }
        // No overshoot beyond the neighbourhood, so smoothing never invents extreme values.
        return sum.clamp(low, high);
    }
    let [a, b, c, d] = [taps[1][1], taps[1][2], taps[2][1], taps[2][2]];
    if [a, b, c, d].iter().all(|t| t.is_finite()) {
        (a * (1. - fx) + b * fx) * (1. - fy) + (c * (1. - fx) + d * fx) * fy
    } else {
        nearest
    }
}

fn catmull_rom(t: f64) -> [f64; 4] {
    let (t2, t3) = (t * t, t * t * t);
    [
        (-t3 + 2. * t2 - t) / 2.,
        (3. * t3 - 5. * t2 + 2.) / 2.,
        (-3. * t3 + 4. * t2 + t) / 2.,
        (t3 - t2) / 2.,
    ]
}

impl Plane {
    pub fn auto_range(&self) -> (f64, f64) {
        let step = (self.values.len() / 100_000).max(1);
        let mut values: Vec<_> = self
            .values
            .iter()
            .step_by(step)
            .copied()
            .filter(|v| v.is_finite())
            .collect();
        if values.is_empty() {
            return (0., 1.);
        }
        values.sort_unstable_by(f64::total_cmp);
        let low = values[(values.len() - 1) * 2 / 100];
        let high = values[(values.len() - 1) * 98 / 100];
        if high <= low {
            (low - 0.5, low + 0.5)
        } else {
            (low, high)
        }
    }

    pub fn valid_fraction(&self) -> f64 {
        self.values.iter().filter(|v| v.is_finite()).count() as f64
            / self.values.len().max(1) as f64
    }

    /// Approximate extent of visible data, in original raster pixels.
    pub fn valid_region(&self) -> Option<Region> {
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (self.width, self.height, 0, 0);
        let mut found = false;
        for (i, value) in self.values.iter().enumerate() {
            if value.is_finite() {
                let (x, y) = (i as u32 % self.width, i as u32 / self.width);
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x + 1);
                max_y = max_y.max(y + 1);
                found = true;
            }
        }
        found.then(|| Region {
            x: self.region.x + min_x as f64 * self.region.width / self.width as f64,
            y: self.region.y + min_y as f64 * self.region.height / self.height as f64,
            width: (max_x - min_x) as f64 * self.region.width / self.width as f64,
            height: (max_y - min_y) as f64 * self.region.height / self.height as f64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_gdal_band_names_and_formulas() {
        let bands = band_metadata(
            r#"<GDALMetadata><Item name="DESCRIPTION" sample="1" role="description">NDRE</Item><Item name="formula" sample="1">(N-R)/(N+R)</Item></GDALMetadata>"#,
            3,
        );
        assert_eq!(bands[0].name, "Band 1");
        assert_eq!(bands[1].name, "NDRE");
        assert_eq!(bands[1].formula, "(N-R)/(N+R)");
    }

    #[test]
    fn zoom_keeps_anchor_and_bounds() {
        let full = Region::full(1000, 500);
        let zoom = full.zoom(2., (0.25, 0.5), full);
        assert_eq!(
            zoom,
            Region {
                x: 125.,
                y: 125.,
                width: 500.,
                height: 250.
            }
        );
        assert_eq!(zoom.zoom(0.01, (0.5, 0.5), full), full);
        assert_eq!(zoom.pan(1e9, -1e9, full).x, 500.);
    }

    fn grid(width: u32, height: u32, value: impl Fn(u32, u32) -> f64) -> Plane {
        Plane {
            width,
            height,
            values: (0..width * height)
                .map(|i| value(i % width, i / width))
                .collect(),
            region: Region::full(width, height),
            overview_factor: 1.,
        }
    }

    fn enlarge(native: &Plane, factor: u32, upsampling: Upsampling) -> Vec<f64> {
        let (w, h) = (native.width * factor, native.height * factor);
        upsample(native, native.region, w, h, upsampling, &|| false).unwrap()
    }

    #[test]
    fn smooth_upsampling_follows_gradients_without_overshoot() {
        let ramp = grid(8, 8, |x, y| x as f64 * 0.1 + y as f64 * 0.05);
        let values = enlarge(&ramp, 4, Upsampling::Smooth);
        // Output pixel (13, 10) is centred on native (13.5 / 4 - 0.5, 10.5 / 4 - 0.5); cubic reproduces a plane.
        let expected = 2.875 * 0.1 + 2.125 * 0.05;
        assert!((values[10 * 32 + 13] - expected).abs() < 1e-12);
        let step = grid(8, 1, |x, _| if x < 4 { 0. } else { 1. });
        let values = enlarge(&step, 8, Upsampling::Smooth);
        assert!(values.iter().all(|v| (0. ..=1.).contains(v)));
        assert!(values.iter().any(|v| *v > 0.05 && *v < 0.95));
    }

    #[test]
    fn upsampling_keeps_nodata_at_native_pixel_edges() {
        let mut native = grid(6, 6, |x, _| x as f64);
        native.values[2 * 6 + 2] = f64::NAN;
        for upsampling in [Upsampling::Nearest, Upsampling::Smooth] {
            let values = enlarge(&native, 4, upsampling);
            for y in 0..24 {
                for x in 0..24 {
                    let inside = (8..12).contains(&x) && (8..12).contains(&y);
                    assert_eq!(
                        values[y * 24 + x].is_nan(),
                        inside,
                        "{upsampling:?} {x},{y}"
                    );
                }
            }
        }
        let nearest = enlarge(&native, 4, Upsampling::Nearest);
        assert_eq!(nearest[5 * 24 + 13], 3.);
    }

    #[test]
    fn empty_and_constant_ranges_are_renderable() {
        let mut plane = Plane {
            width: 2,
            height: 2,
            values: vec![f64::NAN; 4],
            region: Region::full(2, 2),
            overview_factor: 1.,
        };
        assert_eq!(plane.auto_range(), (0., 1.));
        assert_eq!(plane.valid_fraction(), 0.);
        assert!(plane.valid_region().is_none());
        plane.values = vec![0.5; 4];
        assert_eq!(plane.auto_range(), (0., 1.));
        assert_eq!(plane.valid_region(), Some(Region::full(2, 2)));
    }
}

use crate::raster::Plane;
use image::{Rgba, RgbaImage};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Palette {
    Vegetation,
    Moisture,
    Viridis,
    Gray,
}

impl Palette {
    pub const ALL: [Self; 4] = [Self::Vegetation, Self::Moisture, Self::Viridis, Self::Gray];
    pub fn name(self) -> &'static str {
        match self {
            Self::Vegetation => "Vegetation",
            Self::Moisture => "Moisture",
            Self::Viridis => "Viridis",
            Self::Gray => "Grayscale",
        }
    }
    pub fn color(self, t: f64) -> [u8; 3] {
        let stops: &[[u8; 3]] = match self {
            Self::Vegetation => &[
                [153, 45, 52],
                [237, 164, 84],
                [247, 239, 171],
                [114, 186, 105],
                [20, 105, 65],
            ],
            Self::Moisture => &[
                [153, 91, 48],
                [232, 197, 139],
                [233, 238, 226],
                [88, 167, 196],
                [29, 69, 127],
            ],
            Self::Viridis => &[
                [68, 1, 84],
                [59, 82, 139],
                [33, 145, 140],
                [94, 201, 98],
                [253, 231, 37],
            ],
            Self::Gray => &[[24, 30, 38], [250, 250, 250]],
        };
        let v = t.clamp(0., 1.) * (stops.len() - 1) as f64;
        let index = (v.floor() as usize).min(stops.len() - 2);
        let f = v - index as f64;
        std::array::from_fn(|c| {
            (stops[index][c] as f64 * (1. - f) + stops[index + 1][c] as f64 * f).round() as u8
        })
    }
}

pub fn colorize(plane: &Plane, range: (f64, f64), palette: Palette) -> RgbaImage {
    RgbaImage::from_fn(plane.width, plane.height, |x, y| {
        let value = plane.values[(y * plane.width + x) as usize];
        if !value.is_finite() {
            return Rgba([0, 0, 0, 0]);
        }
        let rgb = palette.color((value - range.0) / (range.1 - range.0));
        Rgba([rgb[0], rgb[1], rgb[2], 255])
    })
}

pub fn index_defaults(name: &str) -> Option<((f64, f64), Palette)> {
    match name {
        "NDVI" | "NDRE" | "GNDVI" => Some(((-1., 1.), Palette::Vegetation)),
        "NDMI" | "NBR2" | "NDTI" => Some(((-1., 1.), Palette::Moisture)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::Region;
    #[test]
    fn nodata_is_transparent_and_values_are_clamped_only_for_display() {
        let p = Plane {
            width: 3,
            height: 1,
            values: vec![f64::NAN, -2., 2.],
            region: Region::full(3, 1),
            overview_factor: 1.,
        };
        let image = colorize(&p, (-1., 1.), Palette::Vegetation);
        assert_eq!(image.get_pixel(0, 0)[3], 0);
        assert_eq!(
            &image.get_pixel(1, 0).0[..3],
            &Palette::Vegetation.color(0.)
        );
        assert_eq!(
            &image.get_pixel(2, 0).0[..3],
            &Palette::Vegetation.color(1.)
        );
        assert_eq!(p.values[2], 2.);
    }
}

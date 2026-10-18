use geotiff_viewer::raster::{Raster, Region, Upsampling};
use std::path::PathBuf;

fn fixture(name: &str) -> Raster {
    Raster::open(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name),
    )
    .unwrap()
}

#[test]
fn tiled_float_layouts_edges_metadata_and_overviews() {
    for name in ["pixel.tif", "band.tif"] {
        let r = fixture(name);
        assert_eq!((r.width, r.height, r.bands.len()), (21, 19, 3));
        assert_eq!(r.bands[0].name, "NDVI");
        assert_eq!(r.crs, "EPSG:32632");
        assert_eq!(r.coordinate(0, 0), Some((500010., 5999990.)));
        assert_eq!(r.levels.len(), 3);
        for band in 0..3 {
            let plane = r.read(band, r.full(), 21, || false).unwrap();
            assert!(plane.values[0].is_nan());
            for row in 0..19 {
                for col in 0..21 {
                    if row == 0 && col == 0 {
                        continue;
                    }
                    let raw = ((band * 19 * 21 + row * 21 + col) as f32 / 100.) as f64;
                    let expected = if band == 0 { raw * 2. + 1. } else { raw };
                    assert!(
                        (plane.values[row * 21 + col] - expected).abs() < 1e-6,
                        "{name} band {band} pixel {col},{row}"
                    );
                }
            }
            assert_eq!(r.pixel(band, 20, 18).unwrap(), plane.values[18 * 21 + 20]);
            let overview = r.read(band, r.full(), 5, || false).unwrap();
            assert!(overview.overview_factor > 1.);
        }
        assert!(r.read(0, r.full(), 21, || true).is_err());
        assert!(r.pixel(0, 21, 0).is_err());
        assert!(r.read(3, r.full(), 21, || false).is_err());
    }
}

#[test]
fn signed_integer_strips_and_nodata() {
    let r = fixture("integer.tif");
    let p = r.read(0, r.full(), 3, || false).unwrap();
    assert!(p.values[0].is_nan());
    assert_eq!(&p.values[1..], &[-2., 0., 1., 2., 3.]);
}

#[test]
fn magnified_display_interpolates_native_values() {
    let r = fixture("band.tif");
    // Band 2 is a plane in (column, row): (399 + 21 * row + column) / 100.
    let value = |column: f64, row: f64| (399. + 21. * row + column) / 100.;
    let region = Region {
        x: 5.,
        y: 4.,
        width: 6.,
        height: 4.,
    };
    for upsampling in [Upsampling::Smooth, Upsampling::Nearest] {
        let plane = r.read_display(1, region, 60, upsampling, || false).unwrap();
        assert_eq!((plane.width, plane.height, plane.region), (60, 40, region));
        for y in 0..40 {
            for x in 0..60 {
                // Centre of output pixel, in native pixel-centre coordinates.
                let column = 5. + (x as f64 + 0.5) / 10. - 0.5;
                let row = 4. + (y as f64 + 0.5) / 10. - 0.5;
                let expected = match upsampling {
                    Upsampling::Smooth => value(column, row),
                    Upsampling::Nearest => value((column + 0.5).floor(), (row + 0.5).floor()),
                };
                let actual = plane.values[y * 60 + x];
                assert!((actual - expected).abs() < 1e-6, "{upsampling:?} {x},{y}");
            }
        }
    }
    // Native pixel (0, 0) is NaN: it stays an exact 10×10 hole.
    let corner = Region {
        x: 0.,
        y: 0.,
        width: 3.,
        height: 3.,
    };
    let plane = r
        .read_display(1, corner, 30, Upsampling::Smooth, || false)
        .unwrap();
    for y in 0..30 {
        for x in 0..30 {
            assert_eq!(
                plane.values[y * 30 + x].is_nan(),
                x < 10 && y < 10,
                "{x},{y}"
            );
        }
    }
    // Not magnified: same as an ordinary preview read.
    let preview = r
        .read_display(1, r.full(), 10, Upsampling::Smooth, || false)
        .unwrap();
    assert!(preview.overview_factor > 1.);
    assert!(
        r.read_display(1, region, 60, Upsampling::Smooth, || true)
            .is_err()
    );
}

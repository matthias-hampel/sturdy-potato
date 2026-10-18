mod viewer;

use anyhow::{Context, Result};
use geotiff_viewer::{
    basemap::{self, Tiles},
    raster::{Raster, Region, Upsampling},
    visual::{Palette, colorize, index_defaults},
};
use gpui_kit::*;
use std::path::PathBuf;
use viewer::Viewer;

gpui_kit::actions!(geotiff_viewer, [Open, Quit, Fit]);

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_some_and(|s| s == "--help" || s == "-h") {
        println!(
            "GeoTIFF Viewer\n\n  geotiff-viewer [file.tif]\n  geotiff-viewer --inspect file.tif\n  geotiff-viewer --pixel file.tif BAND COLUMN ROW\n  geotiff-viewer --render file.tif BAND output.png [COLUMN ROW WIDTH HEIGHT EDGE [nearest]]\n  geotiff-viewer --basemap file.tif output.png\n\nBands are 1-based; pixel columns/rows are 0-based. No files leave this app;\nthe basemap downloads OpenStreetMap tiles for the file's extent."
        );
        return Ok(());
    }
    if let Some(command) = args
        .first()
        .and_then(|s| s.to_str())
        .filter(|s| s.starts_with("--"))
    {
        let path = args.get(1).context("Missing TIFF path")?;
        let raster = Raster::open(&PathBuf::from(path))?;
        let band = || -> Result<usize> {
            let value = args
                .get(2)
                .context("Missing 1-based band number")?
                .to_string_lossy()
                .parse::<usize>()?;
            anyhow::ensure!(
                value > 0 && value <= raster.bands.len(),
                "Band out of range"
            );
            Ok(value - 1)
        };
        match command {
            "--inspect" => println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "path": raster.path, "width": raster.width, "height": raster.height,
                    "crs": raster.crs, "transform": raster.transform,
                    "bands": raster.bands.iter().map(|b| &b.name).collect::<Vec<_>>(),
                    "levels": raster.levels.iter().map(|l| [l.width, l.height]).collect::<Vec<_>>(),
                }))?
            ),
            "--pixel" => {
                let column = args
                    .get(3)
                    .context("Missing column")?
                    .to_string_lossy()
                    .parse()?;
                let row = args
                    .get(4)
                    .context("Missing row")?
                    .to_string_lossy()
                    .parse()?;
                let value = raster.pixel(band()?, column, row)?;
                println!(
                    "{}",
                    serde_json::json!({"value": value.is_finite().then_some(value),
                    "coordinate": raster.coordinate(column, row), "crs": raster.crs})
                );
            }
            "--render" => {
                let selected = band()?;
                let output = PathBuf::from(args.get(3).context("Missing output PNG")?);
                anyhow::ensure!(!output.exists(), "Output already exists");
                let number = |i: usize| -> Result<f64> {
                    Ok(args
                        .get(i)
                        .context("Missing crop value")?
                        .to_string_lossy()
                        .parse()?)
                };
                let plane = if args.len() > 4 {
                    let region = Region {
                        x: number(4)?,
                        y: number(5)?,
                        width: number(6)?,
                        height: number(7)?,
                    };
                    let full = raster.full();
                    anyhow::ensure!(
                        region.width > 0.
                            && region.height > 0.
                            && region.x >= 0.
                            && region.y >= 0.
                            && region.x + region.width <= full.width
                            && region.y + region.height <= full.height,
                        "Crop outside the raster"
                    );
                    let upsampling = match args.get(9).and_then(|s| s.to_str()) {
                        None => Upsampling::Smooth,
                        Some("nearest") => Upsampling::Nearest,
                        Some(other) => anyhow::bail!("Unknown upsampling {other}; use nearest"),
                    };
                    raster
                        .read_display(selected, region, number(8)? as u32, upsampling, || false)?
                } else {
                    raster.read(selected, raster.full(), 1400, || false)?
                };
                let (range, palette) = index_defaults(&raster.bands[selected].name)
                    .unwrap_or((plane.auto_range(), Palette::Viridis));
                colorize(&plane, range, palette).save(&output)?;
                println!(
                    "{}",
                    serde_json::json!({"output": output, "valid_fraction": plane.valid_fraction(),
                    "range": [range.0, range.1], "overview_factor": plane.overview_factor})
                );
            }
            "--basemap" => {
                let output = PathBuf::from(args.get(2).context("Missing output PNG")?);
                anyhow::ensure!(!output.exists(), "Output already exists");
                let tiles = Tiles::default();
                let map = basemap::render(
                    &raster,
                    raster.full(),
                    1400,
                    |z, x, y| tiles.get(z, x, y),
                    || false,
                )
                .context("OSM basemap")?;
                map.image.save(&output)?;
                println!(
                    "{}",
                    serde_json::json!({"output": output, "zoom": map.zoom, "missing_tiles": map.missing})
                );
            }
            _ => anyhow::bail!("Unknown option {command}; use --help"),
        }
        return Ok(());
    }
    let initial = args.first().map(PathBuf::from);
    gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .run(move |cx| {
            gpui_kit::init(cx);
            gpui_kit::component::Theme::change(gpui_kit::component::ThemeMode::Dark, None, cx);
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.bind_keys([
                KeyBinding::new("cmd-q", Quit, None),
                KeyBinding::new("cmd-o", Open, None),
                KeyBinding::new("cmd-0", Fit, None),
            ]);
            cx.set_menus(vec![Menu {
                name: "GeoTIFF Viewer".into(),
                items: vec![MenuItem::action("Quit", Quit)],
                disabled: false,
            }]);
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1260.), px(880.)),
                    cx,
                ))),
                window_min_size: Some(size(px(940.), px(680.))),
                titlebar: Some(TitlebarOptions {
                    title: Some("GeoTIFF Viewer".into()),
                    ..Default::default()
                }),
                ..Default::default()
            };
            let (_, view) = gpui_kit::open_window(options, cx, |window, cx| {
                cx.new(|cx| Viewer::new(window, cx))
            })
            .expect("Unable to open native window");
            if let Some(path) = initial {
                view.update(cx, |view, cx| view.open(path, cx));
            }
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
            cx.activate(true);
        });
    Ok(())
}

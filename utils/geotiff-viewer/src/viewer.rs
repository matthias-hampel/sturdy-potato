use crate::{Fit, Open};
use geotiff_viewer::{
    basemap::{self, ATTRIBUTION, COPYRIGHT_URL, Tiles},
    raster::{MAX_DISPLAY_EDGE, Plane, Raster, Region, Upsampling},
    visual::{Palette, colorize, index_defaults},
};
use gpui_kit::{
    component::{
        button::{Button, ButtonVariants},
        input::{Input, InputState},
        *,
    },
    prelude::*,
    *,
};
use std::{
    cell::Cell,
    path::PathBuf,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

pub struct Viewer {
    raster: Option<Arc<Raster>>,
    band: usize,
    region: Option<Region>,
    plane: Option<Arc<Plane>>,
    image: Option<Arc<RenderImage>>,
    tiles: Arc<Tiles>,
    basemap_enabled: bool,
    smooth: bool,
    basemap: Option<(Arc<RenderImage>, Region)>,
    basemap_note: Option<String>,
    basemap_generation: Arc<AtomicU64>,
    palette: Palette,
    range: (f64, f64),
    automatic: bool,
    low: Entity<InputState>,
    high: Entity<InputState>,
    input_range: Option<(f64, f64)>,
    generation: Arc<AtomicU64>,
    pixel_generation: u64,
    loading: bool,
    error: Option<String>,
    status: String,
    inspection: String,
    bounds: Rc<Cell<Bounds<Pixels>>>,
    scale: Rc<Cell<f32>>,
    drag: Option<(Point<Pixels>, Region)>,
    moved: bool,
    focus: FocusHandle,
}

impl Viewer {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        Self {
            raster: None,
            band: 0,
            region: None,
            plane: None,
            image: None,
            tiles: Arc::default(),
            basemap_enabled: true,
            smooth: true,
            basemap: None,
            basemap_note: None,
            basemap_generation: Arc::new(AtomicU64::new(0)),
            palette: Palette::Vegetation,
            range: (-1., 1.),
            automatic: false,
            low: cx.new(|cx| InputState::new(window, cx)),
            high: cx.new(|cx| InputState::new(window, cx)),
            input_range: None,
            generation: Arc::new(AtomicU64::new(0)),
            pixel_generation: 0,
            loading: false,
            error: None,
            status: "Local files · No uploads".into(),
            inspection: "Click the image to inspect a native pixel.".into(),
            bounds: Rc::new(Cell::new(Bounds::default())),
            scale: Rc::new(Cell::new(1.)),
            drag: None,
            moved: false,
            focus,
        }
    }

    pub fn open(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let token = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        self.pixel_generation += 1;
        self.loading = true;
        self.error = None;
        self.raster = None;
        self.plane = None;
        self.clear_image(cx);
        self.basemap_generation.fetch_add(1, Ordering::Relaxed);
        self.clear_basemap(cx);
        self.status = format!("Opening {}…", path.display());
        cx.notify();
        let task = cx
            .background_executor()
            .spawn(async move { Raster::open(&path) });
        cx.spawn(async move |view, cx| {
            let result = task.await;
            let _ = view.update(cx, |v, cx| {
                if token != v.generation.load(Ordering::Relaxed) {
                    return;
                }
                match result {
                    Ok(raster) => {
                        v.region = Some(raster.full());
                        v.raster = Some(Arc::new(raster));
                        v.choose_band(0, cx);
                    }
                    Err(e) => {
                        v.loading = false;
                        v.error = Some(format!("{e:#}"));
                        cx.notify();
                    }
                }
            });
        })
        .detach();
    }

    fn clear_image(&mut self, cx: &mut Context<Self>) {
        if let Some(image) = self.image.take() {
            cx.drop_image(image, None);
        }
    }

    fn clear_basemap(&mut self, cx: &mut Context<Self>) {
        self.basemap_note = None;
        if let Some((image, _)) = self.basemap.take() {
            cx.drop_image(image, None);
        }
    }

    fn toggle_basemap(&mut self, cx: &mut Context<Self>) {
        self.basemap_enabled = !self.basemap_enabled;
        self.clear_basemap(cx);
        self.request_basemap(cx);
        cx.notify();
    }

    fn toggle_smooth(&mut self, cx: &mut Context<Self>) {
        self.smooth = !self.smooth;
        self.request(cx);
    }

    /// Physical pixels on the image's longer side, so the plane is drawn about 1:1.
    fn display_edge(&self) -> u32 {
        let b = self.image_bounds();
        let edge = f32::from(b.size.width).max(f32::from(b.size.height)) * self.scale.get();
        if edge < 1. {
            1400
        } else {
            (edge.ceil() as u32).min(MAX_DISPLAY_EDGE)
        }
    }

    /// Fetch map tiles separately so a slow network never delays the raster.
    fn request_basemap(&mut self, cx: &mut Context<Self>) {
        let generation = self.basemap_generation.clone();
        let token = generation.fetch_add(1, Ordering::Relaxed) + 1;
        let (Some(raster), Some(region), true) =
            (self.raster.clone(), self.region, self.basemap_enabled)
        else {
            return;
        };
        if self.basemap.as_ref().is_some_and(|(_, r)| *r == region) {
            return;
        }
        let tiles = self.tiles.clone();
        let executor = cx.background_executor().clone();
        let task = cx.background_executor().spawn(async move {
            executor.timer(Duration::from_millis(150)).await;
            basemap::render(
                &raster,
                region,
                1400,
                |z, x, y| tiles.get(z, x, y),
                || generation.load(Ordering::Relaxed) != token,
            )
        });
        cx.spawn(async move |view, cx| {
            let result = task.await;
            let _ = view.update(cx, |v, cx| {
                if token != v.basemap_generation.load(Ordering::Relaxed) {
                    return;
                }
                match result {
                    Ok(map) => {
                        let mut rgba = map.image;
                        for pixel in rgba.pixels_mut() {
                            pixel.0.swap(0, 2);
                        }
                        v.clear_basemap(cx);
                        v.basemap = Some((
                            Arc::new(RenderImage::new(vec![image::Frame::new(rgba)])),
                            map.region,
                        ));
                        if map.missing > 0 {
                            v.basemap_note = Some(format!("{} map tiles unavailable", map.missing));
                        }
                    }
                    Err(e) => v.basemap_note = Some(format!("{e:#}")),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn prompt(&mut self, cx: &mut Context<Self>) {
        let task = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Open GeoTIFF".into()),
        });
        cx.spawn(async move |view, cx| {
            if let Ok(Ok(Some(paths))) = task.await
                && let Some(path) = paths.into_iter().next()
            {
                let _ = view.update(cx, |v, cx| v.open(path, cx));
            }
        })
        .detach();
    }

    fn choose_band(&mut self, band: usize, cx: &mut Context<Self>) {
        let Some(raster) = &self.raster else {
            return;
        };
        self.band = band;
        self.pixel_generation += 1;
        self.inspection = "Click the image to inspect a native pixel.".into();
        if let Some((range, palette)) = index_defaults(&raster.bands[band].name) {
            self.range = range;
            self.palette = palette;
            self.automatic = false;
        } else {
            self.palette = Palette::Viridis;
            self.automatic = true;
        }
        self.plane = None;
        self.clear_image(cx);
        self.request(cx);
    }

    fn request(&mut self, cx: &mut Context<Self>) {
        let (Some(raster), Some(region)) = (self.raster.clone(), self.region) else {
            return;
        };
        let generation = self.generation.clone();
        let token = generation.fetch_add(1, Ordering::Relaxed) + 1;
        let band = self.band;
        let edge = self.display_edge();
        let upsampling = if self.smooth {
            Upsampling::Smooth
        } else {
            Upsampling::Nearest
        };
        self.loading = true;
        self.error = None;
        cx.notify();
        let executor = cx.background_executor().clone();
        let task = cx.background_executor().spawn(async move {
            executor.timer(Duration::from_millis(40)).await;
            raster.read_display(band, region, edge, upsampling, || {
                generation.load(Ordering::Relaxed) != token
            })
        });
        cx.spawn(async move |view, cx| {
            let result = task.await;
            let _ = view.update(cx, |v, cx| {
                if token != v.generation.load(Ordering::Relaxed) {
                    return;
                }
                v.loading = false;
                match result {
                    Ok(plane) => {
                        let magnified = plane.width as f64 / plane.region.width;
                        let detail = if magnified > 1.01 {
                            let method = if v.smooth { "smooth" } else { "native pixels" };
                            format!("{magnified:.1}× magnified, {method}")
                        } else {
                            format!("{:.1}× overview", plane.overview_factor)
                        };
                        v.status = format!(
                            "{:.1}% valid preview pixels · {} × {} preview · {detail}",
                            plane.valid_fraction() * 100.,
                            plane.width,
                            plane.height,
                        );
                        if v.automatic {
                            v.range = plane.auto_range();
                        }
                        v.plane = Some(Arc::new(plane));
                        v.recolor(cx);
                    }
                    Err(e) => v.error = Some(format!("{e:#}")),
                }
                cx.notify();
            });
        })
        .detach();
        self.request_basemap(cx);
    }

    fn recolor(&mut self, cx: &mut Context<Self>) {
        if let Some(plane) = &self.plane {
            let mut rgba = colorize(plane, self.range, self.palette);
            for pixel in rgba.pixels_mut() {
                pixel.0.swap(0, 2);
            }
            self.clear_image(cx);
            self.image = Some(Arc::new(RenderImage::new(vec![image::Frame::new(rgba)])));
        }
        cx.notify();
    }

    fn fit(&mut self, cx: &mut Context<Self>) {
        if let Some(raster) = &self.raster {
            self.region = Some(raster.full());
            self.request(cx);
        }
    }

    fn fit_valid(&mut self, cx: &mut Context<Self>) {
        let (Some(raster), Some(plane)) = (&self.raster, &self.plane) else {
            return;
        };
        let Some(valid) = plane.valid_region() else {
            self.error = Some("No valid pixels in this view.".into());
            cx.notify();
            return;
        };
        let full = raster.full();
        let width = (valid.width.max(valid.height * full.width / full.height) * 1.08)
            .clamp(full.width.min(8.), full.width);
        let height = width * full.height / full.width;
        self.region = Some(Region {
            x: (valid.x + valid.width / 2. - width / 2.).clamp(0., full.width - width),
            y: (valid.y + valid.height / 2. - height / 2.)
                .clamp(0., (full.height - height).max(0.)),
            width,
            height,
        });
        self.request(cx);
    }

    fn zoom(&mut self, factor: f64, anchor: (f64, f64), cx: &mut Context<Self>) {
        if let (Some(raster), Some(region)) = (&self.raster, self.region) {
            self.region = Some(region.zoom(factor, anchor, raster.full()));
            self.request(cx);
        }
    }

    fn image_bounds(&self) -> Bounds<Pixels> {
        fitted(
            self.bounds.get(),
            self.region.map(|r| r.width / r.height).unwrap_or(1.),
        )
    }

    fn normalized(&self, position: Point<Pixels>) -> Option<(f64, f64)> {
        let b = self.image_bounds();
        if !b.contains(&position) || b.size.width <= px(0.) || b.size.height <= px(0.) {
            return None;
        }
        Some((
            (f32::from(position.x - b.origin.x) / f32::from(b.size.width)) as f64,
            (f32::from(position.y - b.origin.y) / f32::from(b.size.height)) as f64,
        ))
    }

    fn inspect(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        if self.loading {
            return;
        }
        let (Some(raster), Some(region), Some((x, y))) =
            (self.raster.clone(), self.region, self.normalized(position))
        else {
            return;
        };
        let col = ((region.x + x * region.width) as u32).min(raster.width - 1);
        let row = ((region.y + y * region.height) as u32).min(raster.height - 1);
        self.pixel_generation += 1;
        let token = self.pixel_generation;
        let band = self.band;
        self.inspection = "Reading native pixel…".into();
        cx.notify();
        let task = cx.background_executor().spawn(async move {
            let value = raster.pixel(band, col, row)?;
            let value = if value.is_finite() {
                format!("{value:.6}")
            } else {
                "No data".into()
            };
            let coord = raster
                .coordinate(col, row)
                .map(|(x, y)| format!("\n{x:.2}, {y:.2}\n{}", raster.crs))
                .unwrap_or_default();
            anyhow::Ok(format!(
                "{}: {value}\nColumn {col} · Row {row}{coord}",
                raster.bands[band].name
            ))
        });
        cx.spawn(async move |view, cx| {
            let result = task.await;
            let _ = view.update(cx, |v, cx| {
                if token == v.pixel_generation {
                    v.inspection = result.unwrap_or_else(|e| format!("{e:#}"));
                    cx.notify();
                }
            });
        })
        .detach();
    }

    fn apply_range(&mut self, cx: &mut Context<Self>) {
        let low = self.low.read(cx).value().parse::<f64>();
        let high = self.high.read(cx).value().parse::<f64>();
        match (low, high) {
            (Ok(a), Ok(b)) if a.is_finite() && b.is_finite() && a < b => {
                self.range = (a, b);
                self.automatic = false;
                self.error = None;
                self.recolor(cx);
            }
            _ => {
                self.error = Some("Enter a finite minimum smaller than the maximum.".into());
                cx.notify();
            }
        }
    }

    fn export(&mut self, cx: &mut Context<Self>) {
        let (Some(plane), Some(raster)) = (self.plane.clone(), &self.raster) else {
            return;
        };
        let name = format!("{}-preview.png", raster.bands[self.band].name);
        let task = cx.prompt_for_new_path(raster.path.parent().unwrap(), Some(&name));
        let range = self.range;
        let palette = self.palette;
        cx.spawn(async move |view, cx| {
            if let Ok(Ok(Some(path))) = task.await {
                let result = cx
                    .background_executor()
                    .spawn(async move { colorize(&plane, range, palette).save(&path) })
                    .await;
                let _ = view.update(cx, |v, cx| {
                    match result {
                        Ok(_) => v.status = "Exported PNG preview (without georeferencing).".into(),
                        Err(e) => v.error = Some(e.to_string()),
                    }
                    cx.notify();
                });
            }
        })
        .detach();
    }
}

fn fitted(bounds: Bounds<Pixels>, aspect: f64) -> Bounds<Pixels> {
    let width = f32::from(bounds.size.width)
        .min(f32::from(bounds.size.height) * aspect as f32)
        .max(0.);
    let height = width / aspect as f32;
    Bounds::new(
        point(
            bounds.origin.x + (bounds.size.width - px(width)) / 2.,
            bounds.origin.y + (bounds.size.height - px(height)) / 2.,
        ),
        size(px(width), px(height)),
    )
}

impl Render for Viewer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.input_range != Some(self.range) {
            self.low.update(cx, |s, cx| {
                s.set_value(format!("{:.4}", self.range.0), window, cx)
            });
            self.high.update(cx, |s, cx| {
                s.set_value(format!("{:.4}", self.range.1), window, cx)
            });
            self.input_range = Some(self.range);
        }
        let title = self
            .raster
            .as_ref()
            .and_then(|r| r.path.file_name())
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or("GeoTIFF Viewer".into());
        let subtitle = self
            .raster
            .as_ref()
            .map(|r| {
                format!(
                    "{} × {} pixels  ·  {} bands  ·  {}",
                    r.width,
                    r.height,
                    r.bands.len(),
                    r.crs
                )
            })
            .unwrap_or("Native raster exploration".into());
        let bands = self
            .raster
            .as_ref()
            .map(|r| r.bands.clone())
            .unwrap_or_default();
        let formula = bands
            .get(self.band)
            .map(|b| b.formula.clone())
            .unwrap_or_default();
        let zoom = match (&self.raster, self.region) {
            (Some(r), Some(v)) => r.width as f64 / v.width,
            _ => 1.,
        };
        let bounds = self.bounds.clone();
        let scale = self.scale.clone();
        let image = self
            .image
            .clone()
            .zip(self.plane.as_ref().map(|p| p.region));
        let basemap = self.basemap.clone();
        let region = self.region;
        let aspect = region.map(|r| r.width / r.height).unwrap_or(1.);
        let drawing = canvas(
            move |b, window, _| {
                bounds.set(b);
                scale.set(window.scale_factor());
                b
            },
            move |b, _, window, _| {
                for y in 0..(f32::from(b.size.height) / 24.).ceil() as usize {
                    for x in 0..(f32::from(b.size.width) / 24.).ceil() as usize {
                        let w = (f32::from(b.size.width) - x as f32 * 24.).min(24.);
                        let h = (f32::from(b.size.height) - y as f32 * 24.).min(24.);
                        window.paint_quad(fill(
                            Bounds::new(
                                b.origin + point(px(x as f32 * 24.), px(y as f32 * 24.)),
                                size(px(w), px(h)),
                            ),
                            rgb(if (x + y) % 2 == 0 { 0x202b36 } else { 0x25323e }),
                        ));
                    }
                }
                let Some(view) = region else { return };
                let target = fitted(b, aspect);
                // Place each layer by the region it was rendered for, so stale layers stay aligned.
                let place = |r: Region| {
                    let sx = f32::from(target.size.width) as f64 / view.width;
                    let sy = f32::from(target.size.height) as f64 / view.height;
                    Bounds::new(
                        target.origin
                            + point(
                                px(((r.x - view.x) * sx) as f32),
                                px(((r.y - view.y) * sy) as f32),
                            ),
                        size(px((r.width * sx) as f32), px((r.height * sy) as f32)),
                    )
                };
                for (layer, r) in basemap.into_iter().chain(image) {
                    let _ =
                        window.paint_image(target, place(r), Corners::default(), layer, 0, false);
                }
            },
        )
        .size_full();
        let viewport = div()
            .id("viewport")
            .relative()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .on_scroll_wheel(cx.listener(|v, e: &ScrollWheelEvent, _, cx| {
                if let Some(anchor) = v.normalized(e.position) {
                    let delta = f32::from(e.delta.pixel_delta(px(18.)).y);
                    v.zoom((delta as f64 * 0.004).exp().clamp(0.65, 1.55), anchor, cx);
                    cx.stop_propagation();
                }
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|v, e: &MouseDownEvent, window, cx| {
                    window.focus(&v.focus, cx);
                    v.moved = false;
                    v.drag = v.region.map(|r| (e.position, r));
                }),
            )
            .on_mouse_move(cx.listener(|v, e: &MouseMoveEvent, _, cx| {
                if e.dragging()
                    && let (Some((start, original)), Some(raster)) = (v.drag, &v.raster)
                {
                    let dx = f32::from(e.position.x - start.x);
                    let dy = f32::from(e.position.y - start.y);
                    if dx.abs() + dy.abs() > 4. {
                        v.moved = true;
                        let b = v.image_bounds();
                        if b.size.width > px(0.) && b.size.height > px(0.) {
                            v.region = Some(original.pan(
                                -dx as f64 / f32::from(b.size.width) as f64 * original.width,
                                -dy as f64 / f32::from(b.size.height) as f64 * original.height,
                                raster.full(),
                            ));
                            v.request(cx);
                        }
                    }
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|v, e: &MouseUpEvent, _, cx| {
                    if v.drag.take().is_some() && !v.moved {
                        v.inspect(e.position, cx);
                    }
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|v, _, _, _| {
                    v.drag = None;
                }),
            )
            .on_drop(cx.listener(|v, paths: &ExternalPaths, _, cx| {
                if let Some(path) = paths.paths().first() {
                    v.open(path.clone(), cx);
                }
            }))
            .child(drawing)
            .when(self.raster.is_none() && !self.loading, |el| {
                el.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .gap_4()
                        .child(div().text_2xl().child("Explore your GeoTIFF"))
                        .child("Open a file or drop it here. Choose a band to begin.")
                        .child(
                            Button::new("empty-open")
                                .label("Open GeoTIFF")
                                .primary()
                                .on_click(cx.listener(|v, _, _, cx| v.prompt(cx))),
                        ),
                )
            })
            .when(self.basemap.is_some(), |el| {
                el.child(
                    div()
                        .id("osm-attribution")
                        .absolute()
                        .bottom_1()
                        .right_1()
                        .px_2()
                        .rounded_sm()
                        .bg(rgba(0x10161dcc))
                        .text_xs()
                        .cursor_pointer()
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_mouse_up(MouseButton::Left, |_, _, cx| {
                            cx.open_url(COPYRIGHT_URL);
                            cx.stop_propagation();
                        })
                        .child(ATTRIBUTION),
                )
            })
            .when_some(self.basemap_note.clone(), |el, note| {
                el.child(
                    div()
                        .absolute()
                        .bottom_1()
                        .left_1()
                        .px_2()
                        .rounded_sm()
                        .bg(rgba(0x10161dcc))
                        .text_xs()
                        .text_color(rgb(0x96a8b8))
                        .child(format!("Basemap: {note}")),
                )
            })
            .when(self.loading, |el| {
                el.child(
                    div()
                        .absolute()
                        .top_3()
                        .left_3()
                        .px_3()
                        .py_2()
                        .rounded_md()
                        .bg(rgb(0x18212b))
                        .child("Reading raster…"),
                )
            });
        div().size_full().flex().flex_col().bg(rgb(0x10161d)).text_color(rgb(0xe5edf4)).text_sm().track_focus(&self.focus)
            .on_action(cx.listener(|v,_: &Open,_,cx| v.prompt(cx)))
            .on_action(cx.listener(|v,_: &Fit,_,cx| v.fit(cx)))
            .child(div().flex().items_center().justify_between().px_5().py_4().border_b_1().border_color(rgb(0x2a3845))
                .child(div().flex().flex_col().gap_1().child(div().text_lg().child(title)).child(div().text_xs().text_color(rgb(0x96a8b8)).child(subtitle)))
                .child(Button::new("open").label("Open GeoTIFF  ⌘O").primary().on_click(cx.listener(|v,_,_,cx| v.prompt(cx)))))
            .when_some(self.error.clone(),|el,error| el.child(div().px_4().py_2().bg(rgb(0x542c32)).child(error)))
            .child(div().flex().flex_1().min_h_0()
                .child(div().w(px(230.)).flex_shrink_0().flex().flex_col().bg(rgb(0x18212b)).p_3().gap_3()
                    .child(div().text_xs().text_color(rgb(0x96a8b8)).child("RASTER BANDS"))
                    .child(div().id("bands").flex_1().min_h_0().overflow_y_scroll().flex().flex_col().gap_1()
                        .children(bands.iter().enumerate().map(|(i,b)| Button::new(("band",i)).label(format!("{:02}   {}",i+1,b.name)).compact().w_full().justify_start().selected(i==self.band).on_click(cx.listener(move |v,_,_,cx| v.choose_band(i,cx))))))
                    .child(div().text_xs().text_color(rgb(0x96a8b8)).child(formula))
                    .child(div().id("pixel-inspection").role(Role::Label).aria_label(self.inspection.clone()).border_t_1().border_color(rgb(0x344250)).pt_3().text_xs().whitespace_normal().child(self.inspection.clone())))
                .child(div().flex().flex_col().flex_1().min_w_0()
                    .child(div().flex().items_center().gap_2().px_3().py_2()
                        .child(Button::new("fit").label("Fit image").compact().on_click(cx.listener(|v,_,_,cx| v.fit(cx))))
                        .child(Button::new("valid").label("Fit valid area").compact().disabled(self.loading).on_click(cx.listener(|v,_,_,cx| v.fit_valid(cx))))
                        .child(Button::new("minus").label("−").compact().on_click(cx.listener(|v,_,_,cx| v.zoom(1./1.5,(0.5,0.5),cx))))
                        .child(Button::new("plus").label("+").compact().on_click(cx.listener(|v,_,_,cx| v.zoom(1.5,(0.5,0.5),cx))))
                        .child(Button::new("smooth").label("Smooth").compact().selected(self.smooth).on_click(cx.listener(|v,_,_,cx| v.toggle_smooth(cx))))
                        .child(Button::new("basemap").label("OSM basemap").compact().selected(self.basemap_enabled).on_click(cx.listener(|v,_,_,cx| v.toggle_basemap(cx))))
                        .child(div().flex_1().text_xs().child(format!("{zoom:.1}×")))
                        .child(Button::new("export").label("Export PNG").compact().disabled(self.plane.is_none()||self.loading).on_click(cx.listener(|v,_,_,cx| v.export(cx)))))
                    .child(viewport)
                    .child(div().flex().flex_col().p_3().gap_3()
                        .child(div().flex().flex_wrap().items_center().gap_2()
                            .children(Palette::ALL.into_iter().enumerate().map(|(i,p)| Button::new(("palette",i)).label(p.name()).compact().selected(p==self.palette).on_click(cx.listener(move |v,_,_,cx| {v.palette=p;v.recolor(cx);}))))
                            .child(div().flex_1())
                            .child("Min").child(Input::new(&self.low).w(px(82.))).child("Max").child(Input::new(&self.high).w(px(82.)))
                            .child(Button::new("range").label("Apply").compact().on_click(cx.listener(|v,_,_,cx| v.apply_range(cx))))
                            .child(Button::new("auto").label("Auto 2–98%").compact().on_click(cx.listener(|v,_,_,cx| {v.automatic=true;if let Some(p)=&v.plane{v.range=p.auto_range();}v.recolor(cx);}))))
                        .child(div().flex().h(px(9.)).rounded_sm().overflow_hidden().children((0..100).map(|i| {let c=self.palette.color(i as f64/99.);div().flex_1().h_full().bg(rgb((c[0] as u32)<<16|(c[1] as u32)<<8|c[2] as u32))})))
                        .child(div().flex().justify_between().text_xs().text_color(rgb(0x96a8b8)).child(format!("{:.4}",self.range.0)).child("Map or checkerboard = no data · Values outside the scale use end colours").child(format!("{:.4}",self.range.1))))))
            .child(div().id("status").role(Role::Status).aria_label(self.status.clone()).flex().flex_wrap().justify_between().px_4().py_2().text_xs().text_color(rgb(0x96a8b8)).child(self.status.clone()).child("Scroll to zoom · Drag to pan · Click to inspect"))
    }
}

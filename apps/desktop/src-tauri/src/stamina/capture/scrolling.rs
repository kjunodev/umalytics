use super::{Frame, SampleTimings, WindowCapture, FAILED};
use crate::stamina::ocr::{self, Import};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicU8, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

const INTERVAL: Duration = Duration::from_millis(200);
const STILL_TIME: Duration = Duration::from_millis(500);
const SESSION_LIMIT: Duration = Duration::from_secs(180);
const SAMPLE_WIDTH: usize = 96;
const SAMPLE_HEIGHT: usize = 72;
const RUNNING: u8 = 0;
const DRAINING: u8 = 1;
const CANCELLED: u8 = 2;

#[derive(Default)]
pub(crate) struct ScrollingScans(Mutex<Option<(u32, Arc<AtomicU8>)>>);

impl ScrollingScans {
    pub fn start(&self, id: u32) -> Arc<AtomicU8> {
        let mut active = self.0.lock().unwrap();
        let token = Arc::new(AtomicU8::new(RUNNING));
        if let Some((_, previous)) = active.replace((id, token.clone())) {
            previous.store(CANCELLED, Ordering::Relaxed);
        }
        token
    }

    pub fn stop(&self, id: Option<u32>) {
        let mut active = self.0.lock().unwrap();
        if active
            .as_ref()
            .is_some_and(|(current, _)| id.is_none_or(|id| id == *current))
        {
            if let Some((_, token)) = active.take() {
                token.store(CANCELLED, Ordering::Relaxed);
            }
        }
    }

    pub fn drain(&self, id: u32) {
        if let Some((_, token)) = self.0.lock().unwrap().as_ref().filter(|(active, _)| *active == id) {
            token.fetch_max(DRAINING, Ordering::Relaxed);
        }
    }

    pub fn finish(&self, token: &Arc<AtomicU8>) {
        let mut active = self.0.lock().unwrap();
        if active
            .as_ref()
            .is_some_and(|(_, current)| Arc::ptr_eq(token, current))
        {
            active.take();
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "type", content = "value", rename_all = "kebab-case")]
pub(crate) enum ScanUpdate {
    Queued(u32),
    Screenshot(Box<Import>),
    Finished(Option<&'static str>),
}

#[derive(Clone)]
struct ListPixels {
    bounds: [i32; 4],
    pixels: Vec<[u8; 3]>,
}

impl ListPixels {
    #[cfg(test)]
    fn from_frame(frame: &Frame) -> Option<Self> {
        Self::sample(frame, false)
    }

    fn sample(frame: &Frame, finished_uma: bool) -> Option<Self> {
        let at = |x: i32, y: i32| {
            let x = x.clamp(0, frame.width - 1);
            let y = y.clamp(0, frame.height - 1);
            let offset = (y as usize * frame.width as usize + x as usize) * 4;
            [
                frame.bgra[offset + 2],
                frame.bgra[offset + 1],
                frame.bgra[offset],
            ]
        };
        // A quarter-size probe locates the edges of the skill list.
        const SCALE: i32 = 4;
        let probe = |x, y| at(x * SCALE, y * SCALE);
        let width = frame.width / SCALE;
        let height = frame.height / SCALE;
        let [left, top, right, bottom] = if finished_uma {
            let bounds = ocr::find_finished_skill_list(width, height, probe)?;
            [bounds.left, bounds.top, bounds.right, bounds.bottom].map(|value| value * SCALE)
        } else {
            let banner = ocr::find_profile_banner(width, height, probe)?;
            let width = banner.width() * SCALE;
            let left = banner.left * SCALE;
            let top = banner.top * SCALE;
            // The Learn list is below the SP bar and above Confirm, left of Career Profile.
            // Exclude the animated character, the scrollbar and the button below the list.
            [
                left - width * 118 / 100,
                top + width * 60 / 100,
                left - width * 35 / 100,
                top + width * 133 / 100,
            ]
        };
        if left < 0 || top < 0 || right > frame.width || bottom > frame.height || left >= right || top >= bottom {
            return None;
        }
        let mut pixels = Vec::with_capacity(SAMPLE_WIDTH * SAMPLE_HEIGHT);
        for y in 0..SAMPLE_HEIGHT as i32 {
            for x in 0..SAMPLE_WIDTH as i32 {
                pixels.push(at(
                    left + (2 * x + 1) * (right - left) / (2 * SAMPLE_WIDTH as i32),
                    top + (2 * y + 1) * (bottom - top) / (2 * SAMPLE_HEIGHT as i32),
                ));
            }
        }
        Some(Self {
            bounds: [left, top, right, bottom],
            pixels,
        })
    }

    fn same_view(&self, other: &Self) -> bool {
        if self.bounds != other.bounds {
            return false;
        }
        // A channel change of 12 or more on over 0.5% of samples counts as motion.
        let limit = self.pixels.len() / 200;
        self.pixels
            .iter()
            .zip(&other.pixels)
            .filter(|(a, b)| a.iter().zip(*b).any(|(&a, &b)| a.abs_diff(b) >= 12))
            .take(limit + 1)
            .count()
            <= limit
    }
}

#[derive(Default)]
struct Stillness {
    previous: Option<ListPixels>,
    anchor: Option<(Instant, ListPixels)>,
    last_queued: Option<ListPixels>,
}

impl Stillness {
    fn observe(&mut self, now: Instant, pixels: ListPixels) {
        let stationary = self
            .previous
            .as_ref()
            .is_some_and(|previous| previous.same_view(&pixels));
        if !stationary
            || self
                .anchor
                .as_ref()
                .is_none_or(|(_, anchor)| !anchor.same_view(&pixels))
        {
            self.anchor = Some((now, pixels.clone()));
        }
        self.previous = Some(pixels);
    }

    fn ready(&self, now: Instant) -> bool {
        self.anchor
            .as_ref()
            .is_some_and(|(start, _)| now.duration_since(*start) >= STILL_TIME)
            && self.previous.as_ref().is_some_and(|pixels| {
                self.last_queued
                    .as_ref()
                    .is_none_or(|scan| !scan.same_view(pixels))
            })
    }

    fn mark_scanned(&mut self) {
        self.last_queued.clone_from(&self.previous);
    }

    fn reset(&mut self) {
        self.previous = None;
        self.anchor = None;
    }
}

#[derive(Default)]
struct Timings {
    samples: usize,
    capture: Duration,
    readback: Duration,
    crop: Duration,
    stillness: Duration,
}

impl Timings {
    fn record(&mut self, stage: SampleTimings, stillness: Duration) {
        self.samples += 1;
        self.capture += stage.capture;
        self.readback += stage.readback;
        self.crop += stage.crop;
        self.stillness += stillness;
    }

    fn report(&self, elapsed: Duration, ocr: Duration, scans: usize) {
        let mean = |time: Duration, count: usize| time.as_secs_f64() * 1000.0 / count.max(1) as f64;
        eprintln!(
            "Capture timings: {} samples in {:.2}s ({:.2} fps); mean capture {:.2} ms, readback {:.2} ms, crop {:.2} ms, stillness {:.2} ms, OCR {:.2} ms ({} views).",
            self.samples, elapsed.as_secs_f64(), self.samples as f64 / elapsed.as_secs_f64().max(0.001),
            mean(self.capture,self.samples), mean(self.readback,self.samples), mean(self.crop,self.samples),
            mean(self.stillness,self.samples), mean(ocr, scans), scans
        );
    }
}

pub(in crate::stamina) fn scan_while_scrolling(
    token: &AtomicU8,
    finished_uma: bool,
    updates: &Channel<ScanUpdate>,
) -> Result<(), &'static str> {
    if token.load(Ordering::Relaxed) != RUNNING {
        return Ok(());
    }
    let started = Instant::now();
    let deadline = started + SESSION_LIMIT;
    let mut capture = WindowCapture::open(false)?;
    let measure = std::env::var_os("UMALYTICS_CAPTURE_TIMINGS").as_deref() == Some("1".as_ref());
    #[cfg(debug_assertions)]
    let mut recorder = super::dump::SessionRecorder::new();
    thread::scope(|scope| {
        // A short queue preserves pauses while OCR reads the preceding view.
        let (send, frames) = mpsc::sync_channel(12);
        let ocr = scope.spawn(move || {
            let mut elapsed = Duration::ZERO;
            let mut scans = 0;
            while let Ok(frame) = frames.recv() {
                if token.load(Ordering::Relaxed) == CANCELLED {
                    break;
                }
                let start = Instant::now();
                let scan = ocr::scan_capture(frame)
                    .map_err(|_| "The captured game window could not be read.")?;
                elapsed += start.elapsed();
                scans += 1;
                if token.load(Ordering::Relaxed) == CANCELLED {
                    break;
                }
                if updates
                    .send(ScanUpdate::Screenshot(Box::new(scan)))
                    .is_err()
                {
                    break;
                }
            }
            Ok::<_, &'static str>((elapsed, scans))
        });
        let mut timings = Timings::default();
        let mut queued = 0;
        let result = (|| {
            let mut stillness = Stillness::default();
            let mut pending = None;
            let mut saw_frame = false;
            while token.load(Ordering::Relaxed) == RUNNING && !ocr.is_finished() && Instant::now() < deadline
            {
                let start = Instant::now();
                let mut stage = SampleTimings::default();
                let frame = capture.sample(INTERVAL, &mut stage)?;
                let sampled = Instant::now();
                if token.load(Ordering::Relaxed) != RUNNING || sampled >= deadline {
                    break;
                }
                if let Some(frame) = frame {
                    saw_frame = true;
                    let pixels = ListPixels::sample(&frame, finished_uma);
                    #[cfg(debug_assertions)]
                    if let Some(recorder) = &mut recorder {
                        recorder.record(&frame);
                    }
                    if let Some(pixels) = pixels {
                        stillness.observe(sampled, pixels);
                        pending = Some(frame);
                    } else {
                        stillness.reset();
                        pending = None;
                    }
                    timings.record(stage, sampled.elapsed());
                } else if !saw_frame && started.elapsed() >= Duration::from_secs(2) {
                    return Err(FAILED);
                }
                // WGC may stop emitting when the window stops changing.
                if let Some(frame) = pending.take_if(|_| stillness.ready(sampled)) {
                    match send.try_send(frame) {
                        Ok(()) => {
                            stillness.mark_scanned();
                            queued += 1;
                            if updates.send(ScanUpdate::Queued(queued)).is_err() {
                                break;
                            }
                        }
                        Err(mpsc::TrySendError::Full(frame)) => pending = Some(frame),
                        Err(mpsc::TrySendError::Disconnected(_)) => break,
                    }
                }
                thread::sleep(INTERVAL.saturating_sub(start.elapsed()));
            }
            Ok(())
        })();
        let sampling_time = started.elapsed();
        drop(capture);
        drop(send);
        let (ocr_time, scans) = ocr.join().map_err(|_| FAILED)??;
        if measure {
            timings.report(sampling_time, ocr_time, scans);
        }
        result
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires the Umamusume window to be open"]
    fn live_capture_timings() {
        let mut capture = WindowCapture::open(false).unwrap();
        let mut timings = Timings::default();
        let mut stillness = Stillness::default();
        let started = Instant::now();
        for _ in 0..25 {
            let start = Instant::now();
            let mut stage = SampleTimings::default();
            if let Some(frame) = capture.sample(INTERVAL, &mut stage).unwrap() {
                let sampled = Instant::now();
                if let Some(pixels) = ListPixels::from_frame(&frame) {
                    stillness.observe(sampled, pixels);
                    let _ = stillness.ready(sampled);
                }
                timings.record(stage, sampled.elapsed());
            }
            thread::sleep(INTERVAL.saturating_sub(start.elapsed()));
        }
        timings.report(started.elapsed(), Duration::ZERO, 0);
        assert!(timings.samples > 0, "Windows did not supply a frame");
    }

    #[test]
    #[ignore = "requires UMALYTICS_CAPTURE_REPLAY pointing to a recorded Learn frame"]
    fn capture_stage_timings() {
        use super::super::{crop_client, device, read_texture, Apartment};
        use std::{fs, io::BufReader};
        use windows::{
            Graphics::SizeInt32,
            Win32::{
                Foundation::RECT,
                Graphics::{
                    Direct3D::D3D_DRIVER_TYPE_WARP,
                    Direct3D11::{
                        D3D11CreateDevice, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
                        D3D11_SUBRESOURCE_DATA, D3D11_TEXTURE2D_DESC,
                    },
                    Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC},
                },
            },
        };

        let _apartment = Apartment::new().unwrap();
        let file = fs::File::open(std::env::var_os("UMALYTICS_CAPTURE_REPLAY").unwrap()).unwrap();
        let mut reader = png::Decoder::new(BufReader::new(file)).read_info().unwrap();
        let mut bgra = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut bgra).unwrap();
        assert_eq!(info.color_type, png::ColorType::Rgba);
        for pixel in bgra.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        let size = SizeInt32 {
            Width: info.width as i32,
            Height: info.height as i32,
        };
        let bounds = RECT {
            right: size.Width,
            bottom: size.Height,
            ..Default::default()
        };
        let pitch = info.width as usize * 4;
        let graphics = device()
            .map(|(device, context, _)| (device, context, "D3D11 hardware"))
            .or_else(|_| {
                let (mut device, mut context) = (None, None);
                unsafe {
                    D3D11CreateDevice(
                        None,
                        D3D_DRIVER_TYPE_WARP,
                        Default::default(),
                        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                        None,
                        D3D11_SDK_VERSION,
                        Some(&mut device),
                        None,
                        Some(&mut context),
                    )?;
                }
                Ok::<_, windows::core::Error>((device.unwrap(), context.unwrap(), "D3D11 WARP"))
            });

        let texture = graphics.as_ref().ok().map(|(device, _, backend)| {
            println!(
                "Replay source: {backend}, {}×{}; WGC arrival unavailable in replay.",
                size.Width, size.Height
            );
            let desc = D3D11_TEXTURE2D_DESC {
                Width: info.width,
                Height: info.height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                ..Default::default()
            };
            let data = D3D11_SUBRESOURCE_DATA {
                pSysMem: bgra.as_ptr().cast(),
                SysMemPitch: pitch as u32,
                SysMemSlicePitch: 0,
            };
            let mut texture = None;
            unsafe {
                device
                    .CreateTexture2D(&desc, Some(&data), Some(&mut texture))
                    .unwrap()
            };
            texture.unwrap()
        });
        if texture.is_none() {
            println!("Replay source: CPU; WGC arrival and Direct3D readback unavailable.");
        }
        let mut staging = None;
        let mut timings = Timings::default();
        let mut stillness = Stillness::default();
        let started = Instant::now();
        let (ocr, scans, wall) = thread::scope(|scope| {
            let (send, frames) = mpsc::sync_channel(12);
            let worker = scope.spawn(move || {
                let mut elapsed = Duration::ZERO;
                let mut count = 0;
                for frame in frames {
                    let start = Instant::now();
                    let scan = ocr::scan_capture(frame).unwrap();
                    assert_eq!(serde_json::to_value(scan).unwrap()["screen"], "learn");
                    elapsed += start.elapsed();
                    count += 1;
                }
                (elapsed, count)
            });
            for index in 0..25 {
                let start = Instant::now();
                let mut stage = SampleTimings::default();
                let frame = if let (Ok((device, context, _)), Some(texture)) = (&graphics, &texture)
                {
                    read_texture(
                        texture,
                        device,
                        context,
                        size,
                        (bounds, bounds),
                        &mut staging,
                        &mut stage,
                    )
                    .unwrap()
                } else {
                    let frame = crop_client(size, bounds, bounds, |y, col| {
                        bgra.get(y * pitch + col.start..y * pitch + col.end)
                    })
                    .unwrap();
                    stage.crop = start.elapsed();
                    frame
                };
                let observed = Instant::now();
                let pixels = ListPixels::from_frame(&frame).unwrap();
                if index % 5 == 0 {
                    stillness = Stillness::default();
                }
                stillness.observe(observed, pixels);
                if stillness.ready(observed) {
                    send.try_send(frame)
                        .unwrap_or_else(|_| panic!("Replay queue overflowed"));
                    stillness.mark_scanned();
                }
                timings.record(stage, observed.elapsed());
                thread::sleep(INTERVAL.saturating_sub(start.elapsed()));
            }
            let wall = started.elapsed();
            drop(send);
            let (ocr, scans) = worker.join().unwrap();
            (ocr, scans, wall)
        });
        timings.report(wall, ocr, scans);
        assert_eq!(scans, 5);
        assert!(timings.samples as f64 / wall.as_secs_f64() >= 4.0);
    }

    fn view(scroll: usize, noise: bool) -> ListPixels {
        let pixels = (0..SAMPLE_WIDTH * SAMPLE_HEIGHT)
            .map(|i| {
                let y = i / SAMPLE_WIDTH + scroll;
                let value = if y % 15 < 7 { 205 } else { 60 };
                [value + u8::from(noise), value, value]
            })
            .collect();
        ListPixels {
            bounds: [0, 0, 600, 400],
            pixels,
        }
    }

    #[test]
    fn skips_motion_accepts_pauses_and_dedupes_the_last_queued_view() {
        let start = Instant::now();
        let mut still = Stillness::default();
        let mut tick = |step, scroll, noise, expected| {
            let now = start + (STILL_TIME / 2) * step;
            still.observe(now, view(scroll, noise));
            assert_eq!(still.ready(now), expected);
            if expected {
                still.mark_scanned();
            }
        };
        tick(0, 0, false, false);
        tick(1, 1, false, false);
        tick(2, 3, false, false);
        tick(3, 3, true, false);
        tick(4, 3, false, true);
        tick(5, 3, false, false);
        tick(6, 6, false, false);
        tick(7, 6, false, false);
        tick(8, 6, false, true);
        tick(9, 3, false, false);
        tick(10, 3, false, false);
        tick(11, 3, false, true);
        tick(12, 3, false, false);
    }

    #[test]
    fn stopping_an_old_session_does_not_cancel_its_replacement() {
        let scans = ScrollingScans::default();
        let first = scans.start(1);
        let second = scans.start(2);
        assert_eq!(first.load(Ordering::Relaxed), CANCELLED);
        scans.stop(Some(1));
        scans.finish(&first);
        assert_eq!(second.load(Ordering::Relaxed), RUNNING);
        scans.drain(2);
        assert_eq!(second.load(Ordering::Relaxed), DRAINING);
        scans.stop(None);
        assert_eq!(second.load(Ordering::Relaxed), CANCELLED);
    }

    #[test]
    fn samples_the_list_and_ignores_animation_above_it() {
        let mut frame = Frame {
            width: 600,
            height: 400,
            bgra: vec![0; 600 * 400 * 4].into(),
        };
        let paint = |frame: &mut Frame,
                     xs: std::ops::Range<usize>,
                     ys: std::ops::Range<usize>,
                     color: [u8; 4]| {
            for y in ys {
                for x in xs.clone() {
                    let offset = (y * frame.width as usize + x) * 4;
                    Arc::get_mut(&mut frame.bgra).unwrap()[offset..offset + 4]
                        .copy_from_slice(&[color[2], color[1], color[0], color[3]]);
                }
            }
        };
        paint(&mut frame, 330..530, 10..29, [60, 210, 35, 255]);
        let initial = ListPixels::from_frame(&frame).unwrap();
        paint(&mut frame, 50..300, 50..110, [240, 220, 255, 255]);
        assert!(initial.same_view(&ListPixels::from_frame(&frame).unwrap()));
        paint(&mut frame, 115..210, 160..175, [240, 220, 255, 255]);
        assert!(!initial.same_view(&ListPixels::from_frame(&frame).unwrap()));
    }
}

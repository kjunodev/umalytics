use super::{Frame, WindowCapture, FAILED};
use crate::stamina::ocr::{self, Import};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

const INTERVAL: Duration = Duration::from_millis(250);
const STILL_TIME: Duration = Duration::from_millis(500);
const SESSION_LIMIT: Duration = Duration::from_secs(180);
const SAMPLE_WIDTH: usize = 96;
const SAMPLE_HEIGHT: usize = 72;

#[derive(Default)]
pub(crate) struct ScrollingScans(Mutex<Option<(u32, Arc<AtomicBool>)>>);

impl ScrollingScans {
    pub fn start(&self, id: u32) -> Arc<AtomicBool> {
        let mut active = self.0.lock().unwrap();
        let token = Arc::new(AtomicBool::new(false));
        if let Some((_, previous)) = active.replace((id, token.clone())) {
            previous.store(true, Ordering::Relaxed);
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
                token.store(true, Ordering::Relaxed);
            }
        }
    }

    pub fn finish(&self, token: &Arc<AtomicBool>) {
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
    Screenshot(Box<Import>),
    Finished(Option<&'static str>),
}

#[derive(Clone)]
struct ListPixels {
    bounds: [i32; 4],
    pixels: Vec<[u8; 3]>,
}

impl ListPixels {
    fn from_frame(frame: &Frame) -> Option<Self> {
        let at = |x: i32, y: i32| {
            let x = x.clamp(0, frame.width - 1);
            let y = y.clamp(0, frame.height - 1);
            let offset = (y as usize * frame.width as usize + x as usize) * 4;
            [
                frame.rgba[offset],
                frame.rgba[offset + 1],
                frame.rgba[offset + 2],
            ]
        };
        let banner = ocr::find_profile_banner(frame.width, frame.height, at)?;
        let width = banner.width();
        // The Learn list is below the SP bar and above Confirm, left of Career Profile.
        // Exclude the animated character, the scrollbar and the button below the list.
        let left = banner.left - width * 118 / 100;
        let top = banner.top + width * 60 / 100;
        let right = banner.left - width * 35 / 100;
        let bottom = banner.top + width * 133 / 100;
        if left < 0 || top < 0 || right > frame.width || bottom > frame.height {
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
    scanned: Vec<ListPixels>,
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
            && self
                .previous
                .as_ref()
                .is_some_and(|pixels| !self.scanned.iter().any(|scan| scan.same_view(pixels)))
    }

    fn mark_scanned(&mut self) {
        self.scanned.push(self.previous.as_ref().unwrap().clone());
    }

    fn reset(&mut self) {
        self.previous = None;
        self.anchor = None;
    }
}

pub(in crate::stamina) fn scan_while_scrolling(
    token: &AtomicBool,
    updates: &Channel<ScanUpdate>,
) -> Result<(), &'static str> {
    if token.load(Ordering::Relaxed) {
        return Ok(());
    }
    let started = Instant::now();
    let deadline = started + SESSION_LIMIT;
    let mut capture = WindowCapture::open(false)?;
    #[cfg(debug_assertions)]
    let mut recorder = super::dump::SessionRecorder::new();
    thread::scope(|scope| {
        // A short queue preserves pauses while OCR reads the preceding view.
        let (send, frames) = mpsc::sync_channel(2);
        let ocr = scope.spawn(move || {
            while let Ok(frame) = frames.recv() {
                if token.load(Ordering::Relaxed) || Instant::now() >= deadline {
                    break;
                }
                let scan = ocr::scan_rgba(frame)
                    .map_err(|_| "The captured game window could not be read.")?;
                if token.load(Ordering::Relaxed) || Instant::now() >= deadline {
                    break;
                }
                if updates
                    .send(ScanUpdate::Screenshot(Box::new(scan)))
                    .is_err()
                {
                    break;
                }
            }
            Ok(())
        });
        let result = (|| {
            let mut stillness = Stillness::default();
            let mut pending = None;
            let mut saw_frame = false;
            while !token.load(Ordering::Relaxed) && !ocr.is_finished() && Instant::now() < deadline
            {
                let start = Instant::now();
                let frame = capture.sample(INTERVAL)?;
                let sampled = Instant::now();
                if token.load(Ordering::Relaxed) || sampled >= deadline {
                    break;
                }
                if let Some(frame) = frame {
                    saw_frame = true;
                    let pixels = ListPixels::from_frame(&frame);
                    #[cfg(debug_assertions)]
                    recorder.record(&frame);
                    if let Some(pixels) = pixels {
                        stillness.observe(sampled, pixels);
                        pending = Some(frame);
                    } else {
                        stillness.reset();
                        pending = None;
                    }
                } else if !saw_frame && started.elapsed() >= Duration::from_secs(2) {
                    return Err(FAILED);
                }
                // WGC may stop emitting when the window stops changing.
                if let Some(frame) = pending.take_if(|_| stillness.ready(sampled)) {
                    match send.try_send(frame) {
                        Ok(()) => stillness.mark_scanned(),
                        Err(mpsc::TrySendError::Full(frame)) => pending = Some(frame),
                        Err(mpsc::TrySendError::Disconnected(_)) => break,
                    }
                }
                thread::sleep(INTERVAL.saturating_sub(start.elapsed()));
            }
            Ok(())
        })();
        drop(capture);
        drop(send);
        let ocr_result = ocr.join().map_err(|_| FAILED)?;
        result.and(ocr_result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn skips_motion_accepts_pauses_and_dedupes_previously_scanned_views() {
        let start = Instant::now();
        let mut still = Stillness::default();
        let mut tick = |step, scroll, noise, expected| {
            let now = start + INTERVAL * step;
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
        tick(11, 3, false, false);
        assert_eq!(still.scanned.len(), 2);
    }

    #[test]
    fn stopping_an_old_session_does_not_cancel_its_replacement() {
        let scans = ScrollingScans::default();
        let first = scans.start(1);
        let second = scans.start(2);
        assert!(first.load(Ordering::Relaxed));
        scans.stop(Some(1));
        scans.finish(&first);
        assert!(!second.load(Ordering::Relaxed));
        scans.stop(None);
        assert!(second.load(Ordering::Relaxed));
    }

    #[test]
    fn samples_the_list_and_ignores_animation_above_it() {
        let mut frame = Frame {
            width: 600,
            height: 400,
            rgba: vec![0; 600 * 400 * 4],
        };
        let paint = |frame: &mut Frame,
                     xs: std::ops::Range<usize>,
                     ys: std::ops::Range<usize>,
                     color: [u8; 4]| {
            for y in ys {
                for x in xs.clone() {
                    let offset = (y * frame.width as usize + x) * 4;
                    frame.rgba[offset..offset + 4].copy_from_slice(&color);
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

use super::Frame;
use std::{
    fs::{self, OpenOptions},
    io::{self, ErrorKind},
    path::{self, Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

fn outside_git(path: &Path) -> io::Result<PathBuf> {
    // Check the canonical ancestors before creating missing directories, including through junctions.
    let path = path::absolute(path)?;
    let mut missing = Vec::new();
    for ancestor in path.ancestors() {
        match ancestor.canonicalize() {
            Ok(mut canonical) => {
                for parent in canonical.ancestors() {
                    match parent.join(".git").symlink_metadata() {
                        Err(error) if error.kind() == ErrorKind::NotFound => {}
                        Err(error) => return Err(error),
                        Ok(_) => {
                            return Err(io::Error::other(
                                "Capture dump folder is inside a Git worktree",
                            ))
                        }
                    }
                }
                for component in missing.into_iter().rev() {
                    canonical.push(component);
                }
                return Ok(canonical);
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let Some(Component::Normal(component)) = ancestor.components().next_back() else {
                    return Err(error);
                };
                missing.push(component);
            }
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other("Could not resolve capture dump folder"))
}

fn save(folder: &Path, frame: &Frame) -> Result<(), Box<dyn std::error::Error>> {
    let folder = outside_git(folder)?;
    fs::create_dir_all(&folder)?;
    let folder = outside_git(&folder)?;
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let time = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let pid = std::process::id();
    save_png(
        &folder.join(format!("capture-{time}-{pid}-{sequence}.png")),
        frame,
    )
}

fn save_png(path: &Path, frame: &Frame) -> Result<(), Box<dyn std::error::Error>> {
    let file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let mut encoder = png::Encoder::new(file, frame.width as u32, frame.height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut png = encoder.write_header()?;
    let rgba: Vec<[u8; 4]> = frame
        .bgra
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&[b, g, r, a]| [r, g, b, a])
        .collect();
    png.write_image_data(rgba.as_flattened())?;
    png.finish()?;
    Ok(())
}

pub(super) struct SessionRecorder {
    sender: mpsc::SyncSender<(String, Frame)>,
    start: std::time::Instant,
    next: u32,
    dropped: usize,
}

impl SessionRecorder {
    pub fn new() -> Option<Self> {
        if std::env::var_os("UMALYTICS_CAPTURE_DUMP_RAW").as_deref() != Some("1".as_ref()) {
            return None;
        }
        let folder =
            std::env::var_os("UMALYTICS_CAPTURE_DUMP").filter(|folder| !folder.is_empty())?;
        let (sender, frames) = mpsc::sync_channel::<(String, Frame)>(8);
        let worker = std::thread::Builder::new()
            .name("capture-png".into())
            .spawn(move || {
                let result = (|| -> Result<(), Box<dyn std::error::Error>> {
                    let folder = outside_git(Path::new(&folder))?;
                    let stamp = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map_err(io::Error::other)?
                        .as_nanos();
                    let session = folder.join(format!("scroll-{stamp}-{}", std::process::id()));
                    fs::create_dir_all(&session)?;
                    for (name, frame) in frames {
                        let checked = outside_git(&session)?;
                        save_png(&checked.join(name), &frame)?;
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    eprintln!("Could not save scrolling frames: {error}");
                }
            });
        if let Err(error) = worker {
            eprintln!("Could not start scrolling recorder: {error}");
            return None;
        }
        Some(Self {
            sender,
            start: std::time::Instant::now(),
            next: 0,
            dropped: 0,
        })
    }

    pub fn record(&mut self, frame: &Frame) {
        let millis = self.start.elapsed().as_millis();
        let name = format!("frame-{:04}-{millis:06}ms.png", self.next);
        self.next += 1;
        if self.sender.try_send((name, frame.clone())).is_err() {
            self.dropped += 1;
        }
    }
}

impl Drop for SessionRecorder {
    fn drop(&mut self) {
        if self.dropped > 0 {
            eprintln!(
                "Scrolling recorder skipped {} of {} samples while saving PNGs.",
                self.dropped, self.next
            );
        }
    }
}
pub(super) fn record(frame: &Frame) {
    if let Some(folder) = std::env::var_os("UMALYTICS_CAPTURE_DUMP") {
        if !folder.is_empty() {
            if let Err(error) = save(Path::new(&folder), frame) {
                eprintln!("Could not save capture PNG: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorder_writes_png_and_refuses_git_worktrees_before_creating_directories() {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "umalytics-capture-test-{}-{time}",
            std::process::id()
        ));
        let frame = Frame {
            width: 1,
            height: 1,
            bgra: vec![30, 20, 10, 255].into(),
        };
        save(&root, &frame).unwrap();
        let png = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
        let file = fs::File::open(&png).unwrap();
        let mut reader = png::Decoder::new(io::BufReader::new(file))
            .read_info()
            .unwrap();
        let mut bytes = [0; 4];
        reader.next_frame(&mut bytes).unwrap();
        assert_eq!(bytes, [10, 20, 30, 255]);
        drop(reader);
        fs::remove_file(png).unwrap();

        // A linked worktree has a .git file instead of a directory.
        let git = root.join(".git");
        fs::write(&git, "gitdir: elsewhere").unwrap();
        assert!(save(&root, &frame).is_err());
        let nested = root.join("missing/nested");
        assert!(save(&nested, &frame).is_err());
        assert!(!root.join("missing").exists());
        fs::remove_file(git).unwrap();
        fs::remove_dir(root).unwrap();
    }
}

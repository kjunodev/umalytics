use super::Frame;
use std::{
    fs::{self, OpenOptions},
    io::{self, ErrorKind},
    path::{self, Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
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
    png.write_image_data(&frame.rgba)?;
    png.finish()?;
    Ok(())
}

pub(super) struct SessionRecorder {
    folder: Option<PathBuf>,
    start: std::time::Instant,
    next: u32,
}

impl SessionRecorder {
    pub fn new() -> Self {
        let folder = (std::env::var_os("UMALYTICS_CAPTURE_DUMP_RAW").as_deref()
            == Some("1".as_ref()))
        .then(|| std::env::var_os("UMALYTICS_CAPTURE_DUMP"))
        .flatten()
        .filter(|folder| !folder.is_empty())
        .and_then(|folder| {
            let result = (|| {
                let folder = outside_git(Path::new(&folder))?;
                let stamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(io::Error::other)?
                    .as_nanos();
                let session = folder.join(format!("scroll-{stamp}-{}", std::process::id()));
                fs::create_dir_all(&session)?;
                outside_git(&session)
            })();
            match result {
                Ok(path) => Some(path),
                Err(error) => {
                    eprintln!("Could not open scrolling capture folder: {error}");
                    None
                }
            }
        });
        Self {
            folder,
            start: std::time::Instant::now(),
            next: 0,
        }
    }

    pub fn record(&mut self, frame: &Frame) {
        let Some(folder) = &self.folder else {
            return;
        };
        let millis = self.start.elapsed().as_millis();
        let name = format!("frame-{:04}-{millis:06}ms.png", self.next);
        self.next += 1;
        if let Err(error) = outside_git(folder)
            .map_err(Into::into)
            .and_then(|folder| save_png(&folder.join(name), frame))
        {
            eprintln!("Could not save scrolling frame: {error}");
            self.folder = None;
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
            rgba: vec![10, 20, 30, 255],
        };
        save(&root, &frame).unwrap();
        let png = fs::read_dir(&root).unwrap().next().unwrap().unwrap().path();
        let file = fs::File::open(&png).unwrap();
        let mut reader = png::Decoder::new(io::BufReader::new(file))
            .read_info()
            .unwrap();
        let mut bytes = [0; 4];
        reader.next_frame(&mut bytes).unwrap();
        assert_eq!(bytes, frame.rgba.as_slice());
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

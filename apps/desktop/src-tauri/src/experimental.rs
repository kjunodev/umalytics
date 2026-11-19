use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Manager;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExperimentalSettings {
    screenshot_import: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ForceSource {
    Debug,
    Environment,
}

fn forced_by(debug: bool, experimental: Option<&OsStr>) -> Option<ForceSource> {
    if debug {
        Some(ForceSource::Debug)
    } else if experimental == Some(OsStr::new("1")) {
        Some(ForceSource::Environment)
    } else {
        None
    }
}

fn saved_choice(path: &Path) -> bool {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ExperimentalSettings>(&bytes).ok())
        .is_some_and(|settings| settings.screenshot_import)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("experimental.json"))
        .map_err(|error| error.to_string())
}

fn write_choice(path: &Path, saved: bool) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or("The app config directory is unavailable.")?;
    let settings = ExperimentalSettings {
        screenshot_import: saved,
    };
    let bytes = serde_json::to_vec(&settings).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    let result = fs::create_dir_all(dir)
        .and_then(|_| fs::write(&temp, bytes))
        .and_then(|_| fs::rename(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|error| format!("Unable to save the screenshot import setting: {error}"))
}

pub(crate) struct ScreenshotImportAccess {
    enabled: AtomicBool,
    saved: Mutex<bool>,
    forced_by: Option<ForceSource>,
}

impl ScreenshotImportAccess {
    fn new(saved: bool, forced_by: Option<ForceSource>) -> Self {
        Self {
            enabled: AtomicBool::new(saved || forced_by.is_some()),
            saved: Mutex::new(saved),
            forced_by,
        }
    }

    pub(crate) fn load(app: &tauri::AppHandle) -> Self {
        let saved = settings_path(app).is_ok_and(|path| saved_choice(&path));
        let source = forced_by(
            cfg!(debug_assertions),
            std::env::var_os("UMALYTICS_EXPERIMENTAL").as_deref(),
        );
        Self::new(saved, source)
    }

    pub(crate) fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    fn setting(&self, saved: bool) -> ScreenshotImportSetting {
        ScreenshotImportSetting {
            supported: cfg!(windows),
            saved,
            enabled: cfg!(windows) && self.enabled(),
            forced_by: self.forced_by,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenshotImportSetting {
    supported: bool,
    saved: bool,
    enabled: bool,
    forced_by: Option<ForceSource>,
}

#[tauri::command]
pub(crate) fn get_screenshot_import_setting(
    access: tauri::State<'_, ScreenshotImportAccess>,
) -> Result<ScreenshotImportSetting, String> {
    let saved = access.saved.lock().map_err(|error| error.to_string())?;
    Ok(access.setting(*saved))
}

#[tauri::command]
pub(crate) fn set_screenshot_import_setting(
    app: tauri::AppHandle,
    access: tauri::State<'_, ScreenshotImportAccess>,
    enabled: bool,
) -> Result<ScreenshotImportSetting, String> {
    if !cfg!(windows) {
        return Err("Screenshot import is unsupported on this platform.".into());
    }
    let mut saved = access.saved.lock().map_err(|error| error.to_string())?;
    write_choice(&settings_path(&app)?, enabled)?;
    *saved = enabled;
    access
        .enabled
        .store(enabled || access.forced_by.is_some(), Ordering::Relaxed);
    #[cfg(windows)]
    if !access.enabled() {
        app.state::<crate::stamina::capture::CaptureShortcut>()
            .clear();
        app.state::<crate::stamina::capture::ScrollingScans>()
            .stop(None);
    }
    Ok(access.setting(*saved))
}

#[cfg(test)]
#[path = "../../../../tests/desktop-experimental.rs"]
mod tests;

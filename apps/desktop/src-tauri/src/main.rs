#![cfg_attr(all(not(debug_assertions), not(test)), windows_subsystem = "windows")]

mod feed;
mod resources;
mod stamina;
mod wire;

use feed::{Feed, FeedStatus};
use tauri::Manager;

struct ScreenshotImportAccess(bool);

fn screenshot_import_enabled(debug: bool, experimental: Option<&std::ffi::OsStr>) -> bool {
    debug || experimental == Some(std::ffi::OsStr::new("1"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_import_is_opt_in_for_release_and_always_on_in_debug() {
        for flag in [None, Some(""), Some("0"), Some("true"), Some("1")] {
            let experimental = flag.map(std::ffi::OsStr::new);
            assert_eq!(
                screenshot_import_enabled(false, experimental),
                flag == Some("1")
            );
            assert!(screenshot_import_enabled(true, experimental));
        }
    }
}

#[tauri::command]
async fn start_feed(
    app: tauri::AppHandle,
    feed: tauri::State<'_, Feed>,
) -> Result<FeedStatus, String> {
    feed.start(app).await
}

fn main() {
    let screenshot_import = ScreenshotImportAccess(screenshot_import_enabled(
        cfg!(debug_assertions),
        std::env::var_os("UMALYTICS_EXPERIMENTAL").as_deref(),
    ));
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            resources::initialize(app.path().resource_dir().map_err(|error| error.to_string()));
            Ok(())
        })
        .manage(Feed::default())
        .manage(screenshot_import)
        .manage(stamina::Checks::default())
        .invoke_handler(tauri::generate_handler![
            start_feed,
            stamina::engine_catalog,
            #[cfg(windows)]
            stamina::scan_stamina_screenshot,
            stamina::stamina_check,
            stamina::stamina_check_races,
            stamina::cancel_stamina_check
        ])
        .run(tauri::generate_context!())
        .expect("Unable to run UmaLytics desktop");
}

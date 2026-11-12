#![cfg_attr(all(not(debug_assertions), not(test)), windows_subsystem = "windows")]

mod feed;
mod resources;
mod stamina;
mod wire;

use feed::{Feed, FeedStatus};
use tauri::Manager;

#[tauri::command]
async fn start_feed(
    app: tauri::AppHandle,
    feed: tauri::State<'_, Feed>,
) -> Result<FeedStatus, String> {
    feed.start(app).await
}

fn main() {
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

#![cfg_attr(all(not(debug_assertions), not(test)), windows_subsystem = "windows")]

mod feed;
mod stamina;
mod wire;

use feed::{Feed, FeedStatus};

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
        .manage(Feed::default())
        .manage(stamina::Checks::default())
        .invoke_handler(tauri::generate_handler![
            start_feed,
            stamina::engine_catalog,
            stamina::stamina_check,
            stamina::stamina_check_races,
            stamina::cancel_stamina_check
        ])
        .run(tauri::generate_context!())
        .expect("Unable to run UmaLytics desktop");
}

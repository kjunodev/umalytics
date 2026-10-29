#![cfg_attr(all(not(debug_assertions), not(test)), windows_subsystem = "windows")]

mod feed;
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Feed::default())
        .invoke_handler(tauri::generate_handler![start_feed])
        .run(tauri::generate_context!())
        .expect("Unable to run UmaLytics desktop");
}

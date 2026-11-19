#![cfg_attr(all(not(debug_assertions), not(test)), windows_subsystem = "windows")]

mod experimental;
mod feed;
mod resources;
mod stamina;
mod wire;

use experimental::ScreenshotImportAccess;
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
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder
        .manage(stamina::capture::CaptureShortcut::default())
        .manage(stamina::capture::ScrollingScans::default())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                webview.state::<stamina::capture::CaptureShortcut>().clear();
                webview.state::<stamina::capture::ScrollingScans>().stop(None);
            }
        });
    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
                let menu = Menu::with_items(app, &[
                    &Submenu::with_items(app, "UmaLytics", true, &[
                        &PredefinedMenuItem::about(app, None, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, None)?,
                    ])?,
                    &Submenu::with_items(app, "Edit", true, &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::select_all(app, None)?,
                    ])?,
                ])?;
                app.set_menu(menu)?;
            }
            resources::initialize(app.path().resource_dir().map_err(|error| error.to_string()));
            app.manage(ScreenshotImportAccess::load(app.handle()));
            Ok(())
        })
        .manage(Feed::default())
        .manage(stamina::Checks::default())
        .invoke_handler(tauri::generate_handler![
            start_feed,
            experimental::get_screenshot_import_setting,
            experimental::set_screenshot_import_setting,
            stamina::engine_catalog,
            #[cfg(windows)]
            stamina::scan_stamina_screenshot,
            #[cfg(windows)]
            stamina::capture_stamina_screenshot,
            #[cfg(windows)]
            stamina::set_stamina_capture_hotkey,
            #[cfg(windows)]
            stamina::scan_stamina_while_scrolling,
            #[cfg(windows)]
            stamina::stop_stamina_scrolling_scan,
            stamina::stamina_check,
            stamina::stamina_check_races,
            stamina::cancel_stamina_check
        ])
        .run(tauri::generate_context!())
        .expect("Unable to run UmaLytics desktop");
}

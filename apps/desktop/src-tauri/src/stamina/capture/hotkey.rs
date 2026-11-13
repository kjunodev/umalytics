use std::{
    sync::{mpsc, Mutex},
    thread,
};
use tauri::{Emitter, WebviewWindow};
use windows::Win32::{
    Foundation::{ERROR_HOTKEY_ALREADY_REGISTERED, LPARAM, WPARAM},
    System::Threading::GetCurrentThreadId,
    UI::{
        Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, VK_U,
        },
        WindowsAndMessaging::{
            GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_HOTKEY, WM_QUIT,
        },
    },
};

const ID: i32 = 1;
const FAILED: &str = "The capture shortcut could not be registered.";

#[derive(Default)]
pub(crate) struct CaptureShortcut(Mutex<Option<Registration>>);

impl CaptureShortcut {
    pub fn clear(&self) {
        self.0.lock().unwrap().take();
    }

    pub fn register(&self, window: WebviewWindow) -> Result<(), &'static str> {
        let mut active = self.0.lock().unwrap();
        active.take();
        *active = Some(Registration::start(window)?);
        Ok(())
    }
}

struct Registration {
    thread_id: u32,
    thread: Option<thread::JoinHandle<()>>,
}

impl Registration {
    fn start(window: WebviewWindow) -> Result<Self, &'static str> {
        let (ready, status) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("capture-hotkey".into())
            .spawn(move || {
                // A thread-owned message queue avoids creating or activating a window.
                let mut message = MSG::default();
                unsafe {
                    let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
                    let result = RegisterHotKey(
                        None,
                        ID,
                        MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
                        VK_U.0.into(),
                    );
                    if let Err(error) = result {
                        let reason = if error.code() == ERROR_HOTKEY_ALREADY_REGISTERED.to_hresult()
                        {
                            "Ctrl+Shift+U is already in use."
                        } else {
                            FAILED
                        };
                        let _ = ready.send(Err(reason));
                        return;
                    }
                    if ready.send(Ok(GetCurrentThreadId())).is_ok() {
                        while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                            if message.message == WM_HOTKEY && message.wParam.0 == ID as usize {
                                let _ =
                                    window.emit_to(window.label(), "stamina-capture-hotkey", ());
                            }
                        }
                    }
                    let _ = UnregisterHotKey(None, ID);
                }
            })
            .map_err(|_| FAILED)?;
        let thread_id = status.recv().map_err(|_| FAILED)??;
        Ok(Self {
            thread_id,
            thread: Some(thread),
        })
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        // The worker creates its message queue before returning its ID.
        if unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) }.is_ok() {
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

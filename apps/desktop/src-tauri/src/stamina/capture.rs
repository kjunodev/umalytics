#[cfg(debug_assertions)]
mod dump;
mod hotkey;
mod scrolling;
pub(crate) use hotkey::CaptureShortcut;
pub(super) use scrolling::scan_while_scrolling;
pub(crate) use scrolling::ScanUpdate;
pub(crate) use scrolling::ScrollingScans;

use super::ocr::Apartment;
use std::{
    mem::size_of,
    ops::Range,
    slice,
    sync::{mpsc, OnceLock},
    time::{Duration, Instant},
};
use windows::{
    core::{factory, Interface, PWSTR},
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::{
            Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureAccess,
            GraphicsCaptureAccessKind, GraphicsCaptureItem, GraphicsCaptureSession,
        },
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        SizeInt32,
    },
    Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus,
    Win32::{
        Foundation::{CloseHandle, E_NOINTERFACE, E_POINTER, HWND, LPARAM, POINT, RECT, S_OK},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{
                D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
                D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
                D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
            },
            Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
            Dxgi::IDXGIDevice,
            Gdi::ClientToScreen,
        },
        System::{
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
            WinRT::{
                Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
                Graphics::Capture::IGraphicsCaptureItemInterop,
            },
        },
        UI::{
            HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            WindowsAndMessaging::{
                EnumWindows, GetClientRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
                IsWindow, IsWindowVisible,
            },
        },
    },
};

pub(super) const FAILED: &str = "The game window could not be captured.";
const MINIMIZED: &str = "Restore the minimized Umamusume window before capturing.";
const UNSUPPORTED: &str = "Game window capture is unsupported on this Windows build.";
const GAME_TITLE: &str = "Umamusume";
const GAME_EXE: &str = "UmamusumePrettyDerby.exe";
const FORMAT: DirectXPixelFormat = DirectXPixelFormat::B8G8R8A8UIntNormalized;

pub(super) struct Frame {
    pub width: i32,
    pub height: i32,
    pub rgba: Vec<u8>,
}

fn is_game_window(title: &str, executable: &str) -> bool {
    title == GAME_TITLE && executable.eq_ignore_ascii_case(GAME_EXE)
}

fn game_window() -> Option<HWND> {
    // EnumWindows calls back synchronously, with a pointer to this stack slot.
    let mut found = None;
    unsafe {
        let _ = EnumWindows(
            Some(match_window),
            LPARAM(&mut found as *mut Option<HWND> as isize),
        );
    }
    found
}

unsafe extern "system" fn match_window(hwnd: HWND, data: LPARAM) -> windows::core::BOOL {
    // Leave space for one extra character so a longer title cannot match through truncation.
    let mut title = [0; GAME_TITLE.len() + 2];
    let len = unsafe { GetWindowTextW(hwnd, &mut title) } as usize;
    if len != GAME_TITLE.len() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return true.into();
    }
    let title = String::from_utf16_lossy(&title[..len]);
    if title != GAME_TITLE {
        return true.into();
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
    else {
        return true.into();
    };
    let mut path = vec![0u16; 32_768];
    let mut len = path.len() as u32;
    let result = unsafe {
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(path.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(process);
        result
    };
    if result.is_ok() {
        let path = String::from_utf16_lossy(&path[..len as usize]);
        let executable = path.rsplit('\\').next().unwrap_or_default();
        if is_game_window(&title, executable) {
            // Prefer a usable window if more than one client is running.
            let minimized = unsafe { IsIconic(hwnd) }.as_bool();
            let found = unsafe { &mut *(data.0 as *mut Option<HWND>) };
            if found.is_none() || !minimized {
                *found = Some(hwnd);
            }
            return minimized.into();
        }
    }
    true.into()
}

fn client_bounds(hwnd: HWND) -> windows::core::Result<(RECT, RECT)> {
    // WGC and DWM use physical pixels. Temporarily disable DPI virtualization for the client rect.
    unsafe {
        let previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let result = (|| {
            let mut client = RECT::default();
            let mut window = RECT::default();
            GetClientRect(hwnd, &mut client)?;
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&mut window as *mut RECT).cast(),
                size_of::<RECT>() as u32,
            )?;
            let mut origin = POINT::default();
            let mut corner = POINT {
                x: client.right,
                y: client.bottom,
            };
            ClientToScreen(hwnd, &mut origin).ok()?;
            ClientToScreen(hwnd, &mut corner).ok()?;
            client.left = origin.x;
            client.top = origin.y;
            client.right = corner.x;
            client.bottom = corner.y;
            Ok((window, client))
        })();
        if !previous.is_invalid() {
            SetThreadDpiAwarenessContext(previous);
        }
        result
    }
}

fn client_rgba<'a>(
    size: SizeInt32,
    window: RECT,
    client: RECT,
    mut row_bytes: impl FnMut(usize, Range<usize>) -> Option<&'a [u8]>,
) -> Option<Frame> {
    let SizeInt32 {
        Width: width,
        Height: height,
    } = size;
    if width <= 0 || height <= 0 {
        return None;
    }
    let left = (client.left - window.left).clamp(0, width) as usize;
    let top = (client.top - window.top).clamp(0, height) as usize;
    let right = (client.right - window.left).clamp(0, width) as usize;
    let bottom = (client.bottom - window.top).clamp(0, height) as usize;
    if right <= left || bottom <= top {
        return None;
    }
    let mut rgba = Vec::with_capacity((right - left) * (bottom - top) * 4);
    for y in top..bottom {
        let row = row_bytes(y, left * 4..right * 4)?;
        for &[blue, green, red, alpha] in row.as_chunks::<4>().0 {
            rgba.extend([red, green, blue, alpha]);
        }
    }
    Some(Frame {
        width: (right - left) as i32,
        height: (bottom - top) as i32,
        rgba,
    })
}

fn device() -> windows::core::Result<(ID3D11Device, ID3D11DeviceContext, IDirect3DDevice)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            Default::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
        let device = device.ok_or(E_POINTER)?;
        let context = context.ok_or(E_POINTER)?;
        let dxgi: IDXGIDevice = device.cast()?;
        let winrt = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;
        Ok((device, context, winrt))
    }
}

fn borderless(may_prompt: bool) -> bool {
    static ALLOWED: OnceLock<bool> = OnceLock::new();
    if may_prompt {
        *ALLOWED.get_or_init(|| {
            GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless)
                .and_then(|request| request.join())
                .is_ok_and(|status| status == AppCapabilityAccessStatus::Allowed)
        })
    } else {
        // A global hotkey can be pressed from the game, where a consent prompt could take focus.
        ALLOWED.get().copied().unwrap_or(false)
    }
}

fn read_frame(
    frame: &Direct3D11CaptureFrame,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    window: RECT,
    client: RECT,
) -> Result<Frame, &'static str> {
    let size = frame.ContentSize().map_err(|_| FAILED)?;
    let access: IDirect3DDxgiInterfaceAccess = frame
        .Surface()
        .and_then(|surface| surface.cast())
        .map_err(|_| FAILED)?;
    // The surface, texture and immediate context remain on this worker through the readback.
    unsafe {
        let texture: ID3D11Texture2D = access.GetInterface().map_err(|_| FAILED)?;
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        texture.GetDesc(&mut desc);
        if size.Width <= 0
            || size.Height <= 0
            || size.Width as u32 > desc.Width
            || size.Height as u32 > desc.Height
        {
            return Err(FAILED);
        }
        desc.Usage = D3D11_USAGE_STAGING;
        desc.BindFlags = 0;
        desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
        desc.MiscFlags = 0;
        let mut staging = None;
        device
            .CreateTexture2D(&desc, None, Some(&mut staging))
            .map_err(|_| FAILED)?;
        let staging = staging.ok_or(FAILED)?;
        context.CopyResource(&staging, &texture);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context
            .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .map_err(|_| FAILED)?;
        let pitch = mapped.RowPitch as usize;
        let data = mapped.pData.cast::<u8>();
        let result = if !data.is_null() && pitch >= size.Width as usize * 4 {
            client_rgba(size, window, client, |y, columns| {
                // Each span stays inside initialized content and is consumed before Unmap.
                Some(slice::from_raw_parts(
                    data.add(y * pitch + columns.start),
                    columns.len(),
                ))
            })
            .ok_or(FAILED)
        } else {
            Err(FAILED)
        };
        context.Unmap(&staging, 0);
        result
    }
}

struct WindowCapture {
    hwnd: HWND,
    session: Option<GraphicsCaptureSession>,
    pool: Direct3D11CaptureFramePool,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt: IDirect3DDevice,
    size: SizeInt32,
    ready: mpsc::Receiver<()>,
    _apartment: Apartment,
}

impl WindowCapture {
    fn open(may_prompt: bool) -> Result<Self, &'static str> {
        let hwnd = game_window().ok_or("Umamusume is not running.")?;
        if unsafe { IsIconic(hwnd) }.as_bool() {
            return Err(MINIMIZED);
        }
        let apartment = Apartment::new().map_err(|_| FAILED)?;
        if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
            return Err(UNSUPPORTED);
        }
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|_| UNSUPPORTED)?;
        let item: GraphicsCaptureItem =
            unsafe { interop.CreateForWindow(hwnd) }.map_err(|_| FAILED)?;
        let (device, context, winrt) = device().map_err(|_| FAILED)?;
        let size = item.Size().map_err(|_| FAILED)?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt, FORMAT, 1, size)
            .map_err(|_| FAILED)?;
        let (send, ready) = mpsc::sync_channel(1);
        let mut capture = Self {
            hwnd,
            session: None,
            pool,
            device,
            context,
            winrt,
            size,
            ready,
            _apartment: apartment,
        };
        let session = capture
            .pool
            .CreateCaptureSession(&item)
            .map_err(|_| FAILED)?;
        capture.session = Some(session);
        let session = capture.session.as_ref().unwrap();
        session.SetIsCursorCaptureEnabled(false).map_err(|error| {
            if error.code() == E_NOINTERFACE {
                UNSUPPORTED
            } else {
                FAILED
            }
        })?;
        if borderless(may_prompt) {
            let _ = session.SetIsBorderRequired(false);
        }
        capture
            .pool
            .FrameArrived(&TypedEventHandler::new(move |_, _| {
                let _ = send.try_send(());
                Ok(())
            }))
            .map_err(|_| FAILED)?;
        session.StartCapture().map_err(|_| FAILED)?;
        Ok(capture)
    }

    fn check_window(&self) -> Result<(), &'static str> {
        if !unsafe { IsWindow(Some(self.hwnd)) }.as_bool() {
            return Err("Umamusume is not running.");
        }
        if unsafe { IsIconic(self.hwnd) }.as_bool() {
            return Err(MINIMIZED);
        }
        Ok(())
    }

    fn sample(&mut self, timeout: Duration) -> Result<Option<Frame>, &'static str> {
        self.check_window()?;
        let ready = self.ready.recv_timeout(timeout);
        self.check_window()?;
        match ready {
            Ok(()) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => return Ok(None),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(FAILED),
        }
        let frame = match self.pool.TryGetNextFrame() {
            Ok(frame) => frame,
            // A notification can outlive its frame when the pool is recreated.
            Err(error) if error.code() == S_OK => return Ok(None),
            Err(_) => return Err(FAILED),
        };
        let size = frame.ContentSize().map_err(|_| FAILED)?;
        if size != self.size {
            drop(frame);
            self.pool
                .Recreate(&self.winrt, FORMAT, 1, size)
                .map_err(|_| FAILED)?;
            self.size = size;
            return Ok(None);
        }
        let bounds = client_bounds(self.hwnd);
        self.check_window()?;
        let (window, client) = bounds.map_err(|_| FAILED)?;
        let result = read_frame(&frame, &self.device, &self.context, window, client);
        self.check_window()?;
        result.map(Some)
    }
}

impl Drop for WindowCapture {
    fn drop(&mut self) {
        if let Some(session) = self.session.take() {
            let _ = session.Close();
        }
        let _ = self.pool.Close();
    }
}

pub(super) fn capture(may_prompt: bool) -> Result<Frame, &'static str> {
    let mut capture = WindowCapture::open(may_prompt)?;
    let deadline = Instant::now() + Duration::from_secs(2);
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        if let Some(frame) = capture.sample(remaining)? {
            drop(capture);
            #[cfg(debug_assertions)]
            dump::record(&frame);
            return Ok(frame);
        }
    }
    Err(FAILED)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn convert(
        bgra: &[u8],
        pitch: usize,
        size: SizeInt32,
        window: RECT,
        client: RECT,
    ) -> Option<Frame> {
        client_rgba(size, window, client, |y, columns| {
            bgra.get(y * pitch + columns.start..y * pitch + columns.end)
        })
    }

    #[test]
    fn requires_game_title_and_executable() {
        assert!(is_game_window("Umamusume", "UmamusumePrettyDerby.exe"));
        assert!(is_game_window("Umamusume", "UMAMUSUMEPRETTYDERBY.EXE"));
        assert!(!is_game_window("Umamusume", "notepad.exe"));
        assert!(!is_game_window("Other window", "UmamusumePrettyDerby.exe"));
        assert!(!is_game_window(
            "Umamusume launcher",
            "UmamusumePrettyDerby.exe"
        ));
        assert!(!is_game_window("Umamusume", "UmamusumePrettyDerby.exe.bak"));
    }

    #[test]
    fn converts_bgra_to_rgba_preserving_alpha() {
        let rect = RECT {
            left: 0,
            top: 0,
            right: 2,
            bottom: 1,
        };
        let size = SizeInt32 {
            Width: 2,
            Height: 1,
        };
        let frame = convert(&[3, 2, 1, 4, 7, 6, 5, 8], 8, size, rect, rect).unwrap();
        assert_eq!(frame.rgba, [1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn crops_client_area_using_screen_coordinates_and_row_pitch() {
        let window = RECT {
            left: -8,
            top: 5,
            right: -4,
            bottom: 9,
        };
        let client = RECT {
            left: -7,
            top: 6,
            right: -5,
            bottom: 8,
        };
        let size = SizeInt32 {
            Width: 4,
            Height: 4,
        };
        let mut bgra = [0; 4 * 20];
        bgra[24..32].copy_from_slice(&[1, 2, 3, 255, 4, 5, 6, 255]);
        bgra[44..52].copy_from_slice(&[7, 8, 9, 255, 10, 11, 12, 255]);
        let frame = convert(&bgra, 20, size, window, client).unwrap();
        assert_eq!((frame.width, frame.height), (2, 2));
        assert_eq!(
            frame.rgba,
            [3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255, 12, 11, 10, 255]
        );
        assert!(convert(&bgra[..50], 20, size, window, client).is_none());
        let outside = RECT {
            left: 0,
            top: 0,
            right: 10,
            bottom: 10,
        };
        assert!(convert(&bgra, 20, size, window, outside).is_none());
        let clipped = RECT {
            left: -10,
            top: 6,
            right: -5,
            bottom: 11,
        };
        let frame = convert(&bgra, 20, size, window, clipped).unwrap();
        assert_eq!((frame.width, frame.height), (3, 3));
    }
}

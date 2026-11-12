use std::{io::Cursor, marker::PhantomData, rc::Rc};
use windows::{
    core::h,
    Globalization::Language,
    Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::DataWriter,
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};

pub(super) type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
pub(super) type Rgb = [u8; 3];

#[derive(Clone, Copy, Debug)]
pub(super) struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn new(left: i32, top: i32, right: i32, bottom: i32) -> Self {
        Self {
            left,
            top,
            right,
            bottom,
        }
    }

    pub fn width(self) -> i32 {
        self.right - self.left
    }

    pub fn height(self) -> i32 {
        self.bottom - self.top
    }

    pub fn x(self) -> i32 {
        (self.left + self.right) / 2
    }

    pub fn y(self) -> i32 {
        (self.top + self.bottom) / 2
    }
}

pub(super) struct Image {
    pub width: i32,
    pub height: i32,
    pixels: Vec<Rgb>,
}

impl Image {
    #[cfg(test)]
    pub fn open(path: &std::path::Path) -> Result<Self> {
        Self::from_png(&std::fs::read(path)?)
    }

    pub fn from_png(bytes: &[u8]) -> Result<Self> {
        let mut decoder = png::Decoder::new(Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::normalize_to_color8());
        let mut reader = decoder.read_info()?;
        let max = OcrEngine::MaxImageDimension()?;
        if reader.info().width > max || reader.info().height > max {
            return Err(format!("Windows OCR image limit is {max} pixels per side").into());
        }
        let mut bytes = vec![
            0;
            reader
                .output_buffer_size()
                .ok_or("PNG exceeds decode limits")?
        ];
        let frame = reader.next_frame(&mut bytes)?;
        let pixels = bytes[..frame.buffer_size()]
            .chunks_exact(frame.color_type.samples())
            .map(|pixel| match pixel {
                [gray] | [gray, _] => [*gray; 3],
                [r, g, b] | [r, g, b, _] => [*r, *g, *b],
                _ => unreachable!("PNG decoder expanded indexed color"),
            })
            .collect();
        Ok(Self {
            width: frame.width.try_into()?,
            height: frame.height.try_into()?,
            pixels,
        })
    }

    pub fn at(&self, x: i32, y: i32) -> Rgb {
        let x = x.clamp(0, self.width - 1);
        let y = y.clamp(0, self.height - 1);
        self.pixels[y as usize * self.width as usize + x as usize]
    }

    #[cfg(test)]
    pub fn resize(&self, scale: f32) -> Self {
        self.crop(Rect::new(0, 0, self.width, self.height), scale)
    }

    pub fn crop(&self, rect: Rect, scale: f32) -> Self {
        let width = (rect.width() as f32 * scale).round().max(1.) as i32;
        let height = (rect.height() as f32 * scale).round().max(1.) as i32;
        let mut pixels = Vec::with_capacity(width as usize * height as usize);
        for y in 0..height {
            let sy = ((y as f32 + 0.5) / scale - 0.5).clamp(0., (rect.height() - 1).max(0) as f32);
            let iy = sy as i32 + rect.top;
            let fy = sy.fract();
            for x in 0..width {
                let sx =
                    ((x as f32 + 0.5) / scale - 0.5).clamp(0., (rect.width() - 1).max(0) as f32);
                let ix = sx as i32 + rect.left;
                let fx = sx.fract();
                let a = self.at(ix, iy);
                let b = self.at(ix + 1, iy);
                let c = self.at(ix, iy + 1);
                let d = self.at(ix + 1, iy + 1);
                pixels.push(std::array::from_fn(|i| {
                    let top = a[i] as f32 * (1. - fx) + b[i] as f32 * fx;
                    let bottom = c[i] as f32 * (1. - fx) + d[i] as f32 * fx;
                    (top * (1. - fy) + bottom * fy).round() as u8
                }));
            }
        }
        Self {
            width,
            height,
            pixels,
        }
    }

    pub fn text_crop(&self, rect: Rect, reference_height: i32, ink: fn(Rgb) -> u8) -> Self {
        self.padded_crop(rect, reference_height, |pixel| [ink(pixel); 3])
    }

    pub fn padded_crop(
        &self,
        rect: Rect,
        reference_height: i32,
        color: impl Fn(Rgb) -> Rgb,
    ) -> Self {
        let scale = (32. / reference_height.max(1) as f32).clamp(1., 4.);
        let crop = self.crop(rect, scale);
        let margin = 8;
        let width = crop.width + margin * 2;
        let height = crop.height + margin * 2;
        let mut pixels = vec![[255; 3]; width as usize * height as usize];
        for y in 0..crop.height {
            for x in 0..crop.width {
                pixels[((y + margin) * width + x + margin) as usize] = color(crop.at(x, y));
            }
        }
        Self {
            width,
            height,
            pixels,
        }
    }
}

pub(super) struct Word {
    pub text: String,
    pub bounds: Rect,
}

struct Apartment(PhantomData<Rc<()>>);

impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: This guard balances successful initialization on the same thread.
        unsafe { RoUninitialize() };
    }
}

pub(super) struct Ocr {
    engine: OcrEngine,
    _apartment: Apartment,
}

impl Ocr {
    pub fn new() -> Result<Self> {
        // SAFETY: OCR owns the calling thread's apartment until it is dropped.
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
        let apartment = Apartment(PhantomData);
        let language = Language::CreateLanguage(h!("en-US"))?;
        if !OcrEngine::IsLanguageSupported(&language)? {
            return Err("Install the Windows English (United States) OCR language pack".into());
        }
        let engine = OcrEngine::TryCreateFromLanguage(&language)?;
        Ok(Self {
            engine,
            _apartment: apartment,
        })
    }

    fn recognize(&self, image: &Image) -> Result<windows::Media::Ocr::OcrResult> {
        let max = OcrEngine::MaxImageDimension()? as i32;
        if image.width > max || image.height > max {
            return Err(format!("Windows OCR image limit is {max} pixels per side").into());
        }
        let mut bytes = Vec::with_capacity(image.pixels.len() * 4);
        for &[r, g, b] in &image.pixels {
            bytes.extend([b, g, r, 255]);
        }
        let writer = DataWriter::new()?;
        writer.WriteBytes(&bytes)?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &writer.DetachBuffer()?,
            BitmapPixelFormat::Bgra8,
            image.width,
            image.height,
        )?;
        Ok(self.engine.RecognizeAsync(&bitmap)?.join()?)
    }

    pub fn words(&self, image: &Image) -> Result<Vec<Word>> {
        let mut words = Vec::new();
        for line in self.recognize(image)?.Lines()? {
            for word in line.Words()? {
                let r = word.BoundingRect()?;
                words.push(Word {
                    text: word.Text()?.to_string_lossy(),
                    bounds: Rect::new(
                        r.X as i32,
                        r.Y as i32,
                        (r.X + r.Width) as i32,
                        (r.Y + r.Height) as i32,
                    ),
                });
            }
        }
        Ok(words)
    }

    pub fn text(&self, image: &Image) -> Result<String> {
        Ok(self.recognize(image)?.Text()?.to_string_lossy())
    }
}

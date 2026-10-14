use dicom_object::{open_file, DefaultDicomObject, OpenFileOptions};
use dicom_pixeldata::{PhotometricInterpretation, PixelDecoder, PlanarConfiguration};
use image::{DynamicImage, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{BufReader, Read, Seek, SeekFrom},
    path::Path,
};

/// Native monochrome integer samples are exactly preserved in f32 for <=16-bit inputs.
/// Supported colour DICOM is explicitly converted from decoded RGB to f32 grayscale.
/// No modality mapping, VOI normalization, polarity inversion or enhancement occurs here.
#[derive(Debug, Clone)]
pub struct SourceImage {
    pub width: u32,
    pub height: u32,
    pub samples: Vec<f32>,
    pub color: Option<Vec<[f32; 3]>>,
    pub metadata: ImageMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub name: String,
    pub format: String,
    pub image_date: Option<String>,
    pub date_source: Option<String>,
    pub bits_stored: u16,
    pub signed: bool,
    pub photometric: String,
    pub slope: f32,
    pub intercept: f32,
    pub window_center: Option<f32>,
    pub window_width: Option<f32>,
    pub min: f32,
    pub max: f32,
}

const MAX_PIXELS: u64 = 64_000_000;
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;

fn check_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("Image dimensions are empty or exceed the 64 megapixel safety limit".into());
    }
    Ok(())
}

/// Recognize DICOM Part 10 and PNG/JPEG by content, independently of extension.
/// Unknown signatures are attempted as DICOM datasets (including files without a preamble).
pub fn decode(path: &Path) -> Result<SourceImage, String> {
    let mut file = File::open(path)
        .map_err(|_| "Cannot open image file; check that it exists and is readable")?;
    if file
        .metadata()
        .map_err(|_| "Cannot read image file metadata")?
        .len()
        > MAX_FILE_BYTES
    {
        return Err("Image exceeds the 512 MiB input safety limit".into());
    }
    let mut header = [0_u8; 132];
    let length = file
        .read(&mut header)
        .map_err(|_| "Cannot read image file")?;
    if length == 132 && &header[128..132] == b"DICM" {
        return decode_dicom(path);
    }
    match image::guess_format(&header[..length]) {
        Ok(format @ (ImageFormat::Png | ImageFormat::Jpeg)) => {
            file.seek(SeekFrom::Start(0))
                .map_err(|_| "Cannot read image file")?;
            decode_ordinary(path, file, format)
        }
        Ok(_) => {
            Err("Unsupported image format; open PNG, JPEG or a supported 2D DICOM image".into())
        }
        Err(_) => decode_dicom(path),
    }
}

/// Read only the early DICOM date attributes, before patient tags and Pixel Data.
/// Ordinary images, missing/invalid dates and unreadable inputs return None.
pub fn read_image_date(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_FILE_BYTES {
        return None;
    }
    let mut signature = [0_u8; 8];
    let length = file.read(&mut signature).ok()?;
    if matches!(
        image::guess_format(&signature[..length]),
        Ok(ImageFormat::Png | ImageFormat::Jpeg)
    ) {
        return None;
    }
    let obj = OpenFileOptions::new()
        .read_until((0x0008, 0x0034).into())
        .open_file(path)
        .ok()?;
    dicom_image_date(&obj).0
}

fn required_u16(obj: &DefaultDicomObject, name: &str) -> Result<u16, String> {
    obj.element_by_name(name)
        .ok()
        .and_then(|e| e.to_int::<u16>().ok())
        .ok_or_else(|| format!("DICOM has missing or invalid {name}"))
}

fn optional_float(obj: &DefaultDicomObject, name: &str) -> Result<Option<f32>, String> {
    match obj.element_by_name(name) {
        Ok(element) => {
            let value = element
                .to_multi_float32()
                .map_err(|_| format!("DICOM has invalid {name}"))?
                .into_iter()
                .next()
                .ok_or_else(|| format!("DICOM has empty {name}"))?;
            if !value.is_finite() {
                return Err(format!("DICOM has non-finite {name}"));
            }
            Ok(Some(value))
        }
        Err(_) => Ok(None),
    }
}

// Keep the calendar date recorded by the device, without a timezone conversion.
fn calendar_date(value: &str, datetime: bool) -> Option<String> {
    let value = value.trim_matches(|c: char| c.is_whitespace() || c == '\0');
    if (!datetime && value.len() != 8) || value.len() < 8 {
        return None;
    }
    let date = value.as_bytes().get(..8)?;
    if !date.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let number = |part: &[u8]| part.iter().fold(0_u32, |n, b| n * 10 + u32::from(b - b'0'));
    let year = number(&date[..4]);
    let month = number(&date[4..6]);
    let day = number(&date[6..8]);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if year == 0 || day == 0 || day > days {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

fn dicom_image_date(obj: &DefaultDicomObject) -> (Option<String>, Option<String>) {
    for name in [
        "AcquisitionDateTime",
        "AcquisitionDate",
        "ContentDate",
        "StudyDate",
        "SeriesDate",
    ] {
        let Some(value) = obj.element_by_name(name).ok().and_then(|e| e.to_str().ok()) else {
            continue;
        };
        if let Some(date) = calendar_date(&value, name == "AcquisitionDateTime") {
            return (Some(date), Some(name.into()));
        }
    }
    (None, None)
}

fn decode_dicom(path: &Path) -> Result<SourceImage, String> {
    // Error details deliberately exclude arbitrary DICOM values and patient tags.
    let obj = open_file(path).map_err(|_| "Cannot parse this file as DICOM, PNG or JPEG")?;
    let (image_date, date_source) = dicom_image_date(&obj);
    let width = u32::from(required_u16(&obj, "Columns")?);
    let height = u32::from(required_u16(&obj, "Rows")?);
    check_dimensions(width, height)?;
    if let Ok(frames) = obj.element_by_name("NumberOfFrames") {
        if frames
            .to_int::<u32>()
            .map_err(|_| "DICOM has invalid NumberOfFrames")?
            != 1
        {
            return Err("Multiframe DICOM is not supported; open a single-frame 2D image".into());
        }
    }
    let channels = required_u16(&obj, "SamplesPerPixel")?;
    let colour = channels == 3;
    if !matches!(channels, 1 | 3) {
        return Err(
            "Unsupported DICOM sample layout; requires monochrome or three-channel colour".into(),
        );
    }
    let photometric = obj
        .element_by_name("PhotometricInterpretation")
        .ok()
        .and_then(|e| e.to_str().ok())
        .map(|s| s.trim().to_owned())
        .ok_or("DICOM has missing or invalid PhotometricInterpretation")?;
    if !(channels == 1 && matches!(photometric.as_str(), "MONOCHROME1" | "MONOCHROME2")
        || colour && matches!(photometric.as_str(), "RGB" | "YBR_FULL" | "YBR_FULL_422"))
    {
        return Err("Unsupported DICOM photometric interpretation for its sample layout".into());
    }
    let allocated = required_u16(&obj, "BitsAllocated")?;
    let bits_stored = required_u16(&obj, "BitsStored")?;
    let high_bit = required_u16(&obj, "HighBit")?;
    if !matches!(allocated, 8 | 16)
        || bits_stored == 0
        || bits_stored > allocated
        || high_bit != bits_stored - 1
    {
        return Err("Unsupported DICOM bit layout; requires 8/16-bit containers and right-aligned stored bits".into());
    }
    let signed = match required_u16(&obj, "PixelRepresentation")? {
        0 => false,
        1 => true,
        _ => return Err("DICOM has invalid PixelRepresentation".into()),
    };
    if colour {
        if allocated != 8 || bits_stored != 8 || signed {
            return Err("Colour DICOM conversion requires unsigned 8-bit RGB/YBR samples".into());
        }
        if required_u16(&obj, "PlanarConfiguration")? > 1 {
            return Err("Colour DICOM PlanarConfiguration must be 0 or 1".into());
        }
        match obj.meta().transfer_syntax.trim_end_matches('\0') {
            "1.2.840.10008.1.2.4.50" | "1.2.840.10008.1.2.4.51" => {
                check_colour_jpeg_header(&obj, width, height)?;
            }
            "1.2.840.10008.1.2" | "1.2.840.10008.1.2.1" | "1.2.840.10008.1.2.2"
            | "1.2.840.10008.1.2.1.99" if photometric != "YBR_FULL_422" => {}
            _ => return Err("Unsupported colour DICOM encoding; supports native RGB/YBR_FULL and JPEG Baseline/Extended RGB/YBR_FULL/YBR_FULL_422".into()),
        }
    }
    // These require additional mapping contracts; never silently ignore a supplied LUT.
    for name in [
        "ModalityLUTSequence",
        "VOILUTSequence",
        "PresentationLUTSequence",
        "SharedFunctionalGroupsSequence",
        "PerFrameFunctionalGroupsSequence",
    ] {
        if obj.element_by_name(name).is_ok() {
            return Err(format!("DICOM {name} is not supported in this prototype"));
        }
    }
    if let Ok(element) = obj.element_by_name("VOILUTFunction") {
        if element
            .to_str()
            .map_err(|_| "Invalid DICOM VOILUTFunction")?
            .trim()
            != "LINEAR"
        {
            return Err("Only DICOM LINEAR window/level is supported; this image specifies another VOI function".into());
        }
    }
    if let Ok(element) = obj.element_by_name("PresentationLUTShape") {
        let shape = element
            .to_str()
            .map_err(|_| "Invalid DICOM PresentationLUTShape")?;
        let expected = if photometric == "MONOCHROME1" {
            "INVERSE"
        } else {
            "IDENTITY"
        };
        if shape.trim() != expected {
            return Err("DICOM presentation polarity differs from the supported standard grayscale pipeline".into());
        }
    }
    let slope = optional_float(&obj, "RescaleSlope")?.unwrap_or(1.0);
    let intercept = optional_float(&obj, "RescaleIntercept")?.unwrap_or(0.0);
    if slope == 0.0 {
        return Err("DICOM RescaleSlope must not be zero".into());
    }
    let mut window_center = optional_float(&obj, "WindowCenter")?;
    let mut window_width = optional_float(&obj, "WindowWidth")?;
    if window_center.is_some() != window_width.is_some() || window_width.is_some_and(|w| w < 1.0) {
        return Err(
            "DICOM window center/width must be paired and LINEAR width must be at least 1".into(),
        );
    }
    if colour {
        if slope != 1.0 || intercept != 0.0 || window_center.is_some() || window_width.is_some() {
            return Err(
                "Colour DICOM with modality rescaling or explicit VOI is not supported".into(),
            );
        }
        // Effective display VOI for this grayscale conversion, not a source tag:
        // keep the entire 8-bit scale instead of stretching its observed extrema.
        window_center = Some(128.0);
        window_width = Some(256.0);
    }
    let decoded = obj.decode_pixel_data()
        .map_err(|_| "DICOM pixel decoding failed: unsupported transfer syntax, damaged data or invalid pixel metadata")?;
    if decoded.rows() != height
        || decoded.columns() != width
        || decoded.bits_allocated() != allocated
        || decoded.samples_per_pixel() != channels
    {
        return Err("DICOM decoded dimensions or bit depth disagree with metadata".into());
    }
    let bytes = decoded
        .frame_data(0)
        .map_err(|_| "DICOM pixel data is truncated")?;
    let samples: Vec<f32> = if colour {
        let count = width as usize * height as usize;
        if bytes.len() != count * 3 {
            return Err("Colour DICOM decoded sample count disagrees with dimensions".into());
        }
        // The JPEG adapter has already expanded sampling and converted JFIF/YBR
        // to interleaved RGB. Use decoded metadata, never the original YBR tag.
        let ybr = match decoded.photometric_interpretation() {
            PhotometricInterpretation::Rgb => false,
            PhotometricInterpretation::YbrFull => true,
            _ => return Err("Unsupported decoded colour DICOM representation".into()),
        };
        (0..count)
            .map(|i| {
                let pixel = match decoded.planar_configuration() {
                    PlanarConfiguration::Standard => {
                        [bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]]
                    }
                    PlanarConfiguration::PixelFirst => {
                        [bytes[i], bytes[count + i], bytes[2 * count + i]]
                    }
                };
                let rgb = if ybr {
                    ybr_full_to_rgb(pixel)
                } else {
                    pixel.map(f32::from)
                };
                0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
            })
            .collect()
    } else if allocated == 8 {
        bytes
            .iter()
            .map(|&v| stored_sample(u16::from(v), bits_stored, signed))
            .collect()
    } else {
        // dicom-pixeldata returns native-endian decoded bytes, even for explicit big endian files.
        bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|v| stored_sample(u16::from_ne_bytes([v[0], v[1]]), bits_stored, signed))
            .collect()
    };
    if samples.len() != width as usize * height as usize {
        return Err("DICOM pixel count disagrees with image dimensions".into());
    }
    finish(
        width,
        height,
        samples,
        None,
        ImageMetadata {
            name: file_name(path),
            format: "DICOM".into(),
            image_date,
            date_source,
            bits_stored,
            signed,
            photometric: if colour {
                "MONOCHROME2".into()
            } else {
                photometric
            },
            slope,
            intercept,
            window_center,
            window_width,
            min: 0.0,
            max: 0.0,
        },
    )
}

fn check_colour_jpeg_header(
    obj: &DefaultDicomObject,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let fragments = obj
        .element_by_name("PixelData")
        .ok()
        .and_then(|e| e.value().fragments())
        .ok_or("Colour JPEG DICOM requires encapsulated Pixel Data")?;
    let bytes: Vec<u8> = fragments.iter().flatten().copied().collect();
    // The DICOM adapter sizes its destination from metadata. Check the actual
    // JPEG header first so mismatched dimensions/components cannot overrun it.
    let mut jpeg = jpeg_decoder::Decoder::new(std::io::Cursor::new(bytes));
    jpeg.set_max_decoding_buffer_size(width as usize * height as usize * 3);
    jpeg.read_info()
        .map_err(|_| "Cannot read colour DICOM JPEG header")?;
    let info = jpeg
        .info()
        .ok_or("Missing colour DICOM JPEG frame information")?;
    if u32::from(info.width) != width
        || u32::from(info.height) != height
        || info.pixel_format != jpeg_decoder::PixelFormat::RGB24
    {
        return Err("Colour DICOM JPEG dimensions or components disagree with metadata".into());
    }
    Ok(())
}

fn ybr_full_to_rgb([y, cb, cr]: [u8; 3]) -> [f32; 3] {
    let (y, cb, cr) = (f32::from(y), f32::from(cb) - 128.0, f32::from(cr) - 128.0);
    [
        y + 1.402 * cr,
        y - 0.344_136 * cb - 0.714_136 * cr,
        y + 1.772 * cb,
    ]
    .map(|v| v.round().clamp(0.0, 255.0))
}

fn stored_sample(word: u16, bits: u16, signed: bool) -> f32 {
    let mask = (1_u32 << bits) - 1;
    let value = u32::from(word) & mask;
    if signed && value & (1_u32 << (bits - 1)) != 0 {
        (value as i32 - (1_i32 << bits)) as f32
    } else {
        value as f32
    }
}

fn decode_ordinary(path: &Path, file: File, format: ImageFormat) -> Result<SourceImage, String> {
    let mut reader = ImageReader::with_format(BufReader::new(file), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32_768);
    limits.max_image_height = Some(32_768);
    limits.max_alloc = Some(MAX_FILE_BYTES);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| "Cannot decode PNG/JPEG: damaged image or dimensions exceed memory limit")?;
    let (width, height) = (image.width(), image.height());
    check_dimensions(width, height)?;
    let (samples, color, bits_stored) = match image {
        DynamicImage::ImageLuma8(i) => (i.into_raw().into_iter().map(f32::from).collect(), None, 8),
        DynamicImage::ImageLuma16(i) => {
            (i.into_raw().into_iter().map(f32::from).collect(), None, 16)
        }
        DynamicImage::ImageLumaA8(i) => {
            if i.pixels().any(|p| p.0[1] != u8::MAX) {
                return Err("Transparent PNG is not supported; flatten it before opening".into());
            }
            (i.pixels().map(|p| f32::from(p.0[0])).collect(), None, 8)
        }
        DynamicImage::ImageLumaA16(i) => {
            if i.pixels().any(|p| p.0[1] != u16::MAX) {
                return Err("Transparent PNG is not supported; flatten it before opening".into());
            }
            (i.pixels().map(|p| f32::from(p.0[0])).collect(), None, 16)
        }
        DynamicImage::ImageRgb8(i) => color_samples(i.pixels().map(|p| p.0.map(f32::from)), 8),
        DynamicImage::ImageRgb16(i) => color_samples(i.pixels().map(|p| p.0.map(f32::from)), 16),
        DynamicImage::ImageRgba8(i) => {
            if i.pixels().any(|p| p.0[3] != u8::MAX) {
                return Err("Transparent PNG is not supported; flatten it before opening".into());
            }
            color_samples(
                i.pixels().map(|p| [p.0[0], p.0[1], p.0[2]].map(f32::from)),
                8,
            )
        }
        DynamicImage::ImageRgba16(i) => {
            if i.pixels().any(|p| p.0[3] != u16::MAX) {
                return Err("Transparent PNG is not supported; flatten it before opening".into());
            }
            color_samples(
                i.pixels().map(|p| [p.0[0], p.0[1], p.0[2]].map(f32::from)),
                16,
            )
        }
        _ => return Err("Only 8/16-bit PNG and ordinary JPEG samples are supported".into()),
    };
    let photometric = if color.is_some() {
        "RGB"
    } else {
        "MONOCHROME2"
    }
    .into();
    finish(
        width,
        height,
        samples,
        color,
        ImageMetadata {
            name: file_name(path),
            format: if format == ImageFormat::Png {
                "PNG"
            } else {
                "JPEG"
            }
            .into(),
            image_date: None,
            date_source: None,
            bits_stored,
            signed: false,
            photometric,
            slope: 1.0,
            intercept: 0.0,
            window_center: None,
            window_width: None,
            min: 0.0,
            max: 0.0,
        },
    )
}

fn color_samples(
    pixels: impl Iterator<Item = [f32; 3]>,
    bits: u16,
) -> (Vec<f32>, Option<Vec<[f32; 3]>>, u16) {
    let color: Vec<_> = pixels.collect();
    let luminance = color
        .iter()
        .map(|p| 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2])
        .collect();
    (luminance, Some(color), bits)
}
fn file_name(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
fn finish(
    width: u32,
    height: u32,
    samples: Vec<f32>,
    color: Option<Vec<[f32; 3]>>,
    mut metadata: ImageMetadata,
) -> Result<SourceImage, String> {
    metadata.min = samples.iter().copied().fold(f32::INFINITY, f32::min);
    metadata.max = samples.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    Ok(SourceImage {
        width,
        height,
        samples,
        color,
        metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar_dates_validate_leap_years_and_keep_local_datetime_day() {
        assert_eq!(
            calendar_date("20240229", false).as_deref(),
            Some("2024-02-29")
        );
        assert_eq!(
            calendar_date("20000229", false).as_deref(),
            Some("2000-02-29")
        );
        assert_eq!(
            calendar_date("20241231235959.123-0500", true).as_deref(),
            Some("2024-12-31")
        );
        assert_eq!(
            calendar_date("20240101000100+1400", true).as_deref(),
            Some("2024-01-01")
        );
        for invalid in [
            "19000229",
            "20230229",
            "20240431",
            "00000101",
            "20241301",
            "20240100",
            "2024",
            "202401",
            "2024-01-01",
            "2024010112",
            "abcdefgh",
            "",
        ] {
            assert_eq!(calendar_date(invalid, false), None, "{invalid}");
        }
    }
    #[test]
    fn stored_bits_sign_extension_and_unused_bits() {
        assert_eq!(stored_sample(0xffff, 12, false), 4095.0);
        assert_eq!(stored_sample(0x0fff, 12, true), -1.0);
        assert_eq!(stored_sample(0x0800, 12, true), -2048.0);
        assert_eq!(stored_sample(0x07ff, 12, true), 2047.0);
        assert_eq!(stored_sample(0x80, 8, true), -128.0);
        assert_eq!(stored_sample(0xffff, 16, true), -1.0);
    }
}

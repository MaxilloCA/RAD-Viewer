use crate::{
    image_settings::{self, Appearance},
    AppState,
};
use rad_core::{
    decode, process,
    review::{dark_regions, draw_ellipses},
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;
use tauri::State;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImage {
    path: String,
    source_sha256: String,
    appearance: Appearance,
    annotation_stroke: f32,
}
#[derive(Serialize)]
pub struct Exported {
    directory: String,
    path: String,
}

fn safe_component(name: &str, max: usize) -> Result<String, String> {
    let value: String = name
        .trim()
        .chars()
        .take(max)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let value = value.trim_matches([' ', '.']);
    if value.is_empty() {
        return Err("Enter the patient's name before exporting".into());
    }
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix)
                .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
        });
    Ok(if reserved {
        format!("_{value}")
    } else {
        value.to_owned()
    })
}

fn processed_image(item: &ExportImage) -> Result<(image::RgbImage, Option<String>), String> {
    let source_path = Path::new(&item.path);
    if image_settings::fingerprint(source_path)? != item.source_sha256 {
        return Err(
            "The original radiograph changed since it was opened. Reopen it before exporting."
                .into(),
        );
    }
    let source = decode(source_path)?;
    image_settings::validate(&item.appearance, source.width, source.height)?;
    let mut render = process(&source, &item.appearance.recipe)?;
    if let Some(overlay) = item.appearance.overlay.as_ref().filter(|o| o.visible) {
        let mask = dark_regions(&source, overlay.region, overlay.sensitivity / 100.0)?;
        let mask = image::RgbaImage::from_raw(mask.width, mask.height, mask.rgba)
            .ok_or("Invalid overlay pixels")?;
        let mask = image::imageops::resize(
            &mask,
            overlay.region.width.round().max(1.0) as u32,
            overlay.region.height.round().max(1.0) as u32,
            image::imageops::FilterType::Triangle,
        );
        let mut pixels = image::RgbaImage::from_raw(render.width, render.height, render.rgba)
            .ok_or("Invalid image pixels")?;
        image::imageops::overlay(
            &mut pixels,
            &mask,
            overlay.region.x.round() as i64,
            overlay.region.y.round() as i64,
        );
        render.rgba = pixels.into_raw();
    }
    draw_ellipses(
        &mut render,
        &item.appearance.ellipses,
        item.annotation_stroke,
    )?;
    let image = image::RgbaImage::from_raw(render.width, render.height, render.rgba)
        .ok_or("Invalid image pixels")?;
    let rotated = match item.appearance.rotation_quarter_turns {
        0 => image,
        1 => image::imageops::rotate90(&image),
        2 => image::imageops::rotate180(&image),
        3 => image::imageops::rotate270(&image),
        _ => return Err("Invalid rotation".into()),
    };
    let rgb = image::DynamicImage::ImageRgba8(rotated).to_rgb8();
    Ok((rgb, source.metadata.image_date.clone()))
}

fn encoded_jpeg(item: &ExportImage) -> Result<(Vec<u8>, Option<String>), String> {
    let (rgb, date) = processed_image(item)?;
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 70)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;
    Ok((bytes, date))
}

pub(crate) fn selected_jpeg(
    render: &rad_core::RenderedImage,
    quarter_turns: u8,
) -> Result<Vec<u8>, String> {
    let image = image::RgbaImage::from_raw(render.width, render.height, render.rgba.clone())
        .ok_or("Invalid rendered pixel dimensions")?;
    let rotated = match quarter_turns {
        0 => image,
        1 => image::imageops::rotate90(&image),
        2 => image::imageops::rotate180(&image),
        3 => image::imageops::rotate270(&image),
        _ => return Err("Invalid rotation".into()),
    };
    let rgb = image::DynamicImage::ImageRgba8(rotated).to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 70)
        .encode_image(&rgb)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

pub(crate) fn save_selected_jpeg(
    directory: &Path,
    bytes: &[u8],
    date: Option<&str>,
    sources: &[PathBuf],
) -> Result<PathBuf, String> {
    if !directory.is_absolute() {
        return Err("Choose an absolute destination folder for the JPEG export.".into());
    }
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Cannot create JPEG export folder: {error}"))?;
    let (path, mut output) = reserve_filename(directory, date, sources)?;
    let result = output.write_all(bytes).and_then(|_| output.sync_all());
    drop(output);
    if let Err(error) = result {
        let _ = std::fs::remove_file(&path);
        return Err(format!("Could not finish JPEG: {error}"));
    }
    Ok(path)
}

fn selected_export_directory(root: &Path, patient_name: &str) -> Result<PathBuf, String> {
    if patient_name.trim().is_empty() {
        return Ok(root.to_path_buf());
    }
    Ok(root.join(format!(
        "{} - RAD Export",
        safe_component(patient_name, 80)?
    )))
}

#[tauri::command]
pub async fn choose_jpeg_export_directory(
    patient_name: String,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let root = app.path().picture_dir().map_err(|error| error.to_string())?;
    let suggested = selected_export_directory(&root, &patient_name)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Folder pickers can only focus existing folders. If the office share is
        // unavailable the native picker still allows another destination.
        let initial = if std::fs::create_dir_all(&suggested).is_ok() {
            suggested
        } else {
            root
        };
        rfd::FileDialog::new()
            .set_title("Export to JPEG - choose folder (70% quality)")
            .set_directory(initial)
            .pick_folder()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
fn jpeg(item: &ExportImage) -> Result<Vec<u8>, String> {
    encoded_jpeg(item).map(|(bytes, _)| bytes)
}

fn reserve_filename(
    directory: &Path,
    date: Option<&str>,
    sources: &[PathBuf],
) -> Result<(PathBuf, std::fs::File), String> {
    let prefix = date
        .filter(|value| {
            value.len() == 10
                && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                    .is_ok_and(|parsed| parsed.format("%Y-%m-%d").to_string() == *value)
        })
        .unwrap_or("date-unknown");
    // Atomic reservation also protects against simultaneous exports from another PC.
    for number in 1..=10000 {
        let path = directory.join(format!("{prefix}_{number:02}.jpg"));
        if crate::protects_source(&path, sources) {
            continue;
        }
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Cannot create export {}: {error}", path.display())),
        }
    }
    Err("No available export sequence number for this date".into())
}

fn export_to(
    root: &Path,
    patient_name: &str,
    batch_id: &str,
    index: usize,
    item: &ExportImage,
) -> Result<Exported, String> {
    uuid::Uuid::parse_str(batch_id).map_err(|_| "Invalid export batch")?;
    if index == 0 || index > 10000 {
        return Err("Invalid export image number".into());
    }
    let directory = root.join(safe_component(patient_name, 80)?);
    let (bytes, date) = encoded_jpeg(item)?;
    std::fs::create_dir_all(&directory).map_err(|e| {
        format!(
            "Cannot create export directory {}: {e}",
            directory.display()
        )
    })?;
    let (path, mut output) = reserve_filename(&directory, date.as_deref(), &[])?;
    let result = output.write_all(&bytes).and_then(|_| output.sync_all());
    drop(output);
    if let Err(error) = result {
        let _ = std::fs::remove_file(&path);
        return Err(format!("Could not finish JPG: {error}"));
    }
    Ok(Exported {
        directory: directory.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn export_jpg_image(
    patient_name: String,
    batch_id: String,
    index: usize,
    item: ExportImage,
    state: State<'_, AppState>,
) -> Result<Exported, String> {
    if !cfg!(windows) {
        return Err("Office-share export is unavailable on macOS. Use Export Selected or Export for Letter.".into());
    }
    if !crate::protects_source(Path::new(&item.path), &state.source_paths.lock().unwrap()) {
        return Err("Open the radiograph before exporting it".into());
    }
    let permit = state
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        export_to(
            &PathBuf::from(r"\\EXAMPLE-SERVER\incoming"),
            &patient_name,
            &batch_id,
            index,
            &item,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rad_core::{
        review::{Ellipse, Region},
        Recipe,
    };
    fn item(root: &Path) -> ExportImage {
        let path = root.join("original.png");
        image::GrayImage::from_fn(80, 60, |x, y| {
            image::Luma([if (33..47).contains(&x) && (23..37).contains(&y) {
                100
            } else {
                180
            }])
        })
        .save(&path)
        .unwrap();
        let source = decode(&path).unwrap();
        ExportImage {
            source_sha256: image_settings::fingerprint(&path).unwrap(),
            path: path.to_string_lossy().into_owned(),
            appearance: Appearance {
                recipe: Recipe::neutral(&source),
                rotation_quarter_turns: 0,
                ellipses: vec![],
                overlay: None,
            },
            annotation_stroke: 3.0,
        }
    }
    #[test]
    fn native_jpeg_uses_quality_70_and_renders_adjustments_annotations_and_rotation() {
        let root = tempfile::tempdir().unwrap();
        let mut item = item(root.path());
        item.appearance.recipe.gamma = 0.6;
        let rendered = process(
            &decode(Path::new(&item.path)).unwrap(),
            &item.appearance.recipe,
        )
        .unwrap();
        let rgb = image::DynamicImage::ImageRgba8(
            image::RgbaImage::from_raw(80, 60, rendered.rgba).unwrap(),
        )
        .to_rgb8();
        let mut expected = vec![];
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut expected, 70)
            .encode_image(&rgb)
            .unwrap();
        assert_eq!(jpeg(&item).unwrap(), expected);
        item.appearance.ellipses.push(Ellipse {
            region: Region {
                x: 10.0,
                y: 10.0,
                width: 40.0,
                height: 30.0,
            },
            color: "red".into(),
        });
        item.appearance.rotation_quarter_turns = 1;
        let decoded = image::load_from_memory(&jpeg(&item).unwrap())
            .unwrap()
            .to_rgb8();
        assert_eq!(decoded.dimensions(), (60, 80));
        assert!(decoded.pixels().any(|p| p[0] as i32 - p[1] as i32 > 80));
        assert_eq!(
            image_settings::fingerprint(Path::new(&item.path)).unwrap(),
            item.source_sha256
        );
    }
    #[test]
    fn selected_export_matches_processed_jpeg_at_quality_70_and_preserves_sources() {
        let root = tempfile::tempdir().unwrap();
        let mut item = item(root.path());
        item.appearance.recipe.version = 2;
        item.appearance.recipe.gamma = 0.6;
        item.appearance.recipe.colorize = true;
        item.appearance.recipe.color_strength = 0.4;
        item.appearance.rotation_quarter_turns = 1;
        item.appearance.ellipses.push(Ellipse {
            region: Region {
                x: 10.0,
                y: 10.0,
                width: 40.0,
                height: 30.0,
            },
            color: "red".into(),
        });
        let source = decode(Path::new(&item.path)).unwrap();
        let mut render = process(&source, &item.appearance.recipe).unwrap();
        draw_ellipses(&mut render, &item.appearance.ellipses, 3.0).unwrap();
        let bytes = selected_jpeg(&render, 1).unwrap();
        assert_eq!(bytes, jpeg(&item).unwrap());
        assert_eq!(
            image::load_from_memory(&bytes)
                .unwrap()
                .to_rgb8()
                .dimensions(),
            (60, 80)
        );
        let first = save_selected_jpeg(
            root.path(),
            &bytes,
            Some("2026-10-21"),
            &[PathBuf::from(&item.path)],
        )
        .unwrap();
        let second = save_selected_jpeg(
            root.path(),
            &bytes,
            Some("2026-10-21"),
            std::slice::from_ref(&first),
        )
        .unwrap();
        assert!(first.to_string_lossy().ends_with("2026-10-21_01.jpg"));
        assert!(second.to_string_lossy().ends_with("2026-10-21_02.jpg"));
        assert_eq!(std::fs::read(&first).unwrap(), bytes);
        assert_eq!(
            image_settings::fingerprint(Path::new(&item.path)).unwrap(),
            item.source_sha256
        );
        assert!(selected_jpeg(&render, 4).is_err());
        assert!(save_selected_jpeg(Path::new("relative"), &bytes, None, &[]).is_err());
    }
    #[test]
    fn selected_export_suggests_patient_name_folder_and_sanitizes_it() {
        let root = Path::new(r"\\server\Incoming");
        assert_eq!(
            selected_export_directory(root, "Smith, John").unwrap(),
            root.join("Smith, John - RAD Export")
        );
        assert_eq!(
            selected_export_directory(root, "Smith/Other, John").unwrap(),
            root.join("Smith_Other, John - RAD Export")
        );
        assert_eq!(selected_export_directory(root, "").unwrap(), root);
    }
    #[test]
    fn export_is_confined_to_patient_folder_and_never_overwrites_completed_files() {
        let root = tempfile::tempdir().unwrap();
        let item = item(root.path());
        let batch = uuid::Uuid::new_v4().to_string();
        let exported = export_to(root.path(), "Example Person", &batch, 1, &item).unwrap();
        assert_eq!(
            Path::new(&exported.directory),
            root.path().join("Example Person")
        );
        let original = std::fs::read(&exported.path).unwrap();
        let second = export_to(root.path(), "Example Person", &batch, 1, &item).unwrap();
        assert!(exported.path.ends_with("date-unknown_01.jpg"));
        assert!(second.path.ends_with("date-unknown_02.jpg"));
        assert_eq!(std::fs::read(&exported.path).unwrap(), original);
        assert_eq!(safe_component("../../escape", 80).unwrap(), "_.._escape");
        assert_eq!(safe_component("CON", 80).unwrap(), "_CON");
        assert!(safe_component("...", 80).is_err());
    }
    #[test]
    fn changed_original_is_rejected_and_visible_overlay_changes_jpeg() {
        let root = tempfile::tempdir().unwrap();
        let mut item = item(root.path());
        let plain = jpeg(&item).unwrap();
        item.appearance.overlay = Some(image_settings::Overlay {
            region: Region {
                x: 0.0,
                y: 0.0,
                width: 80.0,
                height: 60.0,
            },
            sensitivity: 100.0,
            visible: true,
            url: None,
        });
        let overlay = jpeg(&item).unwrap();
        assert_ne!(overlay, plain);
        item.appearance.overlay.as_mut().unwrap().visible = false;
        assert_eq!(jpeg(&item).unwrap(), plain);
        std::fs::write(&item.path, b"changed").unwrap();
        assert!(jpeg(&item).unwrap_err().contains("changed"));
    }
}

#[cfg(test)]
mod filename_tests {
    use super::*;
    #[test]
    fn acquisition_dates_have_independent_padded_sequences_and_preserve_existing_files() {
        let root = tempfile::tempdir().unwrap();
        for number in 1..=5 {
            let (path, mut file) = reserve_filename(root.path(), Some("2026-10-15"), &[]).unwrap();
            assert_eq!(
                path.file_name().unwrap().to_str().unwrap(),
                format!("2026-10-15_{number:02}.jpg")
            );
            file.write_all(b"existing export").unwrap();
        }
        let (next, _) = reserve_filename(root.path(), Some("2026-10-15"), &[]).unwrap();
        assert!(next.ends_with("2026-10-15_06.jpg"));
        let (other, _) = reserve_filename(root.path(), Some("2026-10-14"), &[]).unwrap();
        assert!(other.ends_with("2026-10-14_01.jpg"));
        assert_eq!(
            std::fs::read(root.path().join("2026-10-15_01.jpg")).unwrap(),
            b"existing export"
        );
        for invalid in [None, Some("2026-02-30"), Some("../escape")] {
            let (path, _) = reserve_filename(root.path(), invalid, &[]).unwrap();
            assert!(path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("date-unknown_"));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFrame {
    url: String,
    width: u32,
    height: u32,
    image_date: Option<String>,
}

#[tauri::command]
pub async fn prepare_export_image(
    item: ExportImage,
    state: State<'_, AppState>,
) -> Result<ExportFrame, String> {
    if !crate::protects_source(Path::new(&item.path), &state.source_paths.lock().unwrap()) {
        return Err("Open the radiograph before exporting it".into());
    }
    let permit = state
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let (rgb, date) = processed_image(&item)?;
        let mut bytes = Vec::new();
        use image::ImageEncoder;
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| e.to_string())?;
        Ok(ExportFrame {
            url: crate::snapshot_data_url(&bytes),
            width: rgb.width(),
            height: rgb.height(),
            image_date: date,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// Six decimal digits derived from the export time. Atomic reservation handles hash collisions.
fn reserve_composite(
    root: &Path,
    name: &str,
    number: &str,
    timestamp: u128,
) -> Result<(PathBuf, std::fs::File), String> {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(timestamp.to_le_bytes());
    let seed = u32::from_le_bytes(digest[..4].try_into().unwrap()) % 1_000_000;
    for attempt in 0..1_000_000 {
        let id = (seed + attempt) % 1_000_000;
        let path = root.join(format!("{name} - {number} - {id:06}.jpg"));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Cannot save JPEG in {}: {error}", root.display())),
        }
    }
    Err("All six-digit export IDs are in use for this patient".into())
}

fn composite_jpeg(png: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    use image::ImageDecoder;

    if png.len() > 100_000_000 {
        return Err("Export image is too large".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            png.strip_prefix("data:image/png;base64,")
                .ok_or("Invalid export image")?,
        )
        .map_err(|_| "Invalid export image encoding")?;
    let decoder = image::codecs::png::PngDecoder::new(std::io::Cursor::new(&bytes))
        .map_err(|e| e.to_string())?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width > 4096
        || height > 4096
        || u64::from(width) * u64::from(height) > 16_000_000
    {
        return Err("Invalid export dimensions".into());
    }
    let rgb = image::DynamicImage::from_decoder(decoder)
        .map_err(|e| e.to_string())?
        .to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 70)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;
    Ok(jpeg)
}

#[tauri::command]
pub async fn preview_viewer_jpg(png: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let jpeg = composite_jpeg(&png)?;
        Ok(format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(jpeg)
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_composite(
    root: &Path,
    patient_name: &str,
    patient_id: &str,
    png: &str,
) -> Result<Exported, String> {
    let jpeg = composite_jpeg(png)?;
    let name = safe_component(patient_name, 80)?;
    let number = safe_component(
        if patient_id.is_empty() {
            "ID unknown"
        } else {
            patient_id
        },
        64,
    )?;
    let directory = root;
    std::fs::create_dir_all(directory)
        .map_err(|e| format!("Cannot create export folder {}: {e}", directory.display()))?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let (path, mut output) = reserve_composite(directory, &name, &number, timestamp)?;
    let result = output.write_all(&jpeg).and_then(|_| output.sync_all());
    drop(output);
    if let Err(error) = result {
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(Exported {
        directory: directory.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn export_viewer_jpg(
    patient_name: String,
    patient_id: String,
    png: String,
    app: tauri::AppHandle,
) -> Result<Exported, String> {
    let root = if patient_id == "DEMO" {
        app.path()
            .picture_dir()
            .map_err(|e| e.to_string())?
            .join("RAD Viewer")
            .join("Synthetic Sample")
    } else {
        app.path().picture_dir().map_err(|e| e.to_string())?
            .join("RAD Viewer").join("Exports")
    };
    tauri::async_runtime::spawn_blocking(move || {
        save_composite(&root, &patient_name, &patient_id, &png)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod composite_tests {
    use super::*;
    use base64::Engine;
    #[test]
    fn timestamp_hash_collisions_reserve_another_six_digit_name() {
        let root = tempfile::tempdir().unwrap();
        let (first, mut file) = reserve_composite(root.path(), "Example", "123", 42).unwrap();
        file.write_all(b"preserved").unwrap();
        let (second, _) = reserve_composite(root.path(), "Example", "123", 42).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(first).unwrap(), b"preserved");
    }
    #[test]
    fn saves_one_named_jpeg_with_exact_quality_and_preserves_collisions() {
        let root = tempfile::tempdir().unwrap();
        let image = image::RgbImage::from_fn(180, 120, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 90])
        });
        let mut data = Vec::new();
        image::DynamicImage::ImageRgb8(image.clone())
            .write_to(
                &mut std::io::Cursor::new(&mut data),
                image::ImageFormat::Png,
            )
            .unwrap();
        let png = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(data)
        );
        let output = save_composite(root.path(), "Person, Example", "00123", &png).unwrap();
        assert_eq!(Path::new(&output.path).parent().unwrap(), root.path());
        let filename = Path::new(&output.path)
            .file_stem()
            .unwrap()
            .to_str()
            .unwrap();
        let id = filename.rsplit(" - ").next().unwrap();
        assert_eq!(id.len(), 6);
        assert!(id.chars().all(|c| c.is_ascii_digit()));
        let bytes = std::fs::read(&output.path).unwrap();
        let mut expected = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut expected, 70)
            .encode_image(&image)
            .unwrap();
        assert_eq!(bytes, expected);
        assert_ne!(
            save_composite(root.path(), "Person, Example", "00123", &png)
                .unwrap()
                .path,
            output.path
        );
        assert_eq!(std::fs::read(&output.path).unwrap(), bytes);
        assert!(save_composite(root.path(), "Person, Example", "00123", "not a PNG").is_err());
    }
}

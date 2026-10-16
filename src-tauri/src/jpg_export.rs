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

fn encoded_jpeg(item: &ExportImage) -> Result<(Vec<u8>, Option<String>), String> {
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
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 70)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;
    Ok((bytes, source.metadata.image_date.clone()))
}

#[cfg(test)]
fn jpeg(item: &ExportImage) -> Result<Vec<u8>, String> {
    encoded_jpeg(item).map(|(bytes, _)| bytes)
}

fn reserve_filename(
    directory: &Path,
    date: Option<&str>,
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
    let (path, mut output) = reserve_filename(&directory, date.as_deref())?;
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
            &PathBuf::from(r"\\C04577\incoming"),
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
            let (path, mut file) = reserve_filename(root.path(), Some("2026-10-15")).unwrap();
            assert_eq!(
                path.file_name().unwrap().to_str().unwrap(),
                format!("2026-10-15_{number:02}.jpg")
            );
            file.write_all(b"existing export").unwrap();
        }
        let (next, _) = reserve_filename(root.path(), Some("2026-10-15")).unwrap();
        assert!(next.ends_with("2026-10-15_06.jpg"));
        let (other, _) = reserve_filename(root.path(), Some("2026-10-14")).unwrap();
        assert!(other.ends_with("2026-10-14_01.jpg"));
        assert_eq!(
            std::fs::read(root.path().join("2026-10-15_01.jpg")).unwrap(),
            b"existing export"
        );
        for invalid in [None, Some("2026-02-30"), Some("../escape")] {
            let (path, _) = reserve_filename(root.path(), invalid).unwrap();
            assert!(path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("date-unknown_"));
        }
    }
}

use rad_core::{
    review::{Ellipse, Region},
    Recipe,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub region: Region,
    pub sensitivity: f32,
    pub visible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub recipe: Recipe,
    pub rotation_quarter_turns: u8,
    #[serde(default)]
    pub ellipses: Vec<Ellipse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overlay: Option<Overlay>,
}

#[derive(Serialize, Deserialize)]
struct XmlEllipse {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    color: String,
}
#[derive(Default, Serialize, Deserialize)]
struct Annotations {
    #[serde(default, rename = "ellipse")]
    items: Vec<XmlEllipse>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename = "RadViewerImage", rename_all = "camelCase")]
struct Record {
    version: u8,
    revision: String,
    source_sha256: String,
    width: u32,
    height: u32,
    recipe: Recipe,
    rotation_quarter_turns: u8,
    annotations: Annotations,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    overlay: Option<Overlay>,
}

pub fn sidecar(source: &Path) -> Result<PathBuf, String> {
    let name = source
        .file_name()
        .ok_or("Invalid image filename")?
        .to_string_lossy();
    Ok(source.with_file_name(format!("{name}.rad-viewer.xml")))
}

pub fn fingerprint(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn valid_region(region: Region, width: u32, height: u32) -> bool {
    [region.x, region.y, region.width, region.height]
        .iter()
        .all(|v| v.is_finite())
        && region.x >= 0.0
        && region.y >= 0.0
        && region.width > 0.0
        && region.height > 0.0
        && region.x + region.width <= width as f32 + 0.01
        && region.y + region.height <= height as f32 + 0.01
}

pub fn validate(value: &Appearance, width: u32, height: u32) -> Result<(), String> {
    value.recipe.validate()?;
    if value.rotation_quarter_turns > 3 || value.ellipses.len() > 1000 {
        return Err("Invalid rotation or annotation count".into());
    }
    if value.ellipses.iter().any(|e| {
        !valid_region(e.region, width, height) || !matches!(e.color.as_str(), "red" | "yellow")
    }) {
        return Err("Invalid ellipse annotation".into());
    }
    if let Some(overlay) = &value.overlay {
        if !valid_region(overlay.region, width, height)
            || overlay.region.width < 16.0
            || overlay.region.height < 16.0
            || !overlay.sensitivity.is_finite()
            || !(0.0..=100.0).contains(&overlay.sensitivity)
        {
            return Err("Invalid dark-area review region or sensitivity".into());
        }
    }
    Ok(())
}

fn read_record(path: &Path) -> Result<Option<Record>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut xml = String::new();
    file.take(2_000_001)
        .read_to_string(&mut xml)
        .map_err(|e| e.to_string())?;
    if xml.len() > 2_000_000 || xml.contains("<!DOCTYPE") {
        return Err("Invalid or oversized image settings XML".into());
    }
    let record: Record = quick_xml::de::from_str(&xml)
        .map_err(|e| format!("Cannot read image settings XML: {e}"))?;
    if record.version != 1 {
        return Err("Unsupported image settings version".into());
    }
    Ok(Some(record))
}

pub fn load(
    path: &Path,
    hash: &str,
    width: u32,
    height: u32,
) -> Result<Option<(String, Appearance)>, String> {
    let Some(record) = read_record(path)? else {
        return Ok(None);
    };
    if record.source_sha256 != hash || record.width != width || record.height != height {
        return Err("Saved settings belong to a different version of this radiograph. Original settings have been preserved.".into());
    }
    let appearance = Appearance {
        recipe: record.recipe,
        rotation_quarter_turns: record.rotation_quarter_turns,
        ellipses: record
            .annotations
            .items
            .into_iter()
            .map(|e| Ellipse {
                region: Region {
                    x: e.x,
                    y: e.y,
                    width: e.width,
                    height: e.height,
                },
                color: e.color,
            })
            .collect(),
        overlay: record.overlay,
    };
    validate(&appearance, width, height)?;
    Ok(Some((record.revision, appearance)))
}

pub fn save(
    path: &Path,
    hash: &str,
    width: u32,
    height: u32,
    expected_revision: Option<&str>,
    value: &Appearance,
) -> Result<String, String> {
    validate(value, width, height)?;
    let lock_path = path.with_extension("xml.lock");
    // Keep a stable lock file: OS locks release even if a viewer crashes. Removing
    // it could let another process lock a different file at the same pathname.
    let lock = fs::OpenOptions::new().write(true).create(true).truncate(false).open(&lock_path)
        .map_err(|e| format!("Cannot save image settings (folder unavailable, read-only, or in use by another viewer): {e}"))?;
    lock.try_lock()
        .map_err(|e| format!("Another viewer is saving this image. Retry saving: {e}"))?;
    let existing = read_record(path)?;
    if existing.as_ref().map(|r| r.revision.as_str()) != expected_revision {
        return Err("Another viewer changed this image's saved settings. Close and reopen the viewer to load those settings; your current edits remain on screen until you close.".into());
    }
    if existing.as_ref().is_some_and(|r| r.source_sha256 != hash) {
        return Err("The saved radiograph identity changed. Reopen the chart.".into());
    }
    let revision = uuid::Uuid::new_v4().to_string();
    let mut overlay = value.overlay.clone();
    if let Some(overlay) = &mut overlay {
        overlay.url = None;
    }
    let record = Record {
        version: 1,
        revision: revision.clone(),
        source_sha256: hash.into(),
        width,
        height,
        recipe: value.recipe.clone(),
        rotation_quarter_turns: value.rotation_quarter_turns,
        annotations: Annotations {
            items: value
                .ellipses
                .iter()
                .map(|e| XmlEllipse {
                    x: e.region.x,
                    y: e.region.y,
                    width: e.region.width,
                    height: e.region.height,
                    color: e.color.clone(),
                })
                .collect(),
        },
        overlay,
    };
    let xml = quick_xml::se::to_string(&record).map_err(|e| e.to_string())?;
    let result = super::atomic_write(
        path,
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{xml}\n").as_bytes(),
    );
    drop(lock);
    result.map(|_| revision)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn appearance(root: &Path) -> Appearance {
        let source = root.join("source.png");
        image::GrayImage::from_pixel(80, 60, image::Luma([100]))
            .save(&source)
            .unwrap();
        Appearance {
            recipe: Recipe::neutral(&rad_core::decode(&source).unwrap()),
            rotation_quarter_turns: 1,
            ellipses: vec![Ellipse {
                region: Region {
                    x: 4.0,
                    y: 5.0,
                    width: 30.0,
                    height: 20.0,
                },
                color: "yellow".into(),
            }],
            overlay: Some(Overlay {
                region: Region {
                    x: 2.0,
                    y: 3.0,
                    width: 40.0,
                    height: 30.0,
                },
                sensitivity: 62.0,
                visible: true,
                url: Some("data:transient".into()),
            }),
        }
    }
    #[test]
    fn shared_xml_roundtrip_preserves_all_adjustments_and_original() {
        let root = tempfile::tempdir().unwrap();
        let mut value = appearance(root.path());
        value.recipe.gamma = 0.7;
        value.recipe.version = 2;
        value.recipe.colorize = true;
        value.recipe.midtone_level = Some(0.65);
        value.recipe.color_mode = Some("midtoneContrast".into());
        value.recipe.midtone_width = 0.07;
        value.recipe.color_strength = 0.4;
        let source = root.path().join("source.png");
        let hash = fingerprint(&source).unwrap();
        let path = sidecar(&source).unwrap();
        let revision = save(&path, &hash, 80, 60, None, &value).unwrap();
        let xml = fs::read_to_string(&path).unwrap();
        assert!(xml.contains("<RadViewerImage>"));
        assert!(!xml.contains("data:transient"));
        let (loaded_revision, loaded) = load(&path, &hash, 80, 60).unwrap().unwrap();
        assert_eq!(revision, loaded_revision);
        assert_eq!(loaded.recipe, value.recipe);
        assert_eq!(loaded.rotation_quarter_turns, 1);
        assert_eq!(loaded.ellipses[0].color, "yellow");
        assert_eq!(loaded.ellipses[0].region.width, 30.0);
        assert_eq!(loaded.overlay.unwrap().sensitivity, 62.0);
        value.ellipses.clear();
        value.overlay = None;
        save(&path, &hash, 80, 60, Some(&revision), &value).unwrap();
        let (_, cleared) = load(&path, &hash, 80, 60).unwrap().unwrap();
        assert!(cleared.ellipses.is_empty());
        assert!(cleared.overlay.is_none());
        assert_eq!(fingerprint(&source).unwrap(), hash);
    }
    #[test]
    fn stale_revision_bad_identity_and_invalid_xml_cannot_overwrite_settings() {
        let root = tempfile::tempdir().unwrap();
        let value = appearance(root.path());
        let path = root.path().join("settings.xml");
        let revision = save(&path, "hash", 80, 60, None, &value).unwrap();
        let original = fs::read(&path).unwrap();
        assert!(save(&path, "hash", 80, 60, None, &value)
            .unwrap_err()
            .contains("Another viewer"));
        assert!(load(&path, "other", 80, 60).is_err());
        assert!(load(&path, "hash", 81, 60).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        // Failed writes release the OS lock; the current revision can still be saved.
        save(&path, "hash", 80, 60, Some(&revision), &value).unwrap();
        fs::write(&path, "<broken>").unwrap();
        assert!(save(&path, "hash", 80, 60, None, &value).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "<broken>");
    }
    #[test]
    fn simultaneous_writer_lock_and_invalid_annotations_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let mut value = appearance(root.path());
        let path = root.path().join("settings.xml");
        let lock = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("xml.lock"))
            .unwrap();
        lock.try_lock().unwrap();
        assert!(save(&path, "hash", 80, 60, None, &value).is_err());
        drop(lock);
        save(&path, "hash", 80, 60, None, &value).unwrap();
        value.ellipses[0].region.width = 100.0;
        assert!(validate(&value, 80, 60).is_err());
    }
}

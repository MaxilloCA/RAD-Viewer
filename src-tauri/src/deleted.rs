use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItem {
    pub path: String,
    pub directory: Option<String>,
    pub source_sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub path: String,
    pub destination: Option<String>,
    pub error: Option<String>,
    pub warning: Option<String>,
}

pub fn is_deleted(path: &Path) -> bool {
    path.components()
        .any(|part| part.as_os_str().eq_ignore_ascii_case("DELETED"))
}

// MoveFileW fails if the destination exists, including on LAN shares. Never
// overwrite an older deleted radiograph, even if another viewer moves one too.
#[cfg(windows)]
fn move_new(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileW(existing: *const u16, new: *const u16) -> i32;
    }
    let source: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<_> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    if unsafe { MoveFileW(source.as_ptr(), destination.as_ptr()) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn move_new(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::hard_link(source, destination)?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(destination);
        return Err(error);
    }
    Ok(())
}

fn move_image(item: &DeleteItem) -> Result<(String, Option<String>), String> {
    let source = fs::canonicalize(&item.path).map_err(|e| format!("Cannot find image: {e}"))?;
    if is_deleted(&source) || !source.is_file() {
        return Err("Images already in DELETED cannot be opened or moved again.".into());
    }
    let root = match &item.directory {
        Some(directory) => {
            fs::canonicalize(directory).map_err(|e| format!("Cannot find patient folder: {e}"))?
        }
        None => source
            .parent()
            .ok_or("Image has no parent folder")?
            .to_path_buf(),
    };
    if !source.starts_with(&root) || is_deleted(&root) {
        return Err("Image is outside its patient folder.".into());
    }
    if crate::image_settings::fingerprint(&source)? != item.source_sha256 {
        return Err("The image changed on disk. Reload it before deleting.".into());
    }
    let deleted = root.join("DELETED");
    // Create only on a confirmed deletion, after checking the source. Refuse
    // junctions/symlinks so files cannot be redirected outside the patient folder.
    if !deleted.exists() {
        match fs::create_dir(&deleted) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(format!("Cannot create DELETED: {error}")),
        }
    }
    let metadata = fs::symlink_metadata(&deleted).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("DELETED must be a regular folder, not a junction or link.".into());
        }
    }
    if !metadata.is_dir()
        || metadata.is_symlink()
        || fs::canonicalize(&deleted)
            .map_err(|e| e.to_string())?
            .parent()
            != Some(root.as_path())
    {
        return Err("DELETED must be a regular folder inside the patient folder.".into());
    }
    let name = source.file_name().ok_or("Image has no filename")?;
    let mut destination = deleted.join(name);
    // Retain the original filename when available; preserve both images on collisions.
    while destination.exists() || crate::image_settings::sidecar(&destination)?.exists() {
        let stem = source.file_stem().unwrap_or(name).to_string_lossy();
        let extension = source
            .extension()
            .map(|v| format!(".{}", v.to_string_lossy()))
            .unwrap_or_default();
        destination = deleted.join(format!("{stem}-{}{extension}", uuid::Uuid::new_v4()));
    }
    move_new(&source, &destination).map_err(|e| format!("Cannot move image into DELETED: {e}"))?;
    let sidecar = crate::image_settings::sidecar(&source)?;
    let warning = if sidecar.exists() {
        move_new(&sidecar, &crate::image_settings::sidecar(&destination)?)
            .err()
            .map(|e| format!("Image moved, but its adjustment file could not be moved: {e}"))
    } else {
        None
    };
    Ok((destination.to_string_lossy().into_owned(), warning))
}

pub fn move_images(items: Vec<DeleteItem>) -> Vec<DeleteResult> {
    items
        .into_iter()
        .map(|item| {
            let mut result = DeleteResult {
                path: item.path.clone(),
                destination: None,
                error: None,
                warning: None,
            };
            match move_image(&item) {
                Ok((destination, warning)) => {
                    result.destination = Some(destination);
                    result.warning = warning;
                }
                Err(error) => result.error = Some(error),
            }
            result
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(path: &Path, root: &Path) -> DeleteItem {
        DeleteItem {
            path: path.to_string_lossy().into_owned(),
            directory: Some(root.to_string_lossy().into_owned()),
            source_sha256: crate::image_settings::fingerprint(path).unwrap(),
        }
    }
    #[test]
    fn moves_images_and_adjustments_without_overwriting_and_discovery_excludes_deleted() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let image = root.join("image.rvg");
        fs::write(&image, b"original").unwrap();
        fs::write(crate::image_settings::sidecar(&image).unwrap(), b"settings").unwrap();
        assert!(!root.join("DELETED").exists());
        let results = move_images(vec![item(&image, root)]);
        let destination = Path::new(results[0].destination.as_ref().unwrap());
        assert_eq!(fs::read(destination).unwrap(), b"original");
        assert_eq!(
            fs::read(crate::image_settings::sidecar(destination).unwrap()).unwrap(),
            b"settings"
        );
        assert!(!image.exists());
        fs::write(&image, b"second").unwrap();
        let second = move_images(vec![item(&image, root)]);
        assert_ne!(second[0].destination, results[0].destination);
        assert_eq!(fs::read(destination).unwrap(), b"original");
        assert!(crate::patient::discover(root, "12")
            .unwrap()
            .paths
            .is_empty());
    }
    #[test]
    fn failed_items_remain_and_do_not_create_deleted_while_valid_items_move() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let image = root.join("image.png");
        fs::write(&image, b"original").unwrap();
        let stale = item(&image, root);
        fs::write(&image, b"changed").unwrap();
        assert!(move_images(vec![stale])[0].error.is_some());
        assert!(!root.join("DELETED").exists());
        assert!(image.exists());
        let elsewhere = tempfile::tempdir().unwrap();
        assert!(move_images(vec![item(&image, elsewhere.path())])[0]
            .error
            .is_some());
        assert!(!elsewhere.path().join("DELETED").exists());
        let mut missing = item(&image, root);
        missing.path.push_str(".missing");
        let result = move_images(vec![missing, item(&image, root)]);
        assert!(result[0].error.is_some());
        assert!(result[1].destination.is_some());
        let moved = Path::new(result[1].destination.as_ref().unwrap());
        assert!(move_images(vec![item(moved, root)])[0].error.is_some());
    }
    #[test]
    fn move_does_not_replace_existing_destination() {
        let temp = tempfile::tempdir().unwrap();
        let a = temp.path().join("a");
        let b = temp.path().join("b");
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"b").unwrap();
        assert!(move_new(&a, &b).is_err());
        assert_eq!(fs::read(&a).unwrap(), b"a");
        assert_eq!(fs::read(&b).unwrap(), b"b");
    }
}

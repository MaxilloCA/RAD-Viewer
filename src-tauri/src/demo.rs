use crate::patient::{self, PatientStudy};
use std::{io::Write, path::Path};

// Demo data is prepared locally with scripts/prepare_demo.py, excluded from Git,
// and embedded so the installed app and standalone executable need no office share.
const FILES: &[(&str, &[u8])] = &[
    (
        "Radiograph-01.dcm",
        include_bytes!("../../demo/John Smith/Radiograph-01.dcm"),
    ),
    (
        "Radiograph-02.dcm",
        include_bytes!("../../demo/John Smith/Radiograph-02.dcm"),
    ),
    (
        "Radiograph-03.dcm",
        include_bytes!("../../demo/John Smith/Radiograph-03.dcm"),
    ),
    (
        "Radiograph-04.dcm",
        include_bytes!("../../demo/John Smith/Radiograph-04.dcm"),
    ),
    (
        "Radiograph-05.dcm",
        include_bytes!("../../demo/John Smith/Radiograph-05.dcm"),
    ),
    (
        "PatientInfo.xml",
        include_bytes!("../../demo/John Smith/PatientInfo.xml"),
    ),
];

pub fn open(root: &Path) -> Result<PatientStudy, String> {
    let directory = root.join("John Smith");
    std::fs::create_dir_all(&directory)
        .map_err(|e| format!("Cannot create the demo folder: {e}"))?;
    for &(name, bytes) in FILES {
        let path = directory.join(name);
        // Refresh must not recreate samples the user deliberately moved away.
        if name.ends_with(".dcm") && directory.join("DELETED").join(name).exists() {
            continue;
        }
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                let result = file.write_all(bytes).and_then(|_| file.sync_all());
                drop(file);
                if let Err(error) = result {
                    let _ = std::fs::remove_file(&path);
                    return Err(format!("Cannot prepare a demo image: {error}"));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if std::fs::read(&path).map_err(|e| e.to_string())? != bytes {
                    return Err("A demo file has changed. Move the John Smith sample folder aside, then reopen the demo to restore the bundled images.".into());
                }
            }
            Err(error) => return Err(format!("Cannot prepare the demo folder: {error}")),
        }
    }
    let mut study = patient::discover(&directory, "DEMO")?;
    // Open all five samples, including earlier acquisitions, for the demonstration.
    study.latest_date_paths = study.paths.clone();
    Ok(study)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reloading_demo_keeps_deleted_samples_out_of_the_viewer() {
        let root = tempfile::tempdir().unwrap();
        let study = open(root.path()).unwrap();
        let directory = Path::new(&study.directory);
        assert!(!directory.join("DELETED").exists());
        let source = directory.join("Radiograph-01.dcm");
        let results = crate::deleted::move_images(vec![crate::deleted::DeleteItem {
            path: source.to_string_lossy().into_owned(),
            directory: Some(study.directory.clone()),
            source_sha256: crate::image_settings::fingerprint(&source).unwrap(),
        }]);
        assert!(results[0].destination.is_some());
        let refreshed = open(root.path()).unwrap();
        assert_eq!(refreshed.paths.len(), 4);
        assert!(!source.exists());
    }
    #[test]
    fn self_contained_demo_opens_five_unchanged_images_as_john_smith_and_keeps_edits() {
        let root = tempfile::tempdir().unwrap();
        let study = open(root.path()).unwrap();
        assert_eq!(study.patient_name.as_deref(), Some("John Smith"));
        assert_eq!(study.patient_number, "DEMO");
        assert_eq!(study.paths.len(), 5);
        assert_eq!(study.latest_date_paths, study.paths);
        assert!(Path::new(&study.directory).ends_with("John Smith"));
        for &(name, bytes) in FILES {
            assert_eq!(
                std::fs::read(Path::new(&study.directory).join(name)).unwrap(),
                bytes
            );
            if name.ends_with(".dcm") {
                let source = rad_core::decode(&Path::new(&study.directory).join(name)).unwrap();
                assert!(source.width > 0 && source.height > 0);
                assert!(source.metadata.image_date.is_some());
            }
        }
        let sidecar = Path::new(&study.directory).join("Radiograph-01.dcm.rad-viewer.xml");
        std::fs::write(&sidecar, b"retained edits").unwrap();
        assert_eq!(open(root.path()).unwrap().paths, study.paths);
        assert_eq!(std::fs::read(sidecar).unwrap(), b"retained edits");
    }

    #[test]
    fn demo_does_not_overwrite_changed_sample_files() {
        let root = tempfile::tempdir().unwrap();
        open(root.path()).unwrap();
        let path = root.path().join("John Smith/Radiograph-01.dcm");
        std::fs::write(&path, b"changed").unwrap();
        assert!(open(root.path()).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"changed");
    }
}

use quick_xml::{events::Event, Reader, XmlVersion};
use serde::Serialize;
use std::{collections::HashMap, fs, io::Read, path::Path};

// Embedded acquisition/content dates take precedence over copy timestamps.
// Undated images use file modification day; modification time resolves same-day ties.
fn recency_key(path: &Path) -> (i64, i64) {
    let modified = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|time| time.as_secs().min(i64::MAX as u64) as i64)
        .unwrap_or(0);
    let image_day = rad_core::decode::read_image_date(path)
        .and_then(|date| chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok())
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|date| date.and_utc().timestamp().div_euclid(86_400))
        .unwrap_or(modified.div_euclid(86_400));
    (image_day, modified)
}

fn newest_first(paths: &mut [String]) {
    // Cache each header read: sorting must not repeatedly access network files.
    paths.sort_by_cached_key(|path| {
        (
            std::cmp::Reverse(recency_key(Path::new(path))),
            path.to_lowercase(),
        )
    });
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatientStudy {
    pub patient_number: String,
    pub patient_name: Option<String>,
    pub directory: String,
    pub paths: Vec<String>,
    pub warnings: Vec<String>,
}

fn parameters(xml: &str) -> Result<HashMap<String, String>, String> {
    let mut reader = Reader::from_str(xml);
    let mut values = HashMap::new();
    let mut in_patient = false;
    let mut seen_patient = false;
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(e) if e.name().as_ref() == "patient" => {
                if seen_patient {
                    return Err("Multiple patient records are not supported".into());
                }
                seen_patient = true;
                in_patient = true;
            }
            Event::End(e) if e.name().as_ref() == "patient" => in_patient = false,
            Event::Empty(e) | Event::Start(e) if in_patient && e.name().as_ref() == "parameter" => {
                let mut key = None;
                let mut value = None;
                for attr in e.attributes() {
                    let attr = attr.map_err(|e| e.to_string())?;
                    let text = attr
                        .normalized_value(XmlVersion::Implicit1_0)
                        .map_err(|e| e.to_string())?
                        .into_owned();
                    match attr.key.as_ref() {
                        "key" => key = Some(text),
                        "value" => value = Some(text),
                        _ => {}
                    }
                }
                if let (Some(key), Some(value)) = (key, value) {
                    values.insert(key, value);
                }
            }
            Event::DocType(_) => return Err("Document types are not supported".into()),
            Event::Eof if in_patient => return Err("Unclosed patient element".into()),
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(values)
}

fn is_radiograph(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "rvg" | "pano" | "sc" | "cs" | "dcm" | "dicom" | "jpg" | "jpeg" | "png"
    ) {
        return true;
    }
    // Recognize standard DICOM files regardless of their suffix without decoding pixels.
    let mut header = [0; 132];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .is_ok()
        && &header[128..] == b"DICM"
}

fn scan(
    directory: &Path,
    paths: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let mut pending = vec![directory.to_path_buf()];
    while let Some(folder) = pending.pop() {
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(e) if folder == directory => {
                return Err(format!(
                    "Cannot read radiograph folder {}: {e}",
                    folder.display()
                ))
            }
            Err(e) => {
                warnings.push(format!("Cannot read subfolder {}: {e}", folder.display()));
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    warnings.push(e.to_string());
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(value) => value,
                Err(e) => {
                    warnings.push(format!("Cannot inspect {}: {e}", path.display()));
                    continue;
                }
            };
            // Avoid junction/symlink loops and wandering outside this patient's directory.
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    continue;
                }
            }
            if metadata.is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() && is_radiograph(&path) {
                paths.push(path.to_string_lossy().into_owned());
            }
        }
    }
    paths.sort_by_key(|path| path.to_lowercase());
    paths.dedup();
    Ok(())
}

pub fn discover(local: &Path, number: &str) -> Result<PatientStudy, String> {
    let mut warnings = Vec::new();
    let metadata_path = local.join("PatientInfo.xml");
    let values = match fs::File::open(&metadata_path) {
        Ok(file) => {
            let mut xml = String::new();
            match file.take(1_048_577).read_to_string(&mut xml) {
                Ok(_) if xml.len() <= 1_048_576 => match parameters(&xml) {
                    Ok(v) => v,
                    Err(e) => {
                        warnings.push(format!(
                            "PatientInfo.xml could not be read: {e}. Using the local folder."
                        ));
                        HashMap::new()
                    }
                },
                _ => {
                    warnings.push("PatientInfo.xml is too large or is not valid UTF-8. Using the local folder.".into());
                    HashMap::new()
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
        Err(e) => {
            warnings.push(format!(
                "Cannot read PatientInfo.xml: {e}. Using the local folder."
            ));
            HashMap::new()
        }
    };
    let name = [values.get("first_name"), values.get("last_name")]
        .into_iter()
        .flatten()
        .map(|s| s.trim().trim_end_matches(',').trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut directory = local.to_path_buf();
    if let Some(location) = values.get("directory").filter(|s| !s.trim().is_empty()) {
        let candidate = Path::new(location.trim());
        directory = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            local.join(candidate)
        };
    }
    let mut paths = Vec::new();
    if let Err(error) = scan(&directory, &mut paths, &mut warnings) {
        if directory == local {
            return Err(error);
        }
        warnings.push(format!("{error}. Using the local patient folder."));
        directory = local.to_path_buf();
        paths.clear();
        scan(&directory, &mut paths, &mut warnings)?;
    }
    newest_first(&mut paths);
    Ok(PatientStudy {
        patient_number: number.into(),
        patient_name: (!name.is_empty()).then_some(name),
        directory: directory.to_string_lossy().into_owned(),
        paths,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dated_header(path: &Path, date: &str) {
        let mut bytes = vec![0; 128];
        bytes.extend(b"DICM");
        let syntax = b"1.2.840.10008.1.2.1\0";
        bytes.extend(b"\x02\x00\x00\x00UL\x04\x00");
        bytes.extend((8u32 + syntax.len() as u32).to_le_bytes());
        bytes.extend(b"\x02\x00\x10\x00UI");
        bytes.extend((syntax.len() as u16).to_le_bytes());
        bytes.extend(syntax);
        bytes.extend(b"\x08\x00\x22\x00DA\x08\x00");
        bytes.extend(date.as_bytes());
        // Stop before later metadata/pixel payload; no usable image is needed.
        bytes.extend(b"\x10\x00\x10\x00PN\x00\x00");
        fs::write(path, bytes).unwrap();
    }

    fn modified_at(path: &Path, seconds: u64) {
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(
                fs::FileTimes::new()
                    .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds)),
            )
            .unwrap();
    }

    #[test]
    fn newest_images_use_embedded_dates_before_copy_timestamps() {
        let root = tempfile::tempdir().unwrap();
        let recent = root.path().join("C1.sc");
        let older = root.path().join("R1.rvg");
        let undated = root.path().join("photo.png");
        dated_header(&recent, "20261014");
        dated_header(&older, "20261013");
        fs::write(&undated, []).unwrap();
        modified_at(&recent, 1_000);
        modified_at(&older, 2_000_000_000);
        modified_at(&undated, 1_000_000_000);
        assert_eq!(
            rad_core::decode::read_image_date(&recent).as_deref(),
            Some("2026-10-14")
        );
        let study = discover(root.path(), "12").unwrap();
        let names: Vec<_> = study
            .paths
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_str().unwrap())
            .collect();
        assert_eq!(names, ["C1.sc", "R1.rvg", "photo.png"]);
    }

    #[test]
    fn undated_images_use_modification_time_with_deterministic_name_ties() {
        let root = tempfile::tempdir().unwrap();
        for (name, seconds) in [("a.png", 100), ("b.png", 200), ("c.png", 200)] {
            let path = root.path().join(name);
            fs::write(&path, []).unwrap();
            modified_at(&path, seconds);
        }
        let study = discover(root.path(), "12").unwrap();
        let names: Vec<_> = study
            .paths
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_str().unwrap())
            .collect();
        assert_eq!(names, ["b.png", "c.png", "a.png"]);
    }
    #[test]
    fn xml_name_entities_and_directory() {
        let values = parameters(r#"<trophy><patient><parameter key="first_name" value="A &amp; B"/><parameter key="directory" value="images"/></patient></trophy>"#).unwrap();
        assert_eq!(values["first_name"], "A & B");
        assert_eq!(values["directory"], "images");
        assert!(parameters("<!DOCTYPE p><p/>").is_err());
        assert!(parameters("<patient><parameter></patient>").is_err());
        assert!(parameters("<trophy><patient></patient><patient></patient></trophy>").is_err());
        assert!(parameters("<patient><patient></patient></patient>").is_err());
    }
    #[test]
    fn discovers_all_images_recursively_from_xml_with_no_24_limit() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("images/nested")).unwrap();
        fs::write(root.path().join("PatientInfo.xml"), r#"<trophy><patient><parameter key="first_name" value="Test"/><parameter key="last_name" value="Person,"/><parameter key="directory" value="images"/></patient></trophy>"#).unwrap();
        for n in 0..30 {
            fs::write(root.path().join(format!("images/nested/{n}.RVG")), []).unwrap();
        }
        let mut dicom = vec![0; 132];
        dicom[128..].copy_from_slice(b"DICM");
        fs::write(root.path().join("images/content.bin"), dicom).unwrap();
        fs::write(root.path().join("images/note.xml"), "<note/>").unwrap();
        let study = discover(root.path(), "00102").unwrap();
        assert_eq!(study.paths.len(), 31);
        assert_eq!(study.patient_number, "00102");
        assert_eq!(study.patient_name.as_deref(), Some("Test Person"));
        assert!(study.warnings.is_empty());
    }
    #[test]
    fn secondary_capture_suffixes_are_discovered_case_insensitively() {
        let root = tempfile::tempdir().unwrap();
        for name in ["C1.sc", "C2.SC", "C3.cs", "C4.CS"] {
            fs::write(root.path().join(name), []).unwrap();
        }
        let study = discover(root.path(), "12").unwrap();
        assert_eq!(study.paths.len(), 4);
    }
    #[test]
    fn unavailable_xml_directory_falls_back_and_missing_xml_is_supported() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("image.png"), []).unwrap();
        assert_eq!(discover(root.path(), "12").unwrap().paths.len(), 1);
        fs::write(
            root.path().join("PatientInfo.xml"),
            r#"<patient><parameter key="directory" value="absent"/></patient>"#,
        )
        .unwrap();
        let study = discover(root.path(), "12").unwrap();
        assert_eq!(study.paths.len(), 1);
        assert_eq!(study.warnings.len(), 1);
        assert!(study.patient_name.is_none());
    }
}

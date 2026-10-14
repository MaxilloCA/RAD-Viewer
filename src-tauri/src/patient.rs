use quick_xml::{events::Event, Reader, XmlVersion};
use serde::Serialize;
use std::{collections::HashMap, fs, io::Read, path::Path};

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
        "rvg" | "pano" | "dcm" | "dicom" | "jpg" | "jpeg" | "png"
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

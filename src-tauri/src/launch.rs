use std::ffi::OsString;

pub fn validate_patient_number(value: &str) -> Result<&str, String> {
    let number = value.trim();
    if !(2..=64).contains(&number.len()) || !number.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Enter a patient number containing 2–64 digits only.".into());
    }
    Ok(number)
}

/// Parse arguments after the executable path. Keep IDs as text, including zeros.
/// A query-style alias is accepted as a separate argument, never as part of an
/// executable filename (Windows cannot launch an executable with that suffix).
pub fn parse_patient_number(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<Option<String>, String> {
    let mut arguments = arguments.into_iter();
    let mut patient_number = None;
    while let Some(argument) = arguments.next() {
        let argument = argument
            .into_string()
            .map_err(|_| "Launch arguments must contain valid text.".to_string())?;
        let value = if argument == "--patnum" {
            arguments
                .next()
                .ok_or("Missing patient number. Use --patnum 67751.")?
                .into_string()
                .map_err(|_| "Patient number must contain 2–64 digits only.".to_string())?
        } else if let Some(value) = argument
            .strip_prefix("--patnum=")
            .or_else(|| argument.strip_prefix("patnum="))
            .or_else(|| argument.strip_prefix("?patnum="))
        {
            value.to_owned()
        } else {
            return Err(
                "Unrecognized launch argument. Use --patnum followed by the patient number.".into(),
            );
        };
        if patient_number.is_some() {
            return Err("Supply only one patient number per viewer instance.".into());
        }
        patient_number = Some(validate_patient_number(&value)?.to_owned());
    }
    Ok(patient_number)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Result<Option<String>, String> {
        parse_patient_number(arguments.iter().map(OsString::from))
    }

    #[test]
    fn no_arguments_opens_without_a_patient() {
        assert_eq!(parse(&[]).unwrap(), None);
    }

    #[test]
    fn accepts_supported_forms_and_preserves_leading_zeros() {
        for arguments in [
            vec!["--patnum", "00102"],
            vec!["--patnum=00102"],
            vec!["patnum=00102"],
            vec!["?patnum=00102"],
            vec!["--patnum", " 00102 "],
        ] {
            assert_eq!(parse(&arguments).unwrap(), Some("00102".into()));
        }
        assert_eq!(parse(&["--patnum", "12"]).unwrap(), Some("12".into()));
        let longest = "1".repeat(64);
        assert_eq!(parse(&["--patnum", &longest]).unwrap(), Some(longest));
    }

    #[test]
    fn rejects_missing_or_malformed_patient_numbers() {
        assert!(parse(&["--patnum"]).unwrap_err().contains("Missing"));
        for value in [
            "",
            "1",
            "../67751",
            "67/751",
            "67\\751",
            "-67751",
            "67 751",
            "６７７５１",
            "[PatNum]",
            "67751&other=1",
        ] {
            assert!(parse(&["--patnum", value]).is_err(), "{value}");
            assert!(parse(&[&format!("--patnum={value}")]).is_err(), "{value}");
        }
        assert!(parse(&["--patnum", &"1".repeat(65)]).is_err());
        assert!(parse(&["--patnum", "--other"]).is_err());
    }

    #[test]
    fn rejects_duplicate_ids_and_unknown_arguments() {
        for arguments in [
            vec!["--patnum", "67751", "--patnum=67751"],
            vec!["patnum=67751", "?patnum=66675"],
            vec!["--other", "67751"],
            vec!["67751"],
            vec!["--patnum=67751", "unexpected"],
        ] {
            assert!(parse(&arguments).is_err(), "{arguments:?}");
        }
    }
}

use base64::Engine;

#[cfg(windows)]
fn run(mode: &str, printer: &str, path: &std::path::Path) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let script: Vec<u8> = include_str!("printing.ps1")
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    let shell = std::path::PathBuf::from(
        std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?,
    )
    .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let output = std::process::Command::new(shell)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &base64::engine::general_purpose::STANDARD.encode(script),
        ])
        .env("RAD_PRINT_MODE", mode)
        .env("RAD_PRINT_PRINTER", printer)
        .env("RAD_PRINT_FILE", path)
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Could not start Windows printing: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_start_matches('\u{feff}')
        .to_string())
}

#[cfg(not(windows))]
fn run(_: &str, _: &str, _: &std::path::Path) -> Result<String, String> {
    Err("Printing requires Windows".into())
}

#[tauri::command]
pub async fn list_printers() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let json = run("list", "", std::path::Path::new(""))?;
        serde_json::from_str(&json).map_err(|e| format!("Could not read Windows printers: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_png(png: &str) -> Result<Vec<u8>, String> {
    if png.len() > 20_000_000 {
        return Err("Print image is too large".into());
    }
    let data = png
        .strip_prefix("data:image/png;base64,")
        .ok_or("Invalid print image")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Invalid print image encoding")?;
    let decoder = image::codecs::png::PngDecoder::new(std::io::Cursor::new(&bytes))
        .map_err(|e| e.to_string())?;
    use image::ImageDecoder;
    if decoder.dimensions() != (1800, 1200) {
        return Err("Print image must be 1800 x 1200 pixels (4 x 6 inches at 300 dpi)".into());
    }
    Ok(bytes)
}

fn verify_submission(response: &str) -> Result<(), String> {
    if response == "RAD_PRINT_SUBMITTED" {
        Ok(())
    } else {
        Err(
            "Windows printing ended without confirming submission. Check the printer and retry."
                .into(),
        )
    }
}

#[tauri::command]
pub async fn print_radiographs(png: String, printer: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if printer.trim().is_empty() || printer.len() > 1024 {
            return Err("Select a Windows printer".into());
        }
        let bytes = validate_png(&png)?;
        let directory = std::env::temp_dir().join(format!("rad-print-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        let path = directory.join("radiographs.png");
        let result = std::fs::write(&path, bytes)
            .map_err(|e| e.to_string())
            .and_then(|_| {
                run("print", &printer, &path).and_then(|response| verify_submission(&response))
            });
        let cleanup = std::fs::remove_dir_all(&directory)
            .map_err(|e| format!("Could not remove temporary print file: {e}"));
        result.and(cleanup)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_explicit_submission_confirmation() {
        assert!(verify_submission("RAD_PRINT_SUBMITTED").is_ok());
        assert!(verify_submission("").is_err());
        assert!(verify_submission("unexpected output").is_err());
    }
    #[test]
    fn rejects_invalid_and_wrong_size_prints() {
        assert!(validate_png("data:text/html;base64,AAAA").is_err());
        assert!(validate_png("data:image/png;base64,!!!!").is_err());
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::RgbaImage::new(10, 10)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        assert!(validate_png(&format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes.into_inner())
        ))
        .is_err());
    }
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::ImageEncoder;
use rad_core::processing::ProcessingSession;
use rad_core::{decode, process, ImageMetadata, Recipe, SourceImage};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::{Manager, State};
use tokio::sync::Semaphore;

struct Entry {
    source: Arc<SourceImage>,
    processor: Arc<tokio::sync::Mutex<ProcessingSession>>,
    latest: u64,
}
#[derive(Clone)]
struct Cached {
    bytes: Vec<u8>,
    info: RenderInfo,
    image_id: String,
    neutral: bool,
}
struct AppState {
    images: Mutex<HashMap<String, Entry>>,
    renders: Mutex<HashMap<String, Cached>>,
    source_paths: Arc<Mutex<Vec<PathBuf>>>,
    workers: Arc<Semaphore>,
}
impl Default for AppState {
    fn default() -> Self {
        Self {
            images: Mutex::new(HashMap::new()),
            renders: Mutex::new(HashMap::new()),
            source_paths: Arc::new(Mutex::new(Vec::new())),
            workers: Arc::new(Semaphore::new(2)),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageInfo {
    id: String,
    width: u32,
    height: u32,
    metadata: ImageMetadata,
    neutral: Recipe,
    decode_ms: f64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderInfo {
    id: String,
    request_id: u64,
    url: String,
    histogram: Vec<u32>,
    clipped_low: u32,
    clipped_high: u32,
    render_ms: f64,
}
#[derive(Serialize, Deserialize)]
struct CustomPreset {
    name: String,
    recipe: Recipe,
}

fn png(render: &rad_core::RenderedImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut bytes,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Sub,
    )
    .write_image(
        &render.rgba,
        render.width,
        render.height,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| e.to_string())?;
    Ok(bytes)
}
#[tauri::command]
async fn choose_images() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Open radiographs")
            .add_filter(
                "Radiographs",
                &["rvg", "pano", "dcm", "dicom", "jpg", "jpeg", "png"],
            )
            .add_filter("All files (DICOM by content)", &["*"])
            .pick_files()
            .unwrap_or_default()
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn choose_reference() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Open Carestream rendered reference")
            .add_filter("Rendered reference", &["png", "jpg", "jpeg"])
            .pick_file()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn import_image(path: String, state: State<'_, AppState>) -> Result<ImageInfo, String> {
    if state.images.lock().unwrap().len() >= 24 {
        return Err("Close an image before opening more (24 image limit).".into());
    }
    let path = PathBuf::from(path);
    // Protect in-flight imports too, including paths whose decoding later fails.
    state
        .source_paths
        .lock()
        .unwrap()
        .push(std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone()));
    let permit = state
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    let decode_path = path.clone();
    let (source, elapsed) = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let start = Instant::now();
        decode(&decode_path).map(|s| (s, start.elapsed().as_secs_f64() * 1000.0))
    })
    .await
    .map_err(|e| e.to_string())??;
    let id = uuid::Uuid::new_v4().to_string();
    let info = ImageInfo {
        id: id.clone(),
        width: source.width,
        height: source.height,
        neutral: Recipe::neutral(&source),
        metadata: source.metadata.clone(),
        decode_ms: elapsed,
    };
    let mut images = state.images.lock().unwrap();
    if images.len() >= 24 {
        return Err("Close an image before opening more (24 image limit).".into());
    }
    let source = Arc::new(source);
    let processor = Arc::new(tokio::sync::Mutex::new(ProcessingSession::new(
        source.clone(),
    )));
    images.insert(
        id,
        Entry {
            source,
            processor,
            latest: 0,
        },
    );
    Ok(info)
}
#[tauri::command]
async fn render_image(
    id: String,
    recipe: Recipe,
    request_id: u64,
    state: State<'_, AppState>,
) -> Result<RenderInfo, String> {
    let (source, processor) = {
        let mut images = state.images.lock().unwrap();
        let entry = images.get_mut(&id).ok_or("Image is closed")?;
        if request_id < entry.latest {
            return Err("Superseded render".into());
        }
        entry.latest = request_id;
        (entry.source.clone(), entry.processor.clone())
    };
    let recipe_key = serde_json::to_string(&recipe).map_err(|e| e.to_string())?;
    let key = format!("{id}:{recipe_key}");
    if let Some(cached) = state.renders.lock().unwrap().get(&key) {
        let mut info = cached.info.clone();
        info.request_id = request_id;
        return Ok(info);
    }
    let (mut processor, permit) = processing_slot(&state, &id, request_id, processor).await?;
    let neutral = serde_json::to_string(&Recipe::neutral(&source)).unwrap() == recipe_key;
    let (bytes, render, elapsed) = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let start = Instant::now();
        let render = processor.process(&recipe)?;
        let bytes = png(&render)?;
        Ok::<_, String>((bytes, render, start.elapsed().as_secs_f64() * 1000.0))
    })
    .await
    .map_err(|e| e.to_string())??;
    let images = state.images.lock().unwrap();
    if images.get(&id).map(|e| e.latest) != Some(request_id) {
        return Err("Superseded render".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    let info = RenderInfo {
        id: id.clone(),
        request_id,
        url: format!("http://rad.localhost/{token}"),
        histogram: render.histogram,
        clipped_low: render.clipped_low,
        clipped_high: render.clipped_high,
        render_ms: elapsed,
    };
    let mut cache = state.renders.lock().unwrap();
    // Keep a pinned neutral baseline and the two most recent adjusted versions per source.
    let mut old: Vec<_> = cache
        .iter()
        .filter(|(_, c)| c.image_id == id && !c.neutral)
        .map(|(k, c)| (k.clone(), c.info.request_id))
        .collect();
    old.sort_by_key(|(_, r)| *r);
    let remove_count = old.len().saturating_sub(1);
    for (k, _) in old.into_iter().take(remove_count) {
        cache.remove(&k);
    }
    cache.insert(
        key,
        Cached {
            bytes,
            info: info.clone(),
            image_id: id,
            neutral,
        },
    );
    Ok(info)
}

async fn processing_slot(
    state: &AppState,
    id: &str,
    request_id: u64,
    processor: Arc<tokio::sync::Mutex<ProcessingSession>>,
) -> Result<
    (
        tokio::sync::OwnedMutexGuard<ProcessingSession>,
        tokio::sync::OwnedSemaphorePermit,
    ),
    String,
> {
    // Waiting on one source must not occupy another source's worker slot.
    let processor = processor.lock_owned().await;
    let permit = state
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    // Includes requests superseded during either wait, and closed images.
    if state.images.lock().unwrap().get(id).map(|e| e.latest) != Some(request_id) {
        return Err("Superseded render".into());
    }
    Ok((processor, permit))
}
#[tauri::command]
fn release_image(id: String, state: State<'_, AppState>) {
    state.images.lock().unwrap().remove(&id);
    state
        .renders
        .lock()
        .unwrap()
        .retain(|_, v| v.image_id != id);
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let temp = path.with_file_name(format!(".rad-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}
#[tauri::command]
async fn load_presets(app: tauri::AppHandle) -> Result<Vec<CustomPreset>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("presets-v1.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Cannot load custom presets: {e}"))
}
#[tauri::command]
async fn save_presets(presets: Vec<CustomPreset>, app: tauri::AppHandle) -> Result<(), String> {
    if presets.len() > 100
        || presets
            .iter()
            .any(|p| p.name.trim().is_empty() || p.name.len() > 100)
    {
        return Err("Use up to 100 named presets (100 characters each).".into());
    }
    for preset in &presets {
        preset.recipe.validate()?;
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    atomic_write(
        &dir.join("presets-v1.json"),
        &serde_json::to_vec_pretty(&presets).map_err(|e| e.to_string())?,
    )
}
fn protects_source(path: &Path, sources: &[PathBuf]) -> bool {
    let candidate = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    sources.iter().any(|p| {
        std::fs::canonicalize(p)
            .unwrap_or_else(|_| p.clone())
            .to_string_lossy()
            .eq_ignore_ascii_case(&candidate.to_string_lossy())
    })
}
#[tauri::command]
async fn export_image(
    id: String,
    recipe: Recipe,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let source = state
        .images
        .lock()
        .unwrap()
        .get(&id)
        .ok_or("Image is closed")?
        .source
        .clone();
    let source_paths = state.source_paths.clone();
    let permit = state
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let Some(path) = rfd::FileDialog::new()
            .set_title("Export full resolution adjusted image")
            .set_file_name("radiograph-adjusted.png")
            .add_filter("PNG", &["png"])
            .save_file()
        else {
            return Ok(None);
        };
        let bytes = png(&process(&source, &recipe)?)?;
        let sources = source_paths.lock().unwrap();
        if protects_source(&path, &sources) {
            return Err("Choose a new file. Original images cannot be overwritten.".into());
        }
        atomic_write(&path, &bytes)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_review(
    review: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let source_paths = state.source_paths.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("Save comparison review")
            .set_file_name("rad-comparison-review.json")
            .add_filter("JSON", &["json"])
            .save_file()
        else {
            return Ok(None);
        };
        let sources = source_paths.lock().unwrap();
        if protects_source(&path, &sources) {
            return Err("Original images cannot be overwritten.".into());
        }
        atomic_write(
            &path,
            &serde_json::to_vec_pretty(&review).map_err(|e| e.to_string())?,
        )?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .register_uri_scheme_protocol("rad", |context, request| {
            let token = request.uri().path().trim_start_matches('/');
            let state = context.app_handle().state::<AppState>();
            let cache = state.renders.lock().unwrap();
            match cache
                .values()
                .find(|c| c.info.url.ends_with(token) && !token.is_empty())
            {
                Some(c) => tauri::http::Response::builder()
                    .header("Content-Type", "image/png")
                    .header("Cache-Control", "private, max-age=3600, immutable")
                    .body(c.bytes.clone())
                    .unwrap(),
                None => tauri::http::Response::builder()
                    .status(404)
                    .body(vec![])
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            choose_images,
            choose_reference,
            import_image,
            render_image,
            release_image,
            load_presets,
            save_presets,
            export_image,
            save_review
        ])
        .run(tauri::generate_context!())
        .expect("RAD Viewer failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn superseded_cache_waiter_does_not_process_or_occupy_worker() {
        use std::{future::Future, task::Poll};
        tauri::async_runtime::block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("synthetic.png");
            image::GrayImage::from_raw(2, 1, vec![0, 255])
                .unwrap()
                .save(&path)
                .unwrap();
            let source = Arc::new(decode(&path).unwrap());
            let processor = Arc::new(tokio::sync::Mutex::new(ProcessingSession::new(
                source.clone(),
            )));
            let state = AppState::default();
            state.images.lock().unwrap().insert(
                "test".into(),
                Entry {
                    source,
                    processor: processor.clone(),
                    latest: 1,
                },
            );
            let held = processor.clone().lock_owned().await;
            let mut waiting = std::pin::pin!(processing_slot(&state, "test", 1, processor));
            let polled = std::future::poll_fn(|cx| Poll::Ready(waiting.as_mut().poll(cx))).await;
            assert!(polled.is_pending());
            assert_eq!(state.workers.available_permits(), 2);
            state.images.lock().unwrap().get_mut("test").unwrap().latest = 2;
            drop(held);
            assert!(matches!(waiting.await, Err(e) if e == "Superseded render"));
            assert_eq!(state.workers.available_permits(), 2);
        });
    }
    #[test]
    fn atomic_save_replaces_complete_document_and_leaves_no_temp() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("presets.json");
        atomic_write(&path, b"first document").unwrap();
        atomic_write(&path, b"second document").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second document");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    #[test]
    fn export_protects_source_even_with_case_change() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("original.png");
        std::fs::write(&path, b"source").unwrap();
        assert!(protects_source(&path, std::slice::from_ref(&path)));
        assert!(protects_source(
            &PathBuf::from(path.to_string_lossy().to_uppercase()),
            std::slice::from_ref(&path)
        ));
        assert!(!protects_source(
            &directory.path().join("export.png"),
            &[path]
        ));
    }
    #[test]
    fn encoded_png_preserves_final_pixels() {
        let render = rad_core::RenderedImage {
            width: 2,
            height: 1,
            rgba: vec![0, 1, 2, 255, 253, 254, 255, 255],
            histogram: vec![0; 256],
            clipped_low: 0,
            clipped_high: 0,
        };
        let decoded = image::load_from_memory(&png(&render).unwrap())
            .unwrap()
            .to_rgba8();
        assert_eq!(decoded.into_raw(), render.rgba);
    }
}

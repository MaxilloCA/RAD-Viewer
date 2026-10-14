//! Local-only independent decoder verification interface. Never adds display transforms.
use std::{
    env,
    fs::File,
    io::{BufWriter, Write},
    path::Path,
    time::Instant,
};
fn main() -> Result<(), String> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 {
        return Err("Usage: dump_pixels INPUT OUTPUT.f32le".into());
    }
    let start = Instant::now();
    let source = rad_core::decode(Path::new(&args[1]))?;
    let decode_ms = start.elapsed().as_secs_f64() * 1000.;
    let mut out = BufWriter::new(File::create(&args[2]).map_err(|e| e.to_string())?);
    for value in &source.samples {
        out.write_all(&value.to_le_bytes())
            .map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::json!({"width":source.width,"height":source.height,"bitsStored":source.metadata.bits_stored,"signed":source.metadata.signed,"photometric":source.metadata.photometric,"slope":source.metadata.slope,"intercept":source.metadata.intercept,"min":source.metadata.min,"max":source.metadata.max,"decodeMs":decode_ms})
    );
    Ok(())
}

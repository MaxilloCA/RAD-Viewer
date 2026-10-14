//! Local-only sharpness-slider workload. `cargo run --release -p rad-core --example cache_benchmark -- <file>`.
use rad_core::{decode, process, processing::ProcessingSession, suggested_recipe, Recipe};
use std::{path::Path, sync::Arc, time::Instant};

fn main() -> Result<(), String> {
    let path = std::env::args()
        .nth(1)
        .ok_or("Pass a local radiograph path")?;
    let source = Arc::new(decode(Path::new(&path))?);
    let mut recipe = Recipe::neutral(&source);
    recipe.gamma = 0.94;
    recipe.clahe = 0.2;
    recipe.sharpen = 0.65;
    recipe.radius = 1.5;
    recipe.threshold = 0.016;
    recipe.halo = 0.8;
    if std::env::args().nth(2).as_deref() == Some("--v2") {
        recipe = suggested_recipe(&source);
        recipe.version = 2;
        recipe.detail_mode = "radiograph".into();
        recipe.local_contrast = 0.4;
        recipe.sharpen = 5.0;
        recipe.radius = 2.2;
        recipe.threshold = 0.0015;
        recipe.halo = 0.35;
    }
    let starting_strength = recipe.sharpen;
    let mut session = ProcessingSession::new(source.clone());
    session.process(&recipe)?;
    process(&source, &recipe)?;
    let (mut cached, mut direct) = (Vec::new(), Vec::new());
    for i in 0..12 {
        recipe.sharpen = starting_strength + (i as f32) * 0.01;
        let start = Instant::now();
        let reused = session.process(&recipe)?;
        cached.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        let fresh = process(&source, &recipe)?;
        direct.push(start.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(reused.rgba, fresh.rgba, "Cache changed output pixels");
        assert_eq!(reused.histogram, fresh.histogram);
    }
    cached.sort_by(f64::total_cmp);
    direct.sort_by(f64::total_cmp);
    println!("{}x{}; 12 sharpness changes; cached median {:.2} ms, uncached median {:.2} ms; every output byte equal", source.width, source.height, (cached[5]+cached[6])/2.0, (direct[5]+direct[6])/2.0);
    Ok(())
}

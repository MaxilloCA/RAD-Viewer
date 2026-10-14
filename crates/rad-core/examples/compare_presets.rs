//! Local-only processing comparison. Outputs contain clinical pixels: keep them out of Git.
use rad_core::{decode, process, suggested_recipe, Recipe};
use std::{env, fs, path::Path, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if !(3..=4).contains(&args.len()) {
        return Err("Usage: compare_presets SOURCE OUTPUT_DIRECTORY [RECIPE.json]".into());
    }
    let source = decode(Path::new(&args[1]))?;
    let output = Path::new(&args[2]);
    fs::create_dir_all(output)?;
    let neutral = Recipe::neutral(&source);
    let mut legacy = neutral.clone();
    legacy.gamma = 0.94;
    legacy.clahe = 0.2;
    legacy.sharpen = 0.65;
    legacy.radius = 1.5;
    legacy.threshold = 0.016;
    legacy.halo = 0.8;
    let mut bitewing = suggested_recipe(&source);
    bitewing.version = 2;
    bitewing.detail_mode = "radiograph".into();
    bitewing.local_contrast = 0.4;
    bitewing.sharpen = 5.0;
    bitewing.radius = 2.2;
    bitewing.threshold = 0.0015;
    bitewing.halo = 0.35;
    let mut endo = bitewing.clone();
    endo.gamma = (endo.gamma * 1.7).min(5.0);
    endo.local_contrast = 0.3;
    endo.sharpen = 3.5;
    endo.radius = 2.0;
    endo.threshold = 0.002;
    endo.halo = 0.5;
    let mut detail = bitewing.clone();
    detail.gamma = (detail.gamma * 1.05).min(5.0);
    detail.local_contrast = 0.35;
    detail.sharpen = 6.0;
    detail.radius = 2.5;
    detail.threshold = 0.001;
    let mut recipes = vec![
        ("neutral", neutral),
        ("legacy-bitewing", legacy),
        ("bitewing", bitewing),
        ("endo", endo),
        ("detail", detail),
    ];
    if args.len() == 4 {
        recipes.clear();
        recipes.push(("candidate", serde_json::from_slice(&fs::read(&args[3])?)?));
    }
    let mut report = Vec::new();
    for (name, recipe) in recipes {
        let start = Instant::now();
        let rendered = process(&source, &recipe)?;
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        image::save_buffer(
            output.join(format!("{name}.png")),
            &rendered.rgba,
            rendered.width,
            rendered.height,
            image::ColorType::Rgba8,
        )?;
        let record = serde_json::json!({"preset":name,"recipe":recipe,"processingMs":elapsed,
            "clippedLow":rendered.clipped_low,"clippedHigh":rendered.clipped_high,
            "pixels":source.width*source.height});
        println!("{record}");
        report.push(record);
    }
    fs::write(
        output.join("recipes.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    Ok(())
}

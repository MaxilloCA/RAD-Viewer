//! Local-only selective-color comparison; generated clinical pixels must stay out of Git.
use rad_core::{decode, process, suggested_recipe};
use std::{env, fs, path::Path, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 {
        return Err("Usage: compare_colorize SOURCE OUTPUT_DIRECTORY".into());
    }
    let source = decode(Path::new(&args[1]))?;
    let original_samples = source.samples.clone();
    let output = Path::new(&args[2]);
    fs::create_dir_all(output)?;
    let mut base = suggested_recipe(&source);
    base.version = 2;
    base.detail_mode = "radiograph".into();
    base.local_contrast = 0.4;
    base.gamma = 0.22;
    base.sharpen = 6.0;
    base.radius = 2.2;
    base.threshold = 0.0015;
    base.halo = 0.35;
    let gray = process(&source, &base)?;
    let mut report = Vec::new();
    for (name, enabled, strength, scale) in [
        ("grayscale", false, 0.8, 8.0),
        ("selective", true, 0.8, 8.0),
        ("strong", true, 1.0, 8.0),
        ("broad", true, 0.8, 16.0),
    ] {
        let mut recipe = base.clone();
        recipe.colorize = enabled;
        recipe.color_strength = strength;
        recipe.color_scale = scale;
        let start = Instant::now();
        let rendered = process(&source, &recipe)?;
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(gray.histogram, rendered.histogram);
        assert_eq!(gray.clipped_low, rendered.clipped_low);
        assert_eq!(gray.clipped_high, rendered.clipped_high);
        let mut max_luma_error = 0.0_f32;
        let mut bins = [[0_u64; 2]; 10];
        for (rgb, mono) in rendered
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .zip(gray.rgba.as_chunks::<4>().0.iter())
        {
            let luma = 0.2126 * rgb[0] as f32 + 0.7152 * rgb[1] as f32 + 0.0722 * rgb[2] as f32;
            max_luma_error = max_luma_error.max((luma - mono[0] as f32).abs());
            let bin = (mono[0] as usize * 10 / 256).min(9);
            bins[bin][0] += 1;
            if rgb[..3].iter().max().unwrap() - rgb[..3].iter().min().unwrap() > 8 {
                bins[bin][1] += 1;
            }
        }
        assert!(max_luma_error <= 1.0, "color changed display brightness");
        image::save_buffer(
            output.join(format!("{name}.png")),
            &rendered.rgba,
            rendered.width,
            rendered.height,
            image::ColorType::Rgba8,
        )?;
        let record = serde_json::json!({"name":name,"recipe":recipe,"processingMs":elapsed,
            "width":rendered.width,"height":rendered.height,"maxDisplayLumaError":max_luma_error,
            "brightnessBinsTotalAndColored":bins});
        println!("{record}");
        report.push(record);
    }
    assert_eq!(source.samples, original_samples);
    fs::write(
        output.join("report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    Ok(())
}

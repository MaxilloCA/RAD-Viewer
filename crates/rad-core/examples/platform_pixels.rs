//! Portable pixel comparison output. Call through scripts/check_platform_pixels.py.
use rad_core::{decode, process, suggested_recipe, Recipe};
use std::{env, fs, io::Write, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 {
        return Err("Usage: platform_pixels INPUT OUTPUT_DIRECTORY".into());
    }
    let source = decode(Path::new(&args[1]))?;
    let output = Path::new(&args[2]);
    fs::create_dir_all(output)?;
    let mut samples = fs::File::create(output.join("source.f32le"))?;
    for value in &source.samples {
        samples.write_all(&value.to_le_bytes())?;
    }
    for (name, recipe) in [
        ("neutral", Recipe::neutral(&source)),
        ("suggested", suggested_recipe(&source)),
    ] {
        let rendered = process(&source, &recipe)?;
        fs::write(output.join(format!("{name}.rgba")), &rendered.rgba)?;
        // Exercise the same lossless PNG encoder used for individual exports.
        image::save_buffer_with_format(
            output.join(format!("{name}.png")),
            &rendered.rgba,
            rendered.width,
            rendered.height,
            image::ColorType::Rgba8,
            image::ImageFormat::Png,
        )?;
    }
    Ok(())
}

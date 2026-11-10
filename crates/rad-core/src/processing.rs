//! Versioned CPU pipelines. All spatial scales are source-image pixels.
//! Source samples stay immutable; quantization occurs only at the final RGBA conversion.
use crate::SourceImage;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub version: u32,
    pub window_center: f32,
    pub window_width: f32,
    pub gamma: f32,
    pub denoise: f32,
    pub clahe: f32,
    #[serde(default)]
    pub local_contrast: f32,
    pub sharpen: f32,
    pub radius: f32,
    pub threshold: f32,
    pub halo: f32,
    pub detail_mode: String,
    pub invert: bool,
    #[serde(default)]
    pub colorize: bool,
    #[serde(default = "default_color_strength")]
    pub color_strength: f32,
    #[serde(default = "default_color_scale")]
    pub color_scale: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub midtone_level: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<String>,
    #[serde(default = "default_midtone_width")]
    pub midtone_width: f32,
}

fn default_midtone_width() -> f32 {
    0.15
}

fn default_color_strength() -> f32 {
    0.8
}
fn default_color_scale() -> f32 {
    8.0
}

impl Recipe {
    pub fn neutral(source: &SourceImage) -> Self {
        let m = &source.metadata;
        let (lo, hi) = if source.color.is_some() || matches!(m.format.as_str(), "PNG" | "JPEG") {
            (0.0, ((1u32 << m.bits_stored.min(16)) - 1) as f32)
        } else {
            let a = m.min * m.slope + m.intercept;
            let b = m.max * m.slope + m.intercept;
            (a.min(b), a.max(b))
        };
        let (center, width) = match (m.window_center, m.window_width) {
            (Some(c), Some(w)) if c.is_finite() && w.is_finite() && w >= 1.0 => (c, w),
            _ => ((lo + hi + 1.0) * 0.5, (hi - lo + 1.0).max(2.0)),
        };
        Self {
            version: 1,
            window_center: center,
            window_width: width,
            gamma: 1.0,
            denoise: 0.0,
            clahe: 0.0,
            local_contrast: 0.0,
            sharpen: 0.0,
            radius: 2.0,
            threshold: 0.01,
            halo: 0.7,
            detail_mode: "unsharp".into(),
            invert: false,
            colorize: false,
            color_strength: default_color_strength(),
            color_scale: default_color_scale(),
            midtone_level: None,
            color_mode: None,
            midtone_width: default_midtone_width(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if !matches!(
            self.color_mode.as_deref(),
            None | Some("local" | "midtone" | "midtoneContrast")
        ) {
            return Err("Unsupported color mode".into());
        }
        if !self.midtone_width.is_finite() || !(0.02..=0.30).contains(&self.midtone_width) {
            return Err("Midtone width must be between 0.02 and 0.30".into());
        }
        if self
            .midtone_level
            .is_some_and(|v| !v.is_finite() || !(0.05..=0.95).contains(&v))
        {
            return Err("Midtone level must be between 0.05 and 0.95".into());
        }
        if !matches!(self.version, 1 | 2) {
            return Err("Unsupported processing recipe version".into());
        }
        if self.colorize && self.version != 2 {
            return Err("Colorize requires a version 2 processing recipe".into());
        }
        if !self.window_center.is_finite()
            || !self.window_width.is_finite()
            || self.window_width < 1.0
        {
            return Err("Window center must be finite and width must be at least 1".into());
        }
        for (name, v, min, max) in [
            ("gamma", self.gamma, 0.1, 5.0),
            ("denoise", self.denoise, 0.0, 1.0),
            ("CLAHE", self.clahe, 0.0, 1.0),
            ("local contrast", self.local_contrast, 0.0, 1.0),
            (
                "sharpen",
                self.sharpen,
                0.0,
                if self.version == 2 { 12.0 } else { 3.0 },
            ),
            ("radius", self.radius, 0.35, 12.0),
            ("threshold", self.threshold, 0.0, 0.25),
            ("halo suppression", self.halo, 0.0, 1.0),
            ("color strength", self.color_strength, 0.0, 1.0),
            ("color scale", self.color_scale, 2.0, 24.0),
        ] {
            if !v.is_finite() || !(min..=max).contains(&v) {
                return Err(format!("{name} must be between {min} and {max}"));
            }
        }
        if self.detail_mode != "unsharp"
            && self.detail_mode != "multiscale"
            && !(self.version == 2 && self.detail_mode == "radiograph")
        {
            return Err("Detail mode must be unsharp, multiscale, or version 2 radiograph".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct RenderedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub histogram: Vec<u32>,
    pub clipped_low: u32,
    pub clipped_high: u32,
}

/// One immutable source and one bounded, floating-point pre-detail stage.
/// Keeping the source inside the session prevents reusing another image's cache.
pub struct ProcessingSession {
    source: Arc<SourceImage>,
    prepared: Option<([u32; 9], Vec<f32>)>,
    preview: Option<SourceImage>,
    preview_prepared: Option<([u32; 9], Vec<f32>)>,
}

impl ProcessingSession {
    /// A source-coordinate patch in the same display-positive, pre-sharpen domain
    /// used by Midtone Contrast. Never sample an 8-bit or reduced preview.
    pub fn sample_reference(&self, recipe: &Recipe, x: u32, y: u32) -> Result<f32, String> {
        validate_source(&self.source, recipe)?;
        let (w, h) = (self.source.width, self.source.height);
        if x >= w || y >= h {
            return Err("Reference point is outside the image".into());
        }
        let computed;
        let values = if let Some((_, values)) = self
            .prepared
            .as_ref()
            .filter(|(key, _)| *key == preparation_key(recipe))
        {
            values
        } else {
            computed = prepare(&self.source, recipe)?;
            &computed
        };
        let mut sum = 0.0;
        let mut count = 0;
        for py in y.saturating_sub(2)..=y.saturating_add(2).min(h - 1) {
            for px in x.saturating_sub(2)..=x.saturating_add(2).min(w - 1) {
                let v = values[(py * w + px) as usize];
                sum += if recipe.invert { 1.0 - v } else { v }.clamp(0.0, 1.0);
                count += 1;
            }
        }
        Ok(sum / count as f32)
    }
    pub fn new(source: Arc<SourceImage>) -> Self {
        Self {
            source,
            prepared: None,
            preview: None,
            preview_prepared: None,
        }
    }

    /// Bounded, explicitly approximate feedback during adjustment. The immutable
    /// full-resolution source and its exact-render cache are never replaced.
    pub fn process_preview(&mut self, recipe: &Recipe) -> Result<RenderedImage, String> {
        recipe.validate()?;
        if self.source.width.max(self.source.height) <= 384 {
            return self.process(recipe);
        }
        if self.preview.is_none() {
            validate_source(&self.source, recipe)?;
            self.preview = Some(preview_source(&self.source, 384));
        }
        let source = self.preview.as_ref().unwrap();
        let scale = source.width.max(source.height) as f32
            / self.source.width.max(self.source.height) as f32;
        let mut preview_recipe = recipe.clone();
        preview_recipe.radius = (recipe.radius * scale).max(0.35);
        preview_recipe.color_scale = (recipe.color_scale * scale).max(2.0);
        let key = preparation_key(&preview_recipe);
        let values = if let Some((_, values)) = self
            .preview_prepared
            .as_ref()
            .filter(|(old, _)| *old == key)
        {
            values.clone()
        } else {
            let values = prepare_scaled(source, &preview_recipe, scale)?;
            self.preview_prepared = Some((key, values.clone()));
            values
        };
        Ok(finish_render(source, &preview_recipe, values))
    }

    pub fn process(&mut self, recipe: &Recipe) -> Result<RenderedImage, String> {
        validate_source(&self.source, recipe)?;
        let key = preparation_key(recipe);
        let values =
            if let Some((_, values)) = self.prepared.as_ref().filter(|(old, _)| *old == key) {
                values.clone()
            } else {
                let values = prepare(&self.source, recipe)?;
                // At most 32 MiB per decoded source; larger images use the
                // uncached pipeline. The library retains eight decoded sources.
                self.prepared = (values.len() <= 8 * 1024 * 1024).then(|| (key, values.clone()));
                values
            };
        Ok(finish_render(&self.source, recipe, values))
    }
}

// Only parameters consumed before fine detail/color belong in this key.
// Full-resolution and preview stages keep separate storage and spatial scales.
fn preparation_key(recipe: &Recipe) -> [u32; 9] {
    let mut key = [0u32; 9];
    key[0] = recipe.version;
    key[1..6].copy_from_slice(
        &[
            recipe.window_center,
            recipe.window_width,
            recipe.gamma,
            recipe.denoise,
            recipe.clahe,
        ]
        .map(f32::to_bits),
    );
    if recipe.version == 2 && recipe.local_contrast > 0.0 {
        key[6..].copy_from_slice(
            &[recipe.local_contrast, recipe.threshold, recipe.halo].map(f32::to_bits),
        );
    }
    key
}

/// Average every source sample into a bounded floating-point preview. Integer
/// partitions cover the full image once, without display quantization or clipping.
fn preview_source(source: &SourceImage, longest: u32) -> SourceImage {
    let ratio = longest as f64 / source.width.max(source.height) as f64;
    let width = ((source.width as f64 * ratio).round() as u32).max(1);
    let height = ((source.height as f64 * ratio).round() as u32).max(1);
    let mut samples = Vec::with_capacity((width * height) as usize);
    let mut color = source
        .color
        .as_ref()
        .map(|_| Vec::with_capacity(samples.capacity()));
    for y in 0..height {
        let y0 = y as usize * source.height as usize / height as usize;
        let y1 = (y + 1) as usize * source.height as usize / height as usize;
        for x in 0..width {
            let x0 = x as usize * source.width as usize / width as usize;
            let x1 = (x + 1) as usize * source.width as usize / width as usize;
            let count = ((x1 - x0) * (y1 - y0)) as f64;
            let mut sum = 0.0f64;
            let mut rgb = [0.0f64; 3];
            for sy in y0..y1 {
                for sx in x0..x1 {
                    let i = sy * source.width as usize + sx;
                    sum += source.samples[i] as f64;
                    if let Some(colors) = &source.color {
                        for (total, value) in rgb.iter_mut().zip(colors[i]) {
                            *total += value as f64;
                        }
                    }
                }
            }
            samples.push((sum / count) as f32);
            if let Some(colors) = &mut color {
                colors.push(rgb.map(|v| (v / count) as f32));
            }
        }
    }
    SourceImage {
        width,
        height,
        samples,
        color,
        metadata: source.metadata.clone(),
    }
}

pub fn process(source: &SourceImage, recipe: &Recipe) -> Result<RenderedImage, String> {
    validate_source(source, recipe)?;
    let values = prepare(source, recipe)?;
    Ok(finish_render(source, recipe, values))
}

fn validate_source(source: &SourceImage, recipe: &Recipe) -> Result<(), String> {
    recipe.validate()?;
    let (w, h) = (source.width as usize, source.height as usize);
    let n = w
        .checked_mul(h)
        .filter(|&n| n > 0 && n <= 100_000_000)
        .ok_or("Invalid source dimensions")?;
    if source.samples.len() != n || source.color.as_ref().is_some_and(|c| c.len() != n) {
        return Err("Source sample count does not match dimensions".into());
    }
    let m = &source.metadata;
    if !m.slope.is_finite()
        || !m.intercept.is_finite()
        || source.samples.iter().any(|v| !v.is_finite())
    {
        return Err("Non-finite source samples or modality transform".into());
    }
    Ok(())
}

fn prepare(source: &SourceImage, recipe: &Recipe) -> Result<Vec<f32>, String> {
    prepare_scaled(source, recipe, 1.0)
}

fn prepare_scaled(
    source: &SourceImage,
    recipe: &Recipe,
    spatial_scale: f32,
) -> Result<Vec<f32>, String> {
    let (w, h) = (source.width as usize, source.height as usize);
    let m = &source.metadata;
    // Normalize modality values into window-relative units before filtering. This
    // is an affine coordinate change, not display clipping; precision is retained.
    let scale = (recipe.window_width - 1.0).max(1.0);
    let origin = recipe.window_center - 0.5;
    let mut values: Vec<f32> = source
        .samples
        .iter()
        .map(|&v| (v.mul_add(m.slope, m.intercept) - origin) / scale)
        .collect();
    if values.iter().any(|v| !v.is_finite()) {
        return Err("Modality transform overflow".into());
    }
    if recipe.denoise > 0.0 {
        values = guided_denoise(&values, w, h, recipe.denoise);
    }
    // DICOM PS3.3 C.11.2 LINEAR VOI, including the width=1 threshold case.
    // MONOCHROME1 inversion precedes gamma so display-positive gamma brightens
    // either polarity consistently; explicit user inversion remains last.
    let negative = m.photometric == "MONOCHROME1";
    let inv_gamma = 1.0 / recipe.gamma;
    for v in &mut values {
        *v = if recipe.window_width == 1.0 {
            if *v <= 0.0 {
                0.0
            } else {
                1.0
            }
        } else {
            (*v + 0.5).clamp(0.0, 1.0)
        };
        if negative {
            *v = 1.0 - *v;
        }
        if recipe.gamma != 1.0 {
            *v = v.powf(inv_gamma);
        }
    }
    if recipe.clahe > 0.0 {
        values = clahe_scaled(&values, w, h, recipe.clahe, spatial_scale);
    }
    if recipe.version == 2 && recipe.local_contrast > 0.0 {
        values = radiograph_bands_scaled(&values, w, h, recipe, true, spatial_scale);
    }
    Ok(values)
}

fn finish_render(source: &SourceImage, recipe: &Recipe, mut values: Vec<f32>) -> RenderedImage {
    let (w, h) = (source.width as usize, source.height as usize);
    let n = w * h;
    let m = &source.metadata;
    // Analyze the prepared image before fine sharpening can create overshoots.
    // These final-display settings deliberately do not invalidate the tone cache.
    let mode = recipe
        .color_mode
        .as_deref()
        .unwrap_or(if recipe.midtone_level.is_some() {
            "midtone"
        } else {
            "local"
        });
    let midtone_evidence =
        (recipe.colorize && mode == "midtoneContrast" && recipe.color_strength > 0.0).then(|| {
            values
                .iter()
                .map(|&v| {
                    let v = if recipe.invert { 1.0 - v } else { v }.clamp(0.0, 1.0);
                    let d = (v - recipe.midtone_level.unwrap_or(0.5)) / recipe.midtone_width;
                    d * (0.5 - 0.5 * d * d).exp()
                })
                .collect::<Vec<_>>()
        });
    let color_evidence = (recipe.colorize && mode == "local" && recipe.color_strength > 0.0)
        .then(|| density_color_evidence(&values, w, h, recipe.color_scale));
    if recipe.sharpen > 0.0 {
        values = if recipe.version == 2 && recipe.detail_mode == "radiograph" {
            radiograph_bands(&values, w, h, recipe, false)
        } else {
            detail(&values, w, h, recipe)
        };
    }

    let mut rendered = RenderedImage {
        width: source.width,
        height: source.height,
        rgba: Vec::with_capacity(n * 4),
        histogram: vec![0; 256],
        clipped_low: 0,
        clipped_high: 0,
    };
    let color_scale = ((1u32 << m.bits_stored.min(16)) - 1).max(1) as f32;
    for (i, v) in values.into_iter().enumerate() {
        let y = if recipe.invert { 1.0 - v } else { v };
        let y = y.clamp(0.0, 1.0);
        // Counts describe exact final luminance saturation, before 8-bit rounding.
        rendered.clipped_low += u32::from(y <= 0.0);
        rendered.clipped_high += u32::from(y >= 1.0);
        let gray = quantize(y);
        rendered.histogram[gray as usize] += 1;
        if recipe.colorize {
            let evidence = color_evidence.as_ref().map_or(0.0, |e| e[i]);
            let evidence = if recipe.invert { -evidence } else { evidence };
            rendered.rgba.extend(
                match mode {
                    "midtoneContrast" => density_color(
                        y,
                        midtone_evidence.as_ref().map_or(0.0, |e| e[i]),
                        recipe.color_strength,
                    ),
                    "midtone" => midtone_color(
                        y,
                        recipe.midtone_level.unwrap_or(0.5),
                        recipe.color_strength,
                    ),
                    _ => density_color(y, evidence, recipe.color_strength),
                }
                .map(quantize),
            );
        } else if let Some(colors) = &source.color {
            let rgb = colors[i].map(|v| v / color_scale);
            let channels = recolor(rgb, y);
            rendered.rgba.extend(channels.map(quantize));
        } else {
            rendered.rgba.extend([gray; 3]);
        }
        rendered.rgba.push(255);
    }
    rendered
}

fn quantize(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn midtone_color(y: f32, level: f32, strength: f32) -> [f32; 3] {
    let amount = strength * (-0.5 * ((y - level) / 0.08).powi(2)).exp();
    recolor([1.0, 0.55, 0.02], y).map(|channel| y + amount * (channel - y))
}

/// Signed local density-change evidence, not a diagnostic or anatomical map.
/// The source-domain scale is independent of zoom. This intentionally uses the
/// prepared tone/contrast image, but never the subsequently sharpened result.
fn density_color_evidence(input: &[f32], w: usize, h: usize, scale: f32) -> Vec<f32> {
    let smooth = gaussian(input, w, h, 1.0);
    let near = gaussian(&smooth, w, h, scale);
    let far = gaussian(&smooth, w, h, scale * 2.0);
    let residual_energy: Vec<_> = input
        .iter()
        .zip(&smooth)
        .map(|(a, b)| (a - b).powi(2))
        .collect();
    let noise_energy = box_mean(&residual_energy, w, h, 3);
    let mut edges = vec![0.0; input.len()];
    for y in 0..h {
        for x in 0..w {
            let dx = smooth[y * w + (x + 1).min(w - 1)] - smooth[y * w + x.saturating_sub(1)];
            let dy = smooth[(y + 1).min(h - 1) * w + x] - smooth[y.saturating_sub(1) * w + x];
            edges[y * w + x] = smooth_step(
                ((dx * dx + dy * dy - 0.035f32.powi(2)) / (0.10f32.powi(2) - 0.035f32.powi(2)))
                    .clamp(0.0, 1.0),
            );
        }
    }
    // Protect the support of the wider neighborhood, preventing a high-contrast
    // background edge from leaving a large colored contour inside a flat region.
    let edges = box_max(&edges, w, h, (scale * 6.0).ceil() as usize + 4);
    let mut evidence = vec![0.0; input.len()];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let a = smooth[i] - near[i];
            let b = smooth[i] - far[i];
            if a * b <= 0.0 {
                continue;
            }
            let difference = 0.65 * a + 0.35 * b;
            let noise_floor = 0.0015 + 0.85 * noise_energy[i].max(0.0).sqrt();
            let activity = smooth_step(
                ((difference.abs() - noise_floor) / (0.015 + 2.0 * noise_floor)).clamp(0.0, 1.0),
            );
            let agreement = 2.0 * a.abs().min(b.abs()) / (a.abs() + b.abs());
            let upper_gate = 1.0 - smooth_step(((difference.abs() - 0.08) / 0.10).clamp(0.0, 1.0));
            let border = x.min(w - 1 - x).min(y.min(h - 1 - y)) as f32;
            let boundary_gate =
                smooth_step(((border - (2.0 * scale + 2.0)) / (2.0 * scale + 2.0)).clamp(0.0, 1.0));
            evidence[i] = difference.signum()
                * activity
                * agreement
                * upper_gate
                * (1.0 - edges[i])
                * boundary_gate;
        }
    }
    evidence
}

/// Preserve Rec.709-weighted display RGB brightness before 8-bit rounding;
/// this is not calibrated linear-light luminance or perceptual invariance.
/// Only add bounded chroma in midtones.
/// Amber (#e5a547) means locally darker, cyan (#63c7dc) locally lighter.
fn density_color(luminance: f32, evidence: f32, strength: f32) -> [f32; 3] {
    let gray = luminance.clamp(0.0, 1.0);
    let midtone = smooth_step(((gray - 0.06) / 0.18).clamp(0.0, 1.0))
        * smooth_step(((0.94 - gray) / 0.22).clamp(0.0, 1.0));
    let alpha = (evidence.abs() * strength * midtone).clamp(0.0, 1.0);
    if alpha == 0.0 {
        return [gray; 3];
    }
    let hue = if evidence < 0.0 {
        [229.0 / 255.0, 165.0 / 255.0, 71.0 / 255.0]
    } else {
        [99.0 / 255.0, 199.0 / 255.0, 220.0 / 255.0]
    };
    let mapped = recolor(hue, gray);
    mapped.map(|channel| gray + alpha * (channel - gray))
}

/// Adjust luminance and shrink chroma only as needed to remain within RGB gamut.
/// This preserves hue and requested luminance instead of clipping RGB separately.
fn recolor(rgb: [f32; 3], target: f32) -> [f32; 3] {
    let y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    if y <= 1e-8 {
        return [target; 3];
    }
    let chroma = rgb.map(|v| v - y);
    let mut gain = target / y;
    for c in chroma {
        if c > 1e-8 {
            gain = gain.min((1.0 - target) / c);
        }
        if c < -1e-8 {
            gain = gain.min(-target / c);
        }
    }
    chroma.map(|c| target + c * gain.max(0.0))
}

/// Separable box mean with replicated boundaries and f64 running sums to avoid
/// accumulated drift. Work is O(pixels), independent of radius.
fn box_mean(input: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    if radius == 0 {
        return input.to_vec();
    }
    let divisor = (2 * radius + 1) as f64;
    let mut tmp = vec![0.0; input.len()];
    let mut output = vec![0.0; input.len()];
    for y in 0..h {
        let row = y * w;
        let mut sum = input[row] as f64 * (radius + 1) as f64;
        for x in 1..=radius {
            sum += input[row + x.min(w - 1)] as f64;
        }
        for x in 0..w {
            tmp[row + x] = (sum / divisor) as f32;
            sum += input[row + (x + radius + 1).min(w - 1)] as f64;
            sum -= input[row + x.saturating_sub(radius)] as f64;
        }
    }
    // Row-major traversal keeps vertical filtering contiguous in memory.
    let mut sums = vec![0.0f64; w];
    for x in 0..w {
        sums[x] = tmp[x] as f64 * (radius + 1) as f64;
        for y in 1..=radius {
            sums[x] += tmp[y.min(h - 1) * w + x] as f64;
        }
    }
    for y in 0..h {
        let add = (y + radius + 1).min(h - 1) * w;
        let sub = y.saturating_sub(radius) * w;
        for x in 0..w {
            output[y * w + x] = (sums[x] / divisor) as f32;
            sums[x] += tmp[add + x] as f64 - tmp[sub + x] as f64;
        }
    }
    output
}

fn guided_denoise(input: &[f32], w: usize, h: usize, strength: f32) -> Vec<f32> {
    let radius = 2;
    let mean = box_mean(input, w, h, radius);
    let squares: Vec<f32> = input.iter().map(|v| v * v).collect();
    let corr = box_mean(&squares, w, h, radius);
    let epsilon = (0.005 + strength * 0.045).powi(2);
    let mut a = Vec::with_capacity(input.len());
    let mut b = Vec::with_capacity(input.len());
    for (&mu, &ms) in mean.iter().zip(&corr) {
        let var = (ms - mu * mu).max(0.0);
        let coefficient = var / (var + epsilon);
        a.push(coefficient);
        b.push(mu * (1.0 - coefficient));
    }
    let ma = box_mean(&a, w, h, radius);
    let mb = box_mean(&b, w, h, radius);
    input
        .iter()
        .zip(ma)
        .zip(mb)
        .map(|((&v, a), b)| v + strength * (a * v + b - v))
        .collect()
}

#[cfg(test)]
fn clahe(input: &[f32], w: usize, h: usize, strength: f32) -> Vec<f32> {
    clahe_scaled(input, w, h, strength, 1.0)
}

fn clahe_scaled(input: &[f32], w: usize, h: usize, strength: f32, spatial_scale: f32) -> Vec<f32> {
    const BINS: usize = 256;
    // Uniform partitions avoid a tiny partial tile at right/bottom edges.
    let tile = (128.0 * spatial_scale).round().max(8.0) as usize;
    let nx = w.div_ceil(tile);
    let ny = h.div_ceil(tile);
    let mut tables = vec![[0.0f32; BINS + 1]; nx * ny];
    for ty in 0..ny {
        for tx in 0..nx {
            let (x0, x1) = (tx * w / nx, (tx + 1) * w / nx);
            let (y0, y1) = (ty * h / ny, (ty + 1) * h / ny);
            let count = ((x1 - x0) * (y1 - y0)) as u32;
            let mut hist = [0u32; BINS];
            let (mut lo, mut hi) = (1.0f32, 0.0f32);
            for y in y0..y1 {
                for &v in &input[y * w + x0..y * w + x1] {
                    hist[((v * BINS as f32) as usize).min(BINS - 1)] += 1;
                    lo = lo.min(v);
                    hi = hi.max(v);
                }
            }
            let table = &mut tables[ty * nx + tx];
            if hi - lo < 1e-6 {
                for (i, t) in table.iter_mut().enumerate() {
                    *t = i as f32 / BINS as f32;
                }
                continue;
            }
            let limit = ((count as f32 * 3.0 / BINS as f32).ceil() as u32).max(1);
            let mut excess = 0;
            for bin in &mut hist {
                excess += bin.saturating_sub(limit);
                *bin = (*bin).min(limit);
            }
            let base = excess / BINS as u32;
            let remainder = excess % BINS as u32;
            for bin in &mut hist {
                *bin += base;
            }
            for j in 0..remainder as usize {
                hist[j * BINS / remainder as usize] += 1;
            }
            let mut cdf = 0;
            for i in 0..BINS {
                cdf += hist[i];
                table[i + 1] = cdf as f32 / count as f32;
            }
        }
    }
    let x_lookup: Vec<_> = (0..w).map(|x| tile_interpolation(x, w, nx)).collect();
    let y_lookup: Vec<_> = (0..h).map(|y| tile_interpolation(y, h, ny)).collect();
    let mut output = vec![0.0; input.len()];
    for (y, &(y0, y1, fy)) in y_lookup.iter().enumerate() {
        for (x, &(x0, x1, fx)) in x_lookup.iter().enumerate() {
            let v = input[y * w + x];
            let z = v * BINS as f32;
            let bin = (z as usize).min(BINS - 1);
            let fraction = z - bin as f32;
            let map = |tx, ty| {
                let t: &[f32; BINS + 1] = &tables[ty * nx + tx];
                t[bin] + fraction * (t[bin + 1] - t[bin])
            };
            let top = map(x0, y0) * (1.0 - fx) + map(x1, y0) * fx;
            let bottom = map(x0, y1) * (1.0 - fx) + map(x1, y1) * fx;
            output[y * w + x] = v + strength * (top * (1.0 - fy) + bottom * fy - v);
        }
    }
    output
}

fn tile_interpolation(position: usize, extent: usize, count: usize) -> (usize, usize, f32) {
    let center = |i: usize| ((i * extent / count + (i + 1) * extent / count) as f32 - 1.0) * 0.5;
    let p = position as f32;
    let guess = ((position * count / extent).min(count - 1)) as isize;
    let left = if p < center(guess as usize) {
        guess - 1
    } else {
        guess
    };
    if left < 0 {
        return (0, 0, 0.0);
    }
    let left = left as usize;
    if left + 1 >= count {
        return (count - 1, count - 1, 0.0);
    }
    (
        left,
        left + 1,
        (p - center(left)) / (center(left + 1) - center(left)),
    )
}

fn gaussian(input: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    // Discrete Gaussian at subpixel scales avoids rounding all box widths to 1.
    if sigma < 0.8 {
        let side = (-0.5 / (sigma * sigma)).exp();
        let side = side / (1.0 + 2.0 * side);
        let center = 1.0 - 2.0 * side;
        let mut tmp = vec![0.0; input.len()];
        let mut output = vec![0.0; input.len()];
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                tmp[i] = center * input[i]
                    + side
                        * (input[y * w + x.saturating_sub(1)] + input[y * w + (x + 1).min(w - 1)]);
            }
        }
        for y in 0..h {
            for x in 0..w {
                output[y * w + x] = center * tmp[y * w + x]
                    + side * (tmp[y.saturating_sub(1) * w + x] + tmp[(y + 1).min(h - 1) * w + x]);
            }
        }
        return output;
    }
    // Three box passes approximate a Gaussian with the requested standard deviation.
    let ideal = (4.0 * sigma * sigma + 1.0).sqrt();
    let mut lower = ideal.floor() as i32;
    if lower % 2 == 0 {
        lower -= 1;
    }
    lower = lower.max(1);
    let upper = lower + 2;
    let l = lower as f32;
    let passes_lower = ((12.0 * sigma * sigma - 3.0 * l * l - 12.0 * l - 9.0) / (-4.0 * l - 4.0))
        .round()
        .clamp(0.0, 3.0) as usize;
    let mut result = input.to_vec();
    for i in 0..3 {
        let size = if i < passes_lower { lower } else { upper };
        result = box_mean(&result, w, h, ((size - 1) / 2) as usize);
    }
    result
}

/// Version 2 independently implemented scale-space enhancement. Its design is
/// informed by nonlinear radiographic multiscale enhancement and noise containment
/// (Stahl/Aach/Dippel, Medical Physics 2000, doi:10.1118/1.598857). It is not a
/// reproduction of that algorithm or of any vendor's proprietary processing.
///
/// Preserve input coefficients: only add a smooth, bounded boost. Low-activity
/// bands get no additional gain below the noise threshold. Large coefficients
/// and neighborhoods containing strong edges get less gain, instead of clipping
/// every local extremum to its 3x3 range and thereby suppressing subtle detail.
fn radiograph_bands(input: &[f32], w: usize, h: usize, recipe: &Recipe, broad: bool) -> Vec<f32> {
    radiograph_bands_scaled(input, w, h, recipe, broad, 1.0)
}

fn radiograph_bands_scaled(
    input: &[f32],
    w: usize,
    h: usize,
    recipe: &Recipe,
    broad: bool,
    spatial_scale: f32,
) -> Vec<f32> {
    let fine_scales = [recipe.radius, recipe.radius * 2.0, recipe.radius * 4.0];
    let broad_scales = [4.0, 8.0, 16.0, 32.0, 64.0].map(|v| (v * spatial_scale).max(0.35));
    let (scales, weights, strength): (&[f32], &[f32], f32) = if broad {
        (&broad_scales, &[0.9, 1.2, 1.0, 0.6], recipe.local_contrast)
    } else {
        (&fine_scales, &[0.5, 0.35, 0.15], recipe.sharpen)
    };
    if strength == 0.0 {
        return input.to_vec();
    }
    let centered: Vec<f32> = input.iter().map(|v| v - 0.5).collect();
    let square: Vec<f32> = centered.iter().map(|v| v * v).collect();
    // Broad Gaussian bands otherwise turn even moderate step edges into long
    // bright/dark contours. Detect sharp transitions independently of the fine
    // halo control, then protect the entire support of every broad-band filter.
    // Smoothing first limits sensitivity to isolated pixel-scale detector noise.
    let sharp_edges = broad.then(|| {
        let smooth = gaussian(input, w, h, (2.0 * spatial_scale).max(0.35));
        let mut weights = vec![0.0; input.len()];
        for y in 0..h {
            for x in 0..w {
                let dx = smooth[y * w + (x + 2).min(w - 1)] - smooth[y * w + x.saturating_sub(2)];
                let dy = smooth[(y + 2).min(h - 1) * w + x] - smooth[y.saturating_sub(2) * w + x];
                weights[y * w + x] = smooth_step(
                    ((dx * dx + dy * dy - 0.010f32.powi(2))
                        / (0.026f32.powi(2) - 0.010f32.powi(2)))
                    .clamp(0.0, 1.0),
                );
            }
        }
        weights
    });
    let mut output = input.to_vec();
    let mut previous = if broad {
        gaussian(input, w, h, scales[0])
    } else {
        input.to_vec()
    };
    let first = usize::from(broad);
    let mut previous_scale = if broad { scales[0] } else { 0.0 };
    for (band_index, &scale) in scales[first..].iter().enumerate() {
        let smooth = gaussian(input, w, h, scale);
        let band: Vec<f32> = previous.iter().zip(&smooth).map(|(a, b)| a - b).collect();
        let energy: Vec<f32> = band.iter().map(|v| v * v).collect();
        let energy = box_mean(&energy, w, h, (scale.ceil() as usize).max(1));
        // Blurred bands contain less pixel-scale noise. This scale normalization
        // is a tuning model, not a calibrated detector noise estimate.
        let floor = recipe.threshold.powi(2) / (1.0 + previous_scale);
        let edge_radius = (scale * 3.0).ceil() as usize + 2;
        let edges = (recipe.halo > 0.0).then(|| {
            let mean = box_mean(&centered, w, h, edge_radius);
            let second = box_mean(&square, w, h, edge_radius);
            mean.into_iter()
                .zip(second)
                .map(|(m, q)| (q - m * m).max(0.0))
                .collect::<Vec<_>>()
        });
        let protected_edges = sharp_edges
            .as_ref()
            .map(|edges| box_max(edges, w, h, edge_radius));
        let edge_start = 0.1 - 0.075 * recipe.halo;
        let edge_end = edge_start * 2.4;
        let edge_start_squared = edge_start * edge_start;
        let edge_end_squared = edge_end * edge_end;
        let knee = 0.04 + 0.03 * scale / (scale + 8.0);
        let gain = strength * weights[band_index];
        for i in 0..input.len() {
            let activity = if energy[i] <= floor {
                0.0
            } else {
                smooth_step((1.0 - floor / energy[i]).clamp(0.0, 1.0))
            };
            let edge_weight = edges.as_ref().map_or(1.0, |v| {
                1.0 - smooth_step(
                    ((v[i] - edge_start_squared) / (edge_end_squared - edge_start_squared))
                        .clamp(0.0, 1.0),
                )
            });
            let edge_weight = edge_weight * protected_edges.as_ref().map_or(1.0, |e| 1.0 - e[i]);
            let coefficient = band[i];
            let relative = coefficient / knee;
            output[i] += gain * activity * edge_weight * coefficient / (1.0 + relative * relative);
        }
        previous = smooth;
        previous_scale = scale;
    }
    output
}

/// Separable rectangular maximum in O(pixels), independent of support radius.
/// A support maximum prevents a narrow detected edge from being diluted by the
/// large neighborhoods used for broad local contrast. It does not clamp pixels.
fn box_max(input: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    use std::collections::VecDeque;
    let mut tmp = vec![0.0; input.len()];
    let mut result = vec![0.0; input.len()];
    let mut queue: VecDeque<usize> = VecDeque::new();
    for y in 0..h {
        queue.clear();
        let mut next = 0;
        for x in 0..w {
            let right = (x + radius).min(w - 1);
            while next <= right {
                while queue
                    .back()
                    .is_some_and(|&j| input[y * w + j] <= input[y * w + next])
                {
                    queue.pop_back();
                }
                queue.push_back(next);
                next += 1;
            }
            while queue.front().is_some_and(|&j| j < x.saturating_sub(radius)) {
                queue.pop_front();
            }
            tmp[y * w + x] = input[y * w + queue[0]];
        }
    }
    for x in 0..w {
        queue.clear();
        let mut next = 0;
        for y in 0..h {
            let bottom = (y + radius).min(h - 1);
            while next <= bottom {
                while queue
                    .back()
                    .is_some_and(|&j| tmp[j * w + x] <= tmp[next * w + x])
                {
                    queue.pop_back();
                }
                queue.push_back(next);
                next += 1;
            }
            while queue.front().is_some_and(|&j| j < y.saturating_sub(radius)) {
                queue.pop_front();
            }
            result[y * w + x] = tmp[queue[0] * w + x];
        }
    }
    result
}

fn smooth_step(v: f32) -> f32 {
    v * v * (3.0 - 2.0 * v)
}

fn detail(input: &[f32], w: usize, h: usize, recipe: &Recipe) -> Vec<f32> {
    let fine = gaussian(input, w, h, recipe.radius);
    let coarse =
        (recipe.detail_mode == "multiscale").then(|| gaussian(input, w, h, recipe.radius * 2.5));
    let soft = |v: f32| v.signum() * (v.abs() - recipe.threshold).max(0.0);
    let mut output = Vec::with_capacity(input.len());
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let mut delta = soft(input[i] - fine[i]);
            if let Some(c) = &coarse {
                delta += 0.6 * soft(fine[i] - c[i]);
            }
            let enhanced = input[i] + recipe.sharpen * delta;
            if recipe.halo > 0.0 {
                let (mut lo, mut hi) = (input[i], input[i]);
                for yy in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                    for xx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                        lo = lo.min(input[yy * w + xx]);
                        hi = hi.max(input[yy * w + xx]);
                    }
                }
                output.push(enhanced * (1.0 - recipe.halo) + recipe.halo * enhanced.clamp(lo, hi));
            } else {
                output.push(enhanced);
            }
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ImageMetadata;

    #[test]
    fn midtone_contrast_ramp_preserves_brightness_cache_histogram_and_source() {
        let s = Arc::new(source(
            256,
            8,
            (0..2048).map(|i| (i % 256) as f32).collect(),
        ));
        let original = s.samples.clone();
        let mut r = Recipe::neutral(&s);
        r.version = 2;
        let mut session = ProcessingSession::new(s.clone());
        let gray = session.process(&r).unwrap();
        let allocation = session.prepared.as_ref().unwrap().1.as_ptr();
        r.colorize = true;
        r.color_mode = Some("midtoneContrast".into());
        r.midtone_level = Some(128.0 / 255.0);
        r.color_strength = 0.4;
        let color = session.process(&r).unwrap();
        assert_eq!(allocation, session.prepared.as_ref().unwrap().1.as_ptr());
        assert_eq!(color.rgba, process(&s, &r).unwrap().rgba);
        assert_eq!(color.histogram, gray.histogram);
        assert_eq!(
            (color.clipped_low, color.clipped_high),
            (gray.clipped_low, gray.clipped_high)
        );
        let pixel = |i: usize| &color.rgba[i * 4..i * 4 + 3];
        assert!(pixel(110)[0] > pixel(110)[2]);
        assert!(pixel(146)[2] > pixel(146)[0]);
        assert_eq!(pixel(128), &[128, 128, 128]);
        assert_eq!(pixel(0), &[0, 0, 0]);
        assert_eq!(pixel(255), &[255, 255, 255]);
        for (rgb, mono) in color
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .zip(gray.rgba.as_chunks::<4>().0.iter())
        {
            let y = rgb[0] as f32 * 0.2126 + rgb[1] as f32 * 0.7152 + rgb[2] as f32 * 0.0722;
            assert!((y - mono[0] as f32).abs() <= 1.0);
        }
        r.midtone_width = 0.05;
        let sensitive = session.process(&r).unwrap();
        let chroma = |p: &[u8]| (p[0] as i32 - p[2] as i32).abs();
        assert!(chroma(&sensitive.rgba[120 * 4..120 * 4 + 3]) > chroma(pixel(120)));
        assert!(chroma(&sensitive.rgba[60 * 4..60 * 4 + 3]) < chroma(pixel(60)));
        assert_eq!(allocation, session.prepared.as_ref().unwrap().1.as_ptr());
        r.color_strength = 0.0;
        assert_eq!(session.process(&r).unwrap().rgba, gray.rgba);
        assert_eq!(s.samples, original);
    }

    #[test]
    fn midtone_hue_and_reference_sampling_ignore_fine_sharpening() {
        let s = Arc::new(source(
            35,
            35,
            (0..1225).map(|i| 100.0 + ((i * 17) % 55) as f32).collect(),
        ));
        let mut r = Recipe::neutral(&s);
        r.version = 2;
        r.window_center = 128.0;
        r.window_width = 256.0;
        r.colorize = true;
        r.color_mode = Some("midtoneContrast".into());
        r.midtone_level = Some(0.5);
        let session = ProcessingSession::new(s.clone());
        let level = session.sample_reference(&r, 0, 0).unwrap();
        let expected: f32 = (0..3)
            .flat_map(|y| (0..3).map(move |x| (y * 35 + x) as usize))
            .map(|i| s.samples[i] / 255.0)
            .sum::<f32>()
            / 9.0;
        assert!((level - expected).abs() < 1e-6);
        assert!(session.sample_reference(&r, 35, 0).is_err());
        let prepared = prepare(&s, &r).unwrap();
        for invert in [false, true] {
            r.invert = invert;
            r.sharpen = 10.0;
            r.detail_mode = "radiograph".into();
            let rendered = process(&s, &r).unwrap();
            for (i, rgb) in rendered.rgba.as_chunks::<4>().0.iter().enumerate() {
                let tone = if invert {
                    1.0 - prepared[i]
                } else {
                    prepared[i]
                };
                if rgb[0] != rgb[2] {
                    assert_eq!(rgb[0] > rgb[2], tone < 0.5);
                }
            }
            let sampled = session.sample_reference(&r, 0, 0).unwrap();
            assert!((sampled - if invert { 1.0 - level } else { level }).abs() < 1e-6);
        }
    }

    #[test]
    fn midtone_fields_validate_and_legacy_modes_retain_pixels() {
        let s = source(64, 64, (0..4096).map(|i| (i % 256) as f32).collect());
        let mut r = Recipe::neutral(&s);
        r.version = 2;
        r.colorize = true;
        for (level, mode) in [(None, "local"), (Some(0.5), "midtone")] {
            r.midtone_level = level;
            r.color_mode = None;
            let legacy = process(&s, &r).unwrap();
            r.color_mode = Some(mode.into());
            assert_eq!(legacy.rgba, process(&s, &r).unwrap().rgba);
        }
        let mut json = serde_json::to_value(&r).unwrap();
        json.as_object_mut().unwrap().remove("colorMode");
        json.as_object_mut().unwrap().remove("midtoneWidth");
        let old: Recipe = serde_json::from_value(json).unwrap();
        assert_eq!(old.color_mode, None);
        assert_eq!(old.midtone_width, 0.15);
        r.color_mode = Some("rainbow".into());
        assert!(r.validate().is_err());
        r.color_mode = Some("midtoneContrast".into());
        for width in [f32::NAN, f32::INFINITY, 0.0, 0.019, 0.301] {
            r.midtone_width = width;
            assert!(r.validate().is_err());
        }
    }

    #[test]
    fn midtone_highlight_moves_with_level_and_preserves_processing_histogram() {
        let input = source(256, 1, (0..256).map(|v| v as f32).collect());
        let mut recipe = Recipe::neutral(&input);
        recipe.version = 2;
        recipe.gamma = 0.8;
        let gray = process(&input, &recipe).unwrap();
        recipe.colorize = true;
        recipe.midtone_level = Some(0.35);
        let colored = process(&input, &recipe).unwrap();
        assert_eq!(colored.histogram, gray.histogram);
        assert_ne!(colored.rgba, gray.rgba);
        let saturation = |c: [f32; 3]| {
            c.iter().copied().fold(f32::NEG_INFINITY, f32::max)
                - c.iter().copied().fold(f32::INFINITY, f32::min)
        };
        assert!(
            saturation(midtone_color(0.35, 0.35, 1.0))
                > saturation(midtone_color(0.35, 0.7, 1.0)) * 20.0
        );
        recipe.midtone_level = Some(0.7);
        assert_ne!(process(&input, &recipe).unwrap().rgba, colored.rgba);
        recipe.colorize = false;
        assert_eq!(process(&input, &recipe).unwrap().rgba, gray.rgba);
        recipe.midtone_level = Some(f32::NAN);
        assert!(recipe.validate().is_err());
    }

    fn source(w: u32, h: u32, values: Vec<f32>) -> SourceImage {
        let min = values.iter().copied().fold(f32::INFINITY, f32::min);
        let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        SourceImage {
            width: w,
            height: h,
            samples: values,
            color: None,
            metadata: ImageMetadata {
                name: "synthetic".into(),
                image_date: None,
                date_source: None,
                format: "test".into(),
                bits_stored: 12,
                signed: false,
                photometric: "MONOCHROME2".into(),
                slope: 1.0,
                intercept: 0.0,
                window_center: None,
                window_width: None,
                min,
                max,
            },
        }
    }
    fn grays(r: &RenderedImage) -> Vec<u8> {
        r.rgba.as_chunks::<4>().0.iter().map(|p| p[0]).collect()
    }

    #[test]
    fn cached_preview_matches_uncached_export_across_all_adjustments() {
        let s = Arc::new(source(
            63,
            35,
            (0..63 * 35).map(|i| ((i * 173) % 4096) as f32).collect(),
        ));
        let original = s.samples.clone();
        let mut session = ProcessingSession::new(s.clone());
        let mut recipe = Recipe::neutral(&s);
        let mut recipes = vec![recipe.clone()];
        recipe.denoise = 0.3;
        recipes.push(recipe.clone());
        recipe.gamma = 0.9;
        recipes.push(recipe.clone());
        recipe.clahe = 0.4;
        recipes.push(recipe.clone());
        recipe.window_center += 80.0;
        recipes.push(recipe.clone());
        recipe.window_width *= 0.8;
        recipes.push(recipe.clone());
        recipe.sharpen = 1.2;
        recipes.push(recipe.clone());
        recipe.radius = 3.2;
        recipes.push(recipe.clone());
        recipe.threshold = 0.06;
        recipes.push(recipe.clone());
        recipe.halo = 1.0;
        recipes.push(recipe.clone());
        recipe.detail_mode = "multiscale".into();
        recipes.push(recipe.clone());
        recipe.invert = true;
        recipes.push(recipe.clone());
        // Undo and reset must invalidate earlier-stage changes as well.
        recipes.extend(recipes.clone().into_iter().rev());
        for r in recipes {
            let cached = session.process(&r).unwrap();
            let direct = process(&s, &r).unwrap();
            assert_eq!(cached.rgba, direct.rgba);
            assert_eq!(cached.histogram, direct.histogram);
            assert_eq!(
                (cached.clipped_low, cached.clipped_high),
                (direct.clipped_low, direct.clipped_high)
            );
        }
        assert_eq!(s.samples, original);
    }

    #[test]
    fn cache_reuses_tone_stage_for_detail_and_never_crosses_sources() {
        let a = Arc::new(source(4, 1, vec![0.0, 512.0, 2048.0, 4095.0]));
        let b = Arc::new(source(4, 1, vec![4095.0, 2048.0, 512.0, 0.0]));
        let mut first = ProcessingSession::new(a.clone());
        let mut second = ProcessingSession::new(b.clone());
        let mut recipe = Recipe::neutral(&a);
        first.process(&recipe).unwrap();
        let cached_allocation = first.prepared.as_ref().unwrap().1.as_ptr();
        recipe.sharpen = 0.8;
        let one = first.process(&recipe).unwrap();
        assert_eq!(
            cached_allocation,
            first.prepared.as_ref().unwrap().1.as_ptr()
        );
        let two = second.process(&recipe).unwrap();
        assert_ne!(one.rgba, two.rgba);
        assert_eq!(two.rgba, process(&b, &recipe).unwrap().rgba);
        recipe.version = 3;
        assert!(first.process(&recipe).is_err());
    }

    fn radiograph_recipe() -> Recipe {
        let mut r = Recipe::neutral(&source(1, 1, vec![0.5]));
        r.version = 2;
        r.window_center = 0.5;
        r.window_width = 2.0;
        r.sharpen = 2.0;
        r.local_contrast = 0.5;
        r.radius = 1.2;
        r.threshold = 0.003;
        r.halo = 0.8;
        r.detail_mode = "radiograph".into();
        r
    }

    #[test]
    fn radiograph_enhances_subtle_detail_and_broad_local_contrast_separately() {
        let (w, h) = (256, 48);
        let pattern = |period: f32, amplitude: f32| {
            (0..w * h)
                .map(|i| 0.5 + amplitude * (std::f32::consts::TAU * (i % w) as f32 / period).sin())
                .collect::<Vec<_>>()
        };
        let rms =
            |a: &[f32]| (a.iter().map(|v| (v - 0.5).powi(2)).sum::<f32>() / a.len() as f32).sqrt();
        let fine = pattern(8.0, 0.008);
        let mut r = radiograph_recipe();
        r.threshold = 0.0015;
        let enhanced = radiograph_bands(&fine, w, h, &r, false);
        assert!(
            rms(&enhanced) > 1.35 * rms(&fine),
            "Subtle fine contrast must get meaningful enhancement"
        );
        let broad = pattern(80.0, 0.015);
        let enhanced = radiograph_bands(&broad, w, h, &r, true);
        assert!(
            rms(&enhanced) > 1.2 * rms(&broad),
            "Medium structures need their own contrast stage"
        );
    }

    #[test]
    fn radiograph_noise_containment_preserves_original_noise_without_boosting_it() {
        let (w, h) = (129, 65);
        let noisy: Vec<f32> = (0..w * h)
            .map(|i| 0.5 + if (i + i / w) % 2 == 0 { 0.002 } else { -0.002 })
            .collect();
        let mut r = radiograph_recipe();
        r.sharpen = 6.0;
        r.local_contrast = 1.0;
        r.threshold = 0.006;
        let broad = radiograph_bands(&noisy, w, h, &r, true);
        let enhanced = radiograph_bands(&broad, w, h, &r, false);
        let maximum_change = enhanced
            .iter()
            .zip(&noisy)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            maximum_change < 0.00005,
            "Noise must remain unchanged within 0.013 display levels; max={maximum_change}"
        );
        assert!(enhanced.iter().any(|v| *v < 0.499));
        assert!(enhanced.iter().any(|v| *v > 0.501));
    }

    #[test]
    fn radiograph_strong_edges_have_no_material_new_contours() {
        let (w, h) = (512, 25);
        let step: Vec<f32> = (0..w * h)
            .map(|i| if i % w < 256 { 0.15 } else { 0.85 })
            .collect();
        let mut r = radiograph_recipe();
        r.local_contrast = 1.0;
        r.sharpen = 6.0;
        r.threshold = 0.0;
        r.halo = 0.8;
        let broad = radiograph_bands(&step, w, h, &r, true);
        let enhanced = radiograph_bands(&broad, w, h, &r, false);
        let maximum_change = enhanced
            .iter()
            .zip(&step)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            maximum_change < 1.0 / 255.0,
            "Strong-edge artifacts must stay below one display level; max={maximum_change}"
        );
        let row = &enhanced[w * 12..w * 13];
        assert!(
            row.windows(2).all(|p| p[1] >= p[0] - 0.0001),
            "No material gradient reversal adjacent to strong edge"
        );
        r.halo = 0.0;
        let unprotected = radiograph_bands(&step, w, h, &r, false);
        let unprotected_change = unprotected
            .iter()
            .zip(&step)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            unprotected_change > maximum_change * 5.0,
            "Edge protection should have a measurable effect"
        );
    }

    #[test]
    fn radiograph_flat_fields_tiny_images_and_ramps_remain_finite() {
        let mut r = radiograph_recipe();
        r.sharpen = 10.0;
        r.local_contrast = 1.0;
        r.threshold = 0.0;
        for (w, h) in [(1, 1), (2, 3), (129, 65)] {
            for value in [0.0, 0.1, 0.5, 0.9, 1.0] {
                let input = vec![value; w * h];
                let output =
                    radiograph_bands(&radiograph_bands(&input, w, h, &r, true), w, h, &r, false);
                assert!(output
                    .iter()
                    .all(|v| v.is_finite() && (v - value).abs() < 1e-6));
            }
        }
        let ramp: Vec<_> = (0..512 * 20).map(|i| (i % 512) as f32 / 511.0).collect();
        let output = radiograph_bands(
            &radiograph_bands(&ramp, 512, 20, &r, true),
            512,
            20,
            &r,
            false,
        );
        assert!(output
            .iter()
            .all(|v| v.is_finite() && (-0.05..=1.05).contains(v)));
        assert!(output[512 * 10..512 * 11]
            .windows(2)
            .all(|p| p[1] >= p[0] - 1e-5));
    }

    #[test]
    fn broad_contrast_does_not_create_long_contours_at_moderate_edges() {
        for halo in [0.35, 0.7, 0.8] {
            for contrast in [0.05, 0.10, 0.15] {
                for direction in [-1.0, 1.0] {
                    for vertical in [false, true] {
                        let (w, h) = if vertical { (17, 257) } else { (257, 17) };
                        let step: Vec<_> = (0..w * h)
                            .map(|i| {
                                let coordinate = if vertical { i / w } else { i % w };
                                0.5 + direction
                                    * contrast
                                    * if coordinate < 128 { -0.5 } else { 0.5 }
                            })
                            .collect();
                        for (local, strength, radius, threshold) in [
                            (0.4, 5.0, 2.2, 0.0015), // historical v0.2 Bitewing
                            (0.35, 6.0, 2.5, 0.001), // historical v0.2 Detail
                            (0.4, 10.0, 2.5, 0.001), // maximum sharpness stress
                        ] {
                            let mut recipe = radiograph_recipe();
                            recipe.local_contrast = local;
                            recipe.sharpen = strength;
                            recipe.radius = radius;
                            recipe.threshold = threshold;
                            recipe.halo = halo;
                            let broad = radiograph_bands(&step, w, h, &recipe, true);
                            let maximum = broad
                                .iter()
                                .zip(&step)
                                .map(|(a, b)| (a - b).abs())
                                .fold(0.0f32, f32::max);
                            assert!(maximum < 0.25 / 255.0,
                            "Broad contour: contrast={contrast}, halo={halo}, vertical={vertical}, max={maximum}");
                            let final_values = radiograph_bands(&broad, w, h, &recipe, false);
                            for (i, &v) in final_values.iter().enumerate() {
                                let coordinate = if vertical { i / w } else { i % w };
                                let distance = coordinate.abs_diff(128);
                                if distance > 32 {
                                    assert!((v-step[i]).abs() < 0.25 / 255.0,
                                    "Fine enhancement must not create a long broad contour: contrast={contrast}, distance={distance}");
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn broad_edge_guard_retains_low_contrast_structure_amid_fine_noise() {
        let (w, h) = (320, 31);
        let pattern: Vec<_> = (0..w * h)
            .map(|i| {
                let phase = std::f32::consts::TAU * (i % w) as f32 / 80.0;
                let noise = ((i * 71 + i / w * 19) % 97) as f32 / 96.0 - 0.5;
                0.5 + phase.sin() * 0.015 + noise * 0.012
            })
            .collect();
        let mut recipe = radiograph_recipe();
        recipe.local_contrast = 0.4;
        recipe.threshold = 0.0015;
        recipe.halo = 0.35;
        let broad = radiograph_bands(&pattern, w, h, &recipe, true);
        let contrast = |image: &[f32]| {
            image
                .iter()
                .enumerate()
                .map(|(i, value)| {
                    (value - 0.5) * (std::f32::consts::TAU * (i % w) as f32 / 80.0).sin()
                })
                .sum::<f32>()
        };
        assert!(
            contrast(&broad) > contrast(&pattern) * 1.15,
            "Coherent broad contrast must remain visible despite fine noise and edge protection"
        );
    }

    #[test]
    fn edge_support_maximum_matches_naive_including_boundaries() {
        let (w, h) = (7, 3);
        let v: Vec<_> = (0..w * h).map(|i| ((i * 11) % 13) as f32 / 13.0).collect();
        for radius in [0, 1, 2, 8] {
            let result = box_max(&v, w, h, radius);
            for y in 0..h {
                for x in 0..w {
                    let mut expected = 0.0f32;
                    for yy in y.saturating_sub(radius)..=(y + radius).min(h - 1) {
                        for xx in x.saturating_sub(radius)..=(x + radius).min(w - 1) {
                            expected = expected.max(v[yy * w + xx]);
                        }
                    }
                    assert_eq!(result[y * w + x], expected);
                }
            }
        }
    }

    #[test]
    fn version_one_recipes_keep_old_semantics_and_deserialize_without_new_fields() {
        let s = source(
            31,
            17,
            (0..31 * 17).map(|i| ((i * 73) % 4096) as f32).collect(),
        );
        let mut r = Recipe::neutral(&s);
        r.gamma = 0.94;
        r.clahe = 0.2;
        r.sharpen = 0.65;
        r.radius = 1.5;
        r.threshold = 0.016;
        r.halo = 0.8;
        let mut json = serde_json::to_value(&r).unwrap();
        json.as_object_mut().unwrap().remove("localContrast");
        json.as_object_mut().unwrap().remove("colorize");
        json.as_object_mut().unwrap().remove("colorStrength");
        json.as_object_mut().unwrap().remove("colorScale");
        let restored: Recipe = serde_json::from_value(json).unwrap();
        assert_eq!(restored.local_contrast, 0.0);
        assert!(!restored.colorize);
        assert_eq!(restored.color_strength, 0.8);
        assert_eq!(restored.color_scale, 8.0);
        assert_eq!(
            process(&s, &restored).unwrap().rgba,
            process(&s, &r).unwrap().rgba
        );
        let old = process(&s, &r).unwrap();
        r.local_contrast = 1.0;
        assert_eq!(
            old.rgba,
            process(&s, &r).unwrap().rgba,
            "v1 must ignore v2 stage"
        );
        r.local_contrast = 0.0;
        r.version = 2;
        assert_eq!(
            old.rgba,
            process(&s, &r).unwrap().rgba,
            "unchanged legacy detail mode remains identical"
        );
        r = Recipe::neutral(&s);
        let neutral = process(&s, &r).unwrap();
        r.version = 2;
        r.detail_mode = "radiograph".into();
        assert_eq!(neutral.rgba, process(&s, &r).unwrap().rgba);
    }

    #[test]
    fn version_two_cached_and_direct_pixels_match_for_all_new_stage_keys() {
        let source = Arc::new(source(
            71,
            43,
            (0..71 * 43).map(|i| ((i * 61) % 4096) as f32).collect(),
        ));
        let original = source.samples.clone();
        let mut cached = ProcessingSession::new(source.clone());
        let mut r = Recipe::neutral(&source);
        let mut recipes = vec![r.clone()];
        r.version = 2;
        recipes.push(r.clone());
        r.detail_mode = "radiograph".into();
        r.sharpen = 2.0;
        recipes.push(r.clone());
        r.local_contrast = 0.7;
        recipes.push(r.clone());
        r.threshold = 0.003;
        recipes.push(r.clone());
        r.halo = 0.3;
        recipes.push(r.clone());
        r.gamma = 0.92;
        recipes.push(r.clone());
        r.local_contrast = 0.0;
        recipes.push(r.clone());
        r.version = 1;
        r.detail_mode = "unsharp".into();
        recipes.push(r.clone());
        recipes.extend(recipes.clone().into_iter().rev());
        for recipe in recipes {
            let a = cached.process(&recipe).unwrap();
            let b = process(&source, &recipe).unwrap();
            assert_eq!(a.rgba, b.rgba);
            assert_eq!(a.histogram, b.histogram);
            assert_eq!(
                (a.clipped_low, a.clipped_high),
                (b.clipped_low, b.clipped_high)
            );
        }
        assert_eq!(source.samples, original);
    }

    #[test]
    fn density_color_preserves_display_luma_and_gamut_without_tinting_extremes() {
        let luminance = |rgb: [f32; 3]| rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        for i in 0..=256 {
            for evidence in [-1.0, -0.4, 0.0, 0.4, 1.0] {
                let y = i as f32 / 256.0;
                let rgb = density_color(y, evidence, 0.8);
                assert!(rgb.iter().all(|c| c.is_finite() && (0.0..=1.0).contains(c)));
                assert!((luminance(rgb) - y).abs() < 1e-6);
                assert!(
                    (luminance(rgb.map(quantize).map(|c| c as f32 / 255.0)) - y).abs()
                        <= 0.5 / 255.0 + 1e-6
                );
                if y <= 0.06 || y >= 0.94 || evidence == 0.0 {
                    assert_eq!(rgb, [y; 3]);
                }
                assert_eq!(density_color(y, evidence, 0.0), [y; 3]);
            }
        }
        let amber = density_color(0.5, -1.0, 1.0);
        let cyan = density_color(0.5, 1.0, 1.0);
        assert!(amber[0] > amber[1] && amber[1] > amber[2]);
        assert!(cyan[2] > cyan[1] && cyan[1] > cyan[0]);
    }

    fn density_features(w: usize, h: usize) -> Vec<f32> {
        (0..w * h)
            .map(|i| {
                let (x, y) = ((i % w) as f32, (i / w) as f32);
                let bump = |center: f32| {
                    (-((x - center).powi(2) + (y - h as f32 / 2.0).powi(2)) / 50.0).exp()
                };
                0.5 + 0.035 * (bump(w as f32 * 0.68) - bump(w as f32 * 0.32))
            })
            .collect()
    }

    #[test]
    fn density_color_responds_to_coherent_midtone_features_more_than_noise() {
        let (w, h) = (161, 129);
        let feature = density_features(w, h);
        let signal = density_color_evidence(&feature, w, h, 8.0);
        let dark = (h / 2) * w + (w as f32 * 0.32) as usize;
        let light = (h / 2) * w + (w as f32 * 0.68) as usize;
        assert!(
            signal[dark] < -0.5 && signal[light] > 0.5,
            "Coherent low-contrast structures should receive signed color: {},{}",
            signal[dark],
            signal[light]
        );
        let noisy: Vec<_> = (0..w * h)
            .map(|i| 0.5 + (((i * 71 + i / w * 19) % 97) as f32 / 96.0 - 0.5) * 0.02)
            .collect();
        let noise = density_color_evidence(&noisy, w, h, 8.0);
        assert!(noise.iter().map(|v| v.abs()).sum::<f32>() / (noise.len() as f32) < 0.01);
        let negated: Vec<_> = feature.iter().map(|v| 1.0 - v).collect();
        let inverse = density_color_evidence(&negated, w, h, 8.0);
        assert!(signal
            .iter()
            .zip(inverse)
            .all(|(a, b)| (a + b).abs() < 1e-4));
    }

    #[test]
    fn density_color_keeps_flats_ramps_and_strong_edge_context_neutral() {
        for (w, h) in [(1, 1), (7, 3), (257, 129)] {
            for scale in [2.0, 8.0, 24.0] {
                let flat = vec![0.5; w * h];
                assert!(density_color_evidence(&flat, w, h, scale)
                    .iter()
                    .all(|v| *v == 0.0));
                let ramp: Vec<_> = (0..w * h)
                    .map(|i| 0.25 + 0.5 * (i % w) as f32 / (w.max(2) - 1) as f32)
                    .collect();
                assert!(density_color_evidence(&ramp, w, h, scale)
                    .iter()
                    .all(|v| v.abs() < 0.01));
            }
        }
        let (w, h) = (257, 129);
        let step: Vec<_> = (0..w * h)
            .map(|i| if i % w < 128 { 0.2 } else { 0.8 })
            .collect();
        assert!(density_color_evidence(&step, w, h, 8.0)
            .iter()
            .all(|v| v.abs() < 1e-4));
    }

    #[test]
    fn colorize_is_final_only_preserves_histogram_source_and_cached_gray_output() {
        let (w, h) = (161, 129);
        let mut s = source(
            w as u32,
            h as u32,
            density_features(w, h).iter().map(|v| v * 255.0).collect(),
        );
        s.metadata.format = "PNG".into();
        s.metadata.bits_stored = 8;
        let source = Arc::new(s);
        let original = source.samples.clone();
        let mut recipe = Recipe::neutral(&source);
        recipe.version = 2;
        let mut session = ProcessingSession::new(source.clone());
        let grayscale = session.process(&recipe).unwrap();
        let allocation = session.prepared.as_ref().unwrap().1.as_ptr();
        recipe.colorize = true;
        let colorized = session.process(&recipe).unwrap();
        assert_eq!(allocation, session.prepared.as_ref().unwrap().1.as_ptr());
        assert_ne!(colorized.rgba, grayscale.rgba);
        assert_eq!(colorized.histogram, grayscale.histogram);
        assert_eq!(
            (colorized.clipped_low, colorized.clipped_high),
            (grayscale.clipped_low, grayscale.clipped_high)
        );
        assert_eq!(colorized.rgba, process(&source, &recipe).unwrap().rgba);
        for scale in [2.0, 8.0, 24.0] {
            for strength in [0.0, 0.4, 1.0] {
                recipe.color_scale = scale;
                recipe.color_strength = strength;
                let cached = session.process(&recipe).unwrap();
                assert_eq!(cached.rgba, process(&source, &recipe).unwrap().rgba);
                assert_eq!(cached.histogram, grayscale.histogram);
                assert_eq!(allocation, session.prepared.as_ref().unwrap().1.as_ptr());
                if strength == 0.0 {
                    assert_eq!(cached.rgba, grayscale.rgba);
                }
            }
        }
        recipe.color_scale = 8.0;
        recipe.color_strength = 0.8;
        recipe.invert = true;
        let inverted = session.process(&recipe).unwrap();
        let dark = ((h / 2) * w + (w as f32 * 0.32) as usize) * 4;
        assert!(colorized.rgba[dark] > colorized.rgba[dark + 2]);
        assert!(inverted.rgba[dark] < inverted.rgba[dark + 2]);
        assert_eq!(inverted.rgba, process(&source, &recipe).unwrap().rgba);
        recipe.invert = false;
        recipe.colorize = false;
        assert_eq!(grayscale.rgba, session.process(&recipe).unwrap().rgba);
        assert_eq!(source.samples, original);
        recipe.version = 1;
        assert_eq!(grayscale.rgba, process(&source, &recipe).unwrap().rgba);
        recipe.colorize = true;
        assert!(process(&source, &recipe).unwrap_err().contains("version 2"));
    }

    #[test]
    fn explicit_colorize_maps_original_color_by_processed_luminance() {
        let colors = vec![
            [255.0, 0.0, 0.0],
            [25.0, 130.0, 210.0],
            [255.0; 3],
            [0.0; 3],
        ];
        let mut s = source(
            4,
            1,
            colors
                .iter()
                .map(|p| p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722)
                .collect(),
        );
        s.metadata.bits_stored = 8;
        s.metadata.format = "PNG".into();
        s.color = Some(colors.clone());
        let mut r = Recipe::neutral(&s);
        r.version = 2;
        let original_display = process(&s, &r).unwrap();
        r.colorize = true;
        r.color_strength = 0.0;
        let mapped = process(&s, &r).unwrap();
        let mut monochrome = s.clone();
        monochrome.color = None;
        assert_eq!(mapped.rgba, process(&monochrome, &r).unwrap().rgba);
        assert_ne!(mapped.rgba, original_display.rgba);
        r.colorize = false;
        assert_eq!(original_display.rgba, process(&s, &r).unwrap().rgba);
        assert_eq!(s.color.unwrap(), colors);
    }

    #[test]
    fn version_two_sharpness_through_twelve_remains_finite_and_version_one_is_bounded() {
        let (w, h) = (65, 33);
        let samples: Vec<f32> = (0..w * h)
            .map(|i| {
                (if i % w < 32 { 0.2 } else { 0.8 }) + ((i * 37 % 29) as f32 / 28.0 - 0.5) * 0.005
            })
            .collect();
        let s = source(w as u32, h as u32, samples.clone());
        let mut r = radiograph_recipe();
        for strength in [6.0, 8.0, 10.0, 11.5, 12.0] {
            r.sharpen = strength;
            assert!(r.validate().is_ok());
            for halo in [0.0, 0.35, 0.8, 1.0] {
                r.halo = halo;
                let floating =
                    radiograph_bands(&radiograph_bands(&samples, w, h, &r, true), w, h, &r, false);
                assert!(floating
                    .iter()
                    .all(|v| v.is_finite() && (-0.5..=1.5).contains(v)));
                for gamma in [0.1, 0.22, 0.9, 1.0] {
                    r.gamma = gamma;
                    assert_eq!(
                        process(&s, &r).unwrap().histogram.iter().sum::<u32>(),
                        (w * h) as u32
                    );
                }
            }
        }
        r.sharpen = 12.01;
        assert!(r.validate().is_err());
        r.version = 1;
        r.detail_mode = "unsharp".into();
        r.sharpen = 3.0;
        assert!(r.validate().is_ok());
        r.sharpen = 3.01;
        assert!(r.validate().is_err());
    }

    #[test]
    fn neutral_12bit_ramp_uses_all_levels_and_preserves_source() {
        let s = source(4096, 1, (0..4096).map(|v| v as f32).collect());
        let original = s.samples.clone();
        let out = process(&s, &Recipe::neutral(&s)).unwrap();
        assert_eq!(
            grays(&out),
            (0..4096)
                .map(|v| ((v as f32 / 4095.0) * 255.0).round() as u8)
                .collect::<Vec<_>>()
        );
        assert_eq!(s.samples, original);
        assert_eq!(out.histogram.iter().sum::<u32>(), 4096);
        assert_eq!((out.clipped_low, out.clipped_high), (1, 1));
    }

    #[test]
    fn modality_is_applied_once_and_voi_is_dicom_linear() {
        let mut s = source(5, 1, vec![0.0, 25.0, 50.0, 75.0, 100.0]);
        s.metadata.slope = 2.0;
        s.metadata.intercept = -100.0;
        s.metadata.window_center = Some(0.5);
        s.metadata.window_width = Some(201.0);
        let r = Recipe::neutral(&s);
        assert_eq!(grays(&process(&s, &r).unwrap()), [0, 64, 128, 191, 255]);
    }

    #[test]
    fn signed_negative_slope_polarity_width_one_and_invert() {
        let mut s = source(3, 1, vec![-1.0, 0.0, 1.0]);
        s.metadata.signed = true;
        s.metadata.slope = -1.0;
        let mut r = Recipe::neutral(&s);
        assert_eq!(grays(&process(&s, &r).unwrap()), [255, 128, 0]);
        s.metadata.photometric = "MONOCHROME1".into();
        assert_eq!(grays(&process(&s, &r).unwrap()), [0, 128, 255]);
        r.window_center = 0.5;
        r.window_width = 1.0;
        assert_eq!(grays(&process(&s, &r).unwrap()), [0, 255, 255]);
        r.invert = true;
        assert_eq!(grays(&process(&s, &r).unwrap()), [255, 0, 0]);
    }

    #[test]
    fn filters_preserve_flat_fields_including_tiny_images() {
        for (w, h) in [(1, 1), (2, 3), (257, 131)] {
            let s = source(w, h, vec![2048.0; (w * h) as usize]);
            let mut r = Recipe::neutral(&s);
            r.window_center = 2048.0;
            r.window_width = 4096.0;
            r.denoise = 1.0;
            r.clahe = 1.0;
            r.sharpen = 3.0;
            r.radius = 12.0;
            r.detail_mode = "multiscale".into();
            assert!(grays(&process(&s, &r).unwrap()).iter().all(|&v| v == 128));
        }
    }

    #[test]
    fn box_mean_matches_naive_at_boundaries() {
        let (w, h) = (7, 3);
        let v: Vec<_> = (0..w * h).map(|i| (i * 13 % 17) as f32).collect();
        for radius in [1, 2, 8] {
            let actual = box_mean(&v, w, h, radius);
            for y in 0..h {
                for x in 0..w {
                    let mut sum = 0.0;
                    for dy in -(radius as isize)..=radius as isize {
                        for dx in -(radius as isize)..=radius as isize {
                            sum += v[(y as isize + dy).clamp(0, h as isize - 1) as usize * w
                                + (x as isize + dx).clamp(0, w as isize - 1) as usize];
                        }
                    }
                    assert!(
                        (actual[y * w + x] - sum / (2 * radius + 1).pow(2) as f32).abs() < 1e-5
                    );
                }
            }
        }
    }

    #[test]
    fn denoise_reduces_noise_without_blurring_strong_edges() {
        let (w, h) = (128, 64);
        let noisy: Vec<_> = (0..w * h)
            .map(|i| {
                let base = if i % w < w / 2 { 0.2 } else { 0.8 };
                base + (((i * 71 + i / w * 19) % 97) as f32 / 96.0 - 0.5) * 0.04
            })
            .collect();
        let clean = guided_denoise(&noisy, w, h, 1.0);
        let error = |values: &[f32]| {
            values
                .iter()
                .enumerate()
                .map(|(i, v)| (v - if i % w < w / 2 { 0.2 } else { 0.8 }).powi(2))
                .sum::<f32>()
        };
        assert!(error(&clean) < error(&noisy) * 0.35);
        assert!(clean[32 * w + 64] - clean[32 * w + 63] > 0.55);
    }

    #[test]
    fn threshold_blocks_small_noise_and_halo_suppression_bounds_edges() {
        let s = source(
            64,
            8,
            (0..512)
                .map(|i| if i % 64 < 32 { 0.2 } else { 0.8 })
                .collect(),
        );
        let mut r = Recipe::neutral(&s);
        r.sharpen = 3.0;
        r.threshold = 0.0;
        r.halo = 1.0;
        let full = detail(&s.samples, 64, 8, &r);
        assert!(full.iter().all(|v| *v >= 0.2 && *v <= 0.8));
        r.halo = 0.0;
        assert!(detail(&s.samples, 64, 8, &r)
            .iter()
            .any(|v| *v < 0.2 || *v > 0.8));
        r.threshold = 0.25;
        let tiny: Vec<_> = (0..512).map(|i| 0.5 + (i % 7) as f32 * 0.001).collect();
        assert_eq!(detail(&tiny, 64, 8, &r), tiny);
    }

    #[test]
    fn clahe_interpolates_tiles_without_visible_seams_on_a_ramp() {
        let (w, h) = (512, 129);
        let ramp: Vec<_> = (0..w * h)
            .map(|i| (i % w) as f32 / (w - 1) as f32)
            .collect();
        let out = clahe(&ramp, w, h, 0.5);
        for row in out.chunks_exact(w) {
            assert!(row.windows(2).all(|v| (v[1] - v[0]).abs() < 0.012));
            assert!(row.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)));
        }
        assert_eq!(out[0], 0.0);
        assert_eq!(out[w - 1], 1.0);
    }

    #[test]
    fn color_neutral_preserves_rgb_and_mapping_preserves_luminance() {
        let rgb = vec![
            [255.0, 0.0, 0.0],
            [25.0, 130.0, 210.0],
            [255.0; 3],
            [0.0; 3],
        ];
        let mut s = source(
            4,
            1,
            rgb.iter()
                .map(|p| p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722)
                .collect(),
        );
        s.metadata.bits_stored = 8;
        s.color = Some(rgb.clone());
        let actual = process(&s, &Recipe::neutral(&s)).unwrap();
        for (pixel, expected) in actual.rgba.as_chunks::<4>().0.iter().zip(&rgb) {
            assert_eq!(&pixel[..3], expected.map(|v| v as u8));
        }
        for target in [0.0, 0.1, 0.5, 0.9, 1.0] {
            let c = recolor([0.1, 0.5, 0.9], target);
            assert!(c.iter().all(|v| *v >= -1e-6 && *v <= 1.0 + 1e-6));
            assert!((c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722 - target).abs() < 1e-6);
        }
    }

    #[test]
    fn rendered_grayscale_references_keep_their_existing_tones() {
        for format in ["PNG", "JPEG"] {
            let mut s = source(3, 1, vec![100.0, 125.0, 150.0]);
            s.metadata.format = format.into();
            s.metadata.bits_stored = 8;
            assert_eq!(
                grays(&process(&s, &Recipe::neutral(&s)).unwrap()),
                [100, 125, 150]
            );
        }
        let mut s = source(3, 1, vec![100.0 * 257.0, 125.0 * 257.0, 150.0 * 257.0]);
        s.metadata.format = "PNG".into();
        s.metadata.bits_stored = 16;
        assert_eq!(
            grays(&process(&s, &Recipe::neutral(&s)).unwrap()),
            [100, 125, 150]
        );
    }

    #[test]
    fn rejects_invalid_recipes_and_source_buffers() {
        let mut s = source(2, 1, vec![0.0, 4095.0]);
        let mut r = Recipe::neutral(&s);
        r.gamma = f32::NAN;
        assert!(process(&s, &r).is_err());
        r = Recipe::neutral(&s);
        r.version = 3;
        assert!(process(&s, &r).is_err());
        r.version = 1;
        s.samples.pop();
        assert!(process(&s, &r).is_err());
    }

    #[test]
    fn interaction_preview_is_bounded_float_averaging_and_preserves_source() {
        let mut s = source(
            1024,
            4,
            (0..4096).map(|i| (i % 1024) as f32 + 0.25).collect(),
        );
        s.color = Some(s.samples.iter().map(|v| [*v, *v * 0.5, 0.25]).collect());
        let original = s.samples.clone();
        let preview = preview_source(&s, 512);
        assert_eq!((preview.width, preview.height), (512, 2));
        assert_eq!(preview.samples[0], 0.75);
        assert_eq!(preview.samples[511], 1022.75);
        assert_eq!(preview.color.as_ref().unwrap()[0], [0.75, 0.375, 0.25]);
        assert_eq!(s.samples, original);
        assert_eq!(preview.metadata.bits_stored, s.metadata.bits_stored);
        let narrow = preview_source(&source(1, 1025, vec![17.125; 1025]), 512);
        assert_eq!((narrow.width, narrow.height), (1, 512));
        assert!(narrow.samples.iter().all(|v| *v == 17.125));
    }

    #[test]
    fn previews_never_contaminate_full_resolution_cache_or_final_pixels() {
        let s = Arc::new(source(
            769,
            257,
            (0..769 * 257).map(|i| (i * 37 % 4096) as f32).collect(),
        ));
        let original = s.samples.clone();
        let mut session = ProcessingSession::new(s.clone());
        let mut recipe = Recipe::neutral(&s);
        recipe.version = 2;
        recipe.gamma = 0.5;
        recipe.sharpen = 6.0;
        recipe.local_contrast = 0.4;
        recipe.clahe = 0.12;
        recipe.detail_mode = "radiograph".into();
        let full = session.process(&recipe).unwrap();
        let cached = session.prepared.as_ref().unwrap().1.as_ptr();
        for gamma in [0.1, 0.22, 0.5, 0.9] {
            recipe.gamma = gamma;
            let preview = session.process_preview(&recipe).unwrap();
            assert_eq!(preview.width, 384);
            assert_eq!(
                preview.histogram.iter().sum::<u32>(),
                preview.width * preview.height
            );
            assert_eq!(cached, session.prepared.as_ref().unwrap().1.as_ptr());
            assert!(preview
                .rgba
                .as_chunks::<4>()
                .0
                .iter()
                .all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255));
        }
        recipe.gamma = 0.5;
        let final_render = session.process(&recipe).unwrap();
        assert_eq!(full.rgba, final_render.rgba);
        assert_eq!(full.histogram, final_render.histogram);
        assert_eq!(final_render.rgba, process(&s, &recipe).unwrap().rgba);
        assert_eq!(s.samples, original);
    }

    #[test]
    fn small_interaction_previews_use_exact_pipeline_and_validate_recipes() {
        let s = Arc::new(source(11, 7, (0..77).map(|v| v as f32 * 53.0).collect()));
        let mut recipe = Recipe::neutral(&s);
        let mut session = ProcessingSession::new(s.clone());
        recipe.gamma = 0.5;
        assert_eq!(
            session.process_preview(&recipe).unwrap().rgba,
            process(&s, &recipe).unwrap().rgba
        );
        recipe.gamma = f32::NAN;
        assert!(session.process_preview(&recipe).is_err());
    }

    #[test]
    fn preview_cache_reuses_tone_stage_and_invalidates_every_tone_parameter() {
        let s = Arc::new(source(
            769,
            257,
            (0..769 * 257).map(|i| (i * 37 % 4096) as f32).collect(),
        ));
        let mut session = ProcessingSession::new(s.clone());
        let mut recipe = radiograph_recipe();
        session.process_preview(&recipe).unwrap();
        let prepared = session.preview_prepared.as_ref().unwrap().1.as_ptr();
        for i in 0..12 {
            match i {
                0 => recipe.sharpen += 0.1,
                1 => recipe.colorize = true,
                2 => recipe.color_strength = 0.3,
                3 => recipe.invert = true,
                4 => recipe.gamma = 0.7,
                5 => recipe.window_center += 10.0,
                6 => recipe.window_width += 20.0,
                7 => recipe.denoise = 0.2,
                8 => recipe.clahe = 0.2,
                9 => recipe.local_contrast = 0.3,
                10 => recipe.threshold = 0.02,
                _ => recipe.halo = 0.8,
            }
            let cached = session.process_preview(&recipe).unwrap();
            let fresh = ProcessingSession::new(s.clone())
                .process_preview(&recipe)
                .unwrap();
            assert_eq!(cached.rgba, fresh.rgba, "adjustment {i}");
            assert_eq!(cached.histogram, fresh.histogram);
            if i < 4 {
                assert_eq!(
                    prepared,
                    session.preview_prepared.as_ref().unwrap().1.as_ptr()
                );
            }
        }
    }

    #[test]
    #[ignore = "manual local-sample interaction performance comparison"]
    fn benchmark_interaction_preview() {
        use image::ImageEncoder;
        let encode = |render: &RenderedImage| {
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
            .unwrap();
            std::hint::black_box(bytes);
        };
        let directory =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Sample RAD Files");
        for name in ["R1.rvg", "P2.pano"] {
            let source = Arc::new(crate::decode(&directory.join(name)).unwrap());
            let mut recipe = crate::suggested_recipe(&source);
            recipe.version = 2;
            recipe.detail_mode = "radiograph".into();
            recipe.gamma = 0.5;
            recipe.sharpen = 6.0;
            recipe.local_contrast = 0.4;
            recipe.clahe = 0.12;
            recipe.radius = 2.2;
            recipe.threshold = 0.0015;
            recipe.halo = 0.35;
            let mut session = ProcessingSession::new(source.clone());
            let baseline = process(&source, &recipe).unwrap();
            let start = std::time::Instant::now();
            let preview = session.process_preview(&recipe).unwrap();
            encode(&preview);
            let first = start.elapsed().as_secs_f64() * 1000.0;
            let mut full = Vec::new();
            let mut reduced = Vec::new();
            for i in 0..7 {
                recipe.gamma = 0.4 + i as f32 * 0.025;
                recipe.window_center += 3.0;
                let start = std::time::Instant::now();
                encode(&session.process(&recipe).unwrap());
                full.push(start.elapsed().as_secs_f64() * 1000.0);
                let start = std::time::Instant::now();
                encode(&session.process_preview(&recipe).unwrap());
                reduced.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            full.sort_by(f64::total_cmp);
            reduced.sort_by(f64::total_cmp);
            eprintln!("INTERACTION+PNG {name} {}x{} -> {}x{}: full median {:.2} ms; preview median {:.2} ms; first {:.2} ms; {:.1}x speedup", baseline.width, baseline.height, preview.width, preview.height, full[3], reduced[3], first, full[3] / reduced[3]);
            let mut uncached = Vec::new();
            let mut cached = Vec::new();
            for i in 0..11 {
                recipe.sharpen = 5.0 + i as f32 * 0.1;
                session.preview_prepared = None;
                let start = std::time::Instant::now();
                let expected = session.process_preview(&recipe).unwrap();
                encode(&expected);
                uncached.push(start.elapsed().as_secs_f64() * 1000.0);
                let start = std::time::Instant::now();
                let actual = session.process_preview(&recipe).unwrap();
                encode(&actual);
                cached.push(start.elapsed().as_secs_f64() * 1000.0);
                assert_eq!(expected.rgba, actual.rgba);
            }
            uncached.sort_by(f64::total_cmp);
            cached.sort_by(f64::total_cmp);
            eprintln!("DETAIL+PNG {name}: uncached tone median {:.2} ms; cached tone median {:.2} ms; {:.2}x speedup, identical pixels", uncached[5], cached[5], uncached[5] / cached[5]);
        }
    }

    #[test]
    #[ignore = "manual release performance measurement"]
    fn benchmark_intraoral_pipeline() {
        let (w, h) = (1562, 1168);
        let s = source(
            w,
            h,
            (0..w * h)
                .map(|i| ((i * 71 + i / w * 17) % 4096) as f32)
                .collect(),
        );
        let mut r = Recipe::neutral(&s);
        r.denoise = 0.35;
        r.clahe = 0.3;
        r.sharpen = 0.7;
        r.detail_mode = "multiscale".into();
        let start = std::time::Instant::now();
        let rendered = process(&s, &r).unwrap();
        eprintln!(
            "1562 × 1168 all-stage CPU processing: {:?}; {} RGBA bytes",
            start.elapsed(),
            rendered.rgba.len()
        );
        assert_eq!(rendered.rgba.len(), (w * h * 4) as usize);
    }

    #[test]
    #[ignore = "manual local-sample release performance measurement; needs private samples"]
    fn benchmark_supplied_samples() {
        let directory =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Sample RAD Files");
        for name in ["R1.rvg", "R2.rvg", "R4.rvg", "P2.pano"] {
            let started = std::time::Instant::now();
            let s = crate::decode(&directory.join(name)).unwrap();
            eprintln!(
                "DECODE {name}: {:.2} ms; {} x {}",
                started.elapsed().as_secs_f64() * 1000.0,
                s.width,
                s.height
            );
            let neutral = Recipe::neutral(&s);
            for preset in ["neutral", "bitewing", "endo", "detail", "all-stages"] {
                if preset == "all-stages" && name != "R1.rvg" {
                    continue;
                }
                let mut r = neutral.clone();
                // Historical version 1 presets. Current v2 UI is exercised by compare_presets.
                match preset {
                    "bitewing" => {
                        r.gamma = 0.94;
                        r.clahe = 0.2;
                        r.sharpen = 0.65;
                        r.radius = 1.5;
                        r.threshold = 0.016;
                        r.halo = 0.8;
                    }
                    "endo" => {
                        r.gamma = 0.88;
                        r.clahe = 0.28;
                        r.sharpen = 0.5;
                        r.radius = 2.2;
                        r.threshold = 0.018;
                        r.halo = 0.85;
                    }
                    "detail" => {
                        r.sharpen = 0.65;
                        r.radius = 1.4;
                        r.threshold = 0.02;
                        r.halo = 0.85;
                        r.detail_mode = "multiscale".into();
                    }
                    "all-stages" => {
                        r.denoise = 0.35;
                        r.gamma = 0.94;
                        r.clahe = 0.3;
                        r.sharpen = 0.7;
                        r.detail_mode = "multiscale".into();
                    }
                    _ => {}
                }
                process(&s, &r).unwrap(); // Warm instruction/data paths once, timed renders are independent.
                let mut times = Vec::new();
                for _ in 0..5 {
                    let started = std::time::Instant::now();
                    let out = process(&s, &r).unwrap();
                    times.push(started.elapsed().as_secs_f64() * 1000.0);
                    std::hint::black_box(out);
                }
                times.sort_by(f64::total_cmp);
                eprintln!(
                    "RENDER {name} {preset}: median {:.2} ms; range {:.2}–{:.2} ms",
                    times[2], times[0], times[4]
                );
            }
        }
    }
}

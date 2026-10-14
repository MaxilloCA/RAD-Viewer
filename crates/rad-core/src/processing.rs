//! Version 1 CPU pipeline. All spatial scales are source-image pixels.
//! Source samples stay immutable; quantization occurs only at the final RGBA conversion.
use crate::SourceImage;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub version: u32,
    pub window_center: f32,
    pub window_width: f32,
    pub gamma: f32,
    pub denoise: f32,
    pub clahe: f32,
    pub sharpen: f32,
    pub radius: f32,
    pub threshold: f32,
    pub halo: f32,
    pub detail_mode: String,
    pub invert: bool,
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
            sharpen: 0.0,
            radius: 2.0,
            threshold: 0.01,
            halo: 0.7,
            detail_mode: "unsharp".into(),
            invert: false,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unsupported processing recipe version".into());
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
            ("sharpen", self.sharpen, 0.0, 3.0),
            ("radius", self.radius, 0.35, 12.0),
            ("threshold", self.threshold, 0.0, 0.25),
            ("halo suppression", self.halo, 0.0, 1.0),
        ] {
            if !v.is_finite() || !(min..=max).contains(&v) {
                return Err(format!("{name} must be between {min} and {max}"));
            }
        }
        if self.detail_mode != "unsharp" && self.detail_mode != "multiscale" {
            return Err("Detail mode must be unsharp or multiscale".into());
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

pub fn process(source: &SourceImage, recipe: &Recipe) -> Result<RenderedImage, String> {
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
        values = clahe(&values, w, h, recipe.clahe);
    }
    if recipe.sharpen > 0.0 {
        values = detail(&values, w, h, recipe);
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
        if let Some(colors) = &source.color {
            let rgb = colors[i].map(|v| v / color_scale);
            let channels = recolor(rgb, y);
            rendered.rgba.extend(channels.map(quantize));
        } else {
            rendered.rgba.extend([gray; 3]);
        }
        rendered.rgba.push(255);
    }
    Ok(rendered)
}

fn quantize(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
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

fn clahe(input: &[f32], w: usize, h: usize, strength: f32) -> Vec<f32> {
    const BINS: usize = 256;
    // Uniform partitions avoid a tiny partial tile at right/bottom edges.
    let nx = w.div_ceil(128);
    let ny = h.div_ceil(128);
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
        r.version = 2;
        assert!(process(&s, &r).is_err());
        r.version = 1;
        s.samples.pop();
        assert!(process(&s, &r).is_err());
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
                // Exact values in src/model.ts; update this comparison if UI presets change.
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

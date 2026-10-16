//! Experimental local-darkness visualization, NOT a trained caries detector.
//! Scores describe image contrast only; they have no diagnostic calibration.
use crate::{RenderedImage, SourceImage};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Region {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
impl Region {
    fn validate(&self, width: u32, height: u32) -> Result<(), String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|v| !v.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
            || self.x + self.width > width as f32 + 0.01
            || self.y + self.height > height as f32 + 0.01
        {
            return Err("Select a region inside the image".into());
        }
        Ok(())
    }
}

/// Crop first, then area-average to <=512 pixels per side. Source floats and
/// polarity are used before any display enhancement; no patient data leaves the PC.
pub fn dark_regions(
    source: &SourceImage,
    region: Region,
    sensitivity: f32,
) -> Result<RenderedImage, String> {
    region.validate(source.width, source.height)?;
    if region.width < 16.0 || region.height < 16.0 {
        return Err("Select a larger tooth area (at least 16 source pixels across)".into());
    }
    if !sensitivity.is_finite() || !(0.0..=1.0).contains(&sensitivity) {
        return Err("Sensitivity must be between 0 and 1".into());
    }
    if source.samples.len() != source.width as usize * source.height as usize {
        return Err("Invalid source pixels".into());
    }
    let scale = (512.0 / region.width.max(region.height)).min(1.0);
    let w = (region.width * scale).round().max(1.0) as usize;
    let h = (region.height * scale).round().max(1.0) as usize;
    let polarity = if source.metadata.photometric == "MONOCHROME1" {
        -1.0
    } else {
        1.0
    };
    let mut values = vec![0.0f32; w * h];
    for y in 0..h {
        let y0 = (region.y + y as f32 / h as f32 * region.height) as usize;
        let y1 = ((region.y + (y + 1) as f32 / h as f32 * region.height) as usize)
            .max(y0 + 1)
            .min(source.height as usize);
        for x in 0..w {
            let x0 = (region.x + x as f32 / w as f32 * region.width) as usize;
            let x1 = ((region.x + (x + 1) as f32 / w as f32 * region.width) as usize)
                .max(x0 + 1)
                .min(source.width as usize);
            let mut sum = 0.0f64;
            for yy in y0..y1 {
                for xx in x0..x1 {
                    sum += f64::from(source.samples[yy * source.width as usize + xx]);
                }
            }
            values[y * w + x] = ((sum / ((x1 - x0) * (y1 - y0)) as f64) as f32
                * source.metadata.slope
                + source.metadata.intercept)
                * polarity;
        }
    }
    if values.iter().any(|v| !v.is_finite()) {
        return Err("Invalid source intensities".into());
    }
    let mut sorted = values.clone();
    sorted.sort_unstable_by(f32::total_cmp);
    let lo = sorted[sorted.len() / 20];
    let span = (sorted[sorted.len() * 19 / 20] - lo)
        .max((source.metadata.max - source.metadata.min).abs() * source.metadata.slope.abs() * 0.2)
        .max(1e-6);
    for v in &mut values {
        *v = (*v - lo) / span;
    }
    let smooth = box_mean(&values, w, h, 1);
    let near = box_mean(&smooth, w, h, (w.min(h) / 12).max(3));
    let broad = box_mean(&smooth, w, h, (w.min(h) / 5).max(5));
    let threshold = 0.14 - sensitivity * 0.12;
    let scores: Vec<f32> = smooth
        .iter()
        .enumerate()
        .map(|(i, v)| ((near[i] - v).max(broad[i] - v) - threshold).max(0.0))
        .collect();
    let mut visited = vec![false; scores.len()];
    let mut rgba = vec![0u8; scores.len() * 4];
    let min_area = (w * h / 20000).max(6);
    // Reject isolated noise, very large dark areas and components crossing the
    // selection boundary. This only reduces artifacts; anatomy can still pass.
    for start in 0..scores.len() {
        if visited[start] || scores[start] <= 0.0 {
            continue;
        }
        let mut component = vec![start];
        visited[start] = true;
        let mut cursor = 0;
        let mut boundary = false;
        while cursor < component.len() {
            let i = component[cursor];
            cursor += 1;
            let x = i % w;
            let y = i / w;
            boundary |= x == 0 || x + 1 == w || y == 0 || y + 1 == h;
            for (xx, yy) in [
                (x.wrapping_sub(1), y),
                (x + 1, y),
                (x, y.wrapping_sub(1)),
                (x, y + 1),
            ] {
                if xx >= w || yy >= h {
                    continue;
                }
                let next = yy * w + xx;
                if !visited[next] && scores[next] > 0.0 {
                    visited[next] = true;
                    component.push(next);
                }
            }
        }
        if boundary || component.len() < min_area || component.len() > w * h / 3 {
            continue;
        }
        for i in component {
            let strength = (scores[i] / 0.3).clamp(0.0, 1.0);
            rgba[i * 4..i * 4 + 4].copy_from_slice(&[
                255,
                (225.0 * (1.0 - strength)) as u8,
                0,
                (65.0 + strength * 100.0) as u8,
            ]);
        }
    }
    Ok(RenderedImage {
        width: w as u32,
        height: h as u32,
        rgba,
        histogram: vec![],
        clipped_low: 0,
        clipped_high: 0,
    })
}

fn box_mean(values: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    let stride = w + 1;
    let mut integral = vec![0.0f64; stride * (h + 1)];
    for y in 0..h {
        let mut sum = 0.0;
        for x in 0..w {
            sum += f64::from(values[y * w + x]);
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
        }
    }
    let mut out = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            let (left, right, top, bottom) = (
                x.saturating_sub(radius),
                (x + radius + 1).min(w),
                y.saturating_sub(radius),
                (y + radius + 1).min(h),
            );
            out[y * w + x] = ((integral[bottom * stride + right]
                - integral[top * stride + right]
                - integral[bottom * stride + left]
                + integral[top * stride + left])
                / ((right - left) * (bottom - top)) as f64) as f32;
        }
    }
    out
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Ellipse {
    #[serde(flatten)]
    pub region: Region,
    pub color: String,
}

/// Export annotations at the source-pixel equivalent of their 3 CSS-pixel width.
/// Draw before rotation, preserving source-coordinate alignment.
pub fn draw_ellipses(
    render: &mut RenderedImage,
    ellipses: &[Ellipse],
    stroke: f32,
) -> Result<(), String> {
    if !stroke.is_finite() || !(0.1..=120.01).contains(&stroke) || ellipses.len() > 1000 {
        return Err("Invalid annotation size or count".into());
    }
    for ellipse in ellipses {
        let r = ellipse.region;
        r.validate(render.width, render.height)?;
        let color = match ellipse.color.as_str() {
            "red" => [255.0, 48.0, 48.0],
            "yellow" => [255.0, 230.0, 0.0],
            _ => return Err("Ellipse color must be red or yellow".into()),
        };
        let (rx, ry) = (r.width / 2.0, r.height / 2.0);
        let (cx, cy) = (r.x + rx, r.y + ry);
        let pad = stroke / 2.0 + 1.0;
        for y in ((r.y - pad).max(0.0) as u32)
            ..((r.y + r.height + pad).ceil().min(render.height as f32) as u32)
        {
            for x in ((r.x - pad).max(0.0) as u32)
                ..((r.x + r.width + pad).ceil().min(render.width as f32) as u32)
            {
                let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                let f = dx * dx / (rx * rx) + dy * dy / (ry * ry) - 1.0;
                let gradient = 2.0 * ((dx / (rx * rx)).powi(2) + (dy / (ry * ry)).powi(2)).sqrt();
                let distance = f.abs() / gradient.max(1e-6);
                let alpha = (stroke / 2.0 + 0.5 - distance).clamp(0.0, 1.0);
                let i = (y as usize * render.width as usize + x as usize) * 4;
                for (channel, value) in color.iter().enumerate() {
                    render.rgba[i + channel] = (f32::from(render.rgba[i + channel]) * (1.0 - alpha)
                        + value * alpha)
                        .round() as u8;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ImageMetadata;
    fn source() -> SourceImage {
        SourceImage {
            width: 100,
            height: 100,
            samples: vec![180.0; 10000],
            color: None,
            metadata: ImageMetadata {
                name: "Synthetic".into(),
                format: "DICOM".into(),
                image_date: None,
                date_source: None,
                bits_stored: 8,
                signed: false,
                photometric: "MONOCHROME2".into(),
                slope: 1.0,
                intercept: 0.0,
                window_center: None,
                window_width: None,
                min: 0.0,
                max: 255.0,
            },
        }
    }
    fn region() -> Region {
        Region {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
        }
    }
    fn count(render: &RenderedImage) -> usize {
        render
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| p[3] > 0)
            .count()
    }
    #[test]
    fn highlights_dark_patch_but_not_uniform_tissue_or_boundary_background() {
        let mut s = source();
        assert_eq!(count(&dark_regions(&s, region(), 0.5).unwrap()), 0);
        for y in 43..57 {
            for x in 43..57 {
                s.samples[y * 100 + x] = 100.0;
            }
        }
        for y in 0..100 {
            for x in 0..8 {
                s.samples[y * 100 + x] = 20.0;
            }
        }
        let original = s.samples.clone();
        let output = dark_regions(&s, region(), 0.5).unwrap();
        assert!(count(&output) > 30);
        assert!(output.rgba[(50 * 100 + 50) * 4 + 3] > 0);
        assert_eq!(output.rgba[(50 * 100 + 3) * 4 + 3], 0);
        assert_eq!(s.samples, original);
    }
    #[test]
    fn respects_polarity_and_modality_and_rejects_invalid_selection() {
        let mut s = source();
        for y in 43..57 {
            for x in 43..57 {
                s.samples[y * 100 + x] = 100.0;
            }
        }
        let a = dark_regions(&s, region(), 0.5).unwrap();
        s.samples.iter_mut().for_each(|v| *v = 255.0 - *v);
        s.metadata.photometric = "MONOCHROME1".into();
        s.metadata.slope = 2.0;
        s.metadata.intercept = -200.0;
        assert_eq!(a.rgba, dark_regions(&s, region(), 0.5).unwrap().rgba);
        assert!(dark_regions(
            &s,
            Region {
                x: f32::NAN,
                ..region()
            },
            0.5
        )
        .is_err());
        assert!(dark_regions(
            &s,
            Region {
                x: 80.0,
                ..region()
            },
            0.5
        )
        .is_err());
        assert!(dark_regions(&s, region(), 2.0).is_err());
    }
    #[test]
    fn annotation_colors_and_centres_are_preserved() {
        let mut render = RenderedImage {
            width: 100,
            height: 100,
            rgba: vec![128; 40000],
            histogram: vec![],
            clipped_low: 0,
            clipped_high: 0,
        };
        let ellipse = Ellipse {
            region: Region {
                x: 20.0,
                y: 20.0,
                width: 60.0,
                height: 60.0,
            },
            color: "red".into(),
        };
        draw_ellipses(&mut render, &[ellipse], 3.0).unwrap();
        assert_eq!(
            &render.rgba[(50 * 100 + 50) * 4..(50 * 100 + 50) * 4 + 3],
            &[128, 128, 128]
        );
        assert_eq!(
            &render.rgba[(20 * 100 + 50) * 4..(20 * 100 + 50) * 4 + 3],
            &[255, 48, 48]
        );
    }
}

//! Initial display suggestion for high-depth intraoral images without supplied VOI.
//! This is a reversible visual heuristic, not a DICOM decoding transform or a
//! reconstruction of a manufacturer's private processing. Neutral stays available.

use crate::{Recipe, SourceImage};

/// Estimate an anatomy-oriented tonal range without letting padding or burned-in
/// endpoint markers determine the window. Does not modify source samples.
pub fn suggested_recipe(source: &SourceImage) -> Recipe {
    let mut recipe = Recipe::neutral(source);
    let m = &source.metadata;
    if m.format != "DICOM"
        || !(9..=16).contains(&m.bits_stored)
        || source.color.is_some()
        || !matches!(m.photometric.as_str(), "MONOCHROME1" | "MONOCHROME2")
        || m.window_center.is_some()
        || m.window_width.is_some()
        || m.name.to_ascii_lowercase().ends_with(".pano")
        || source.height == 0
        || f64::from(source.width) / f64::from(source.height) > 2.0
        || !m.slope.is_finite()
        || m.slope == 0.0
        || !m.intercept.is_finite()
        || !m.min.is_finite()
        || !m.max.is_finite()
        || m.max <= m.min
    {
        return recipe;
    }
    let (width, height) = (source.width as usize, source.height as usize);
    if width.checked_mul(height) != Some(source.samples.len()) || width < 16 || height < 16 {
        return recipe;
    }
    // A 2% inset reduces sensor-edge/label influence while retaining peripheral
    // anatomy. Statistics alone use this inset; rendering always uses every pixel.
    let (inset_x, inset_y) = (width / 50, height / 50);
    let mut values = Vec::with_capacity((width - inset_x * 2) * (height - inset_y * 2));
    for y in inset_y..height - inset_y {
        for &sample in &source.samples[y * width + inset_x..(y + 1) * width - inset_x] {
            if !sample.is_finite() || sample <= m.min || sample >= m.max {
                continue;
            }
            let value = sample.mul_add(m.slope, m.intercept);
            if !value.is_finite() {
                return recipe;
            }
            values.push(value);
        }
    }
    if values.len() < 256 {
        return recipe;
    }
    // Selection rather than a full sort keeps the initial suggestion O(pixels).
    // Quantiles operate after modality mapping, including negative rescale slope.
    let low_index = (values.len() - 1) / 100;
    let high_index = (values.len() - 1) * 99 / 100;
    let low = *values.select_nth_unstable_by(low_index, f32::total_cmp).1;
    let high = *values.select_nth_unstable_by(high_index, f32::total_cmp).1;
    let span = high - low;
    if !span.is_finite() || span < 1.0 {
        return recipe;
    }
    // Leave 7.5% headroom in the display-white direction. MONOCHROME1 white is
    // at the lower modality value, so the expansion belongs at the opposite end.
    let (low, high) = if m.photometric == "MONOCHROME1" {
        (low - span * 0.075, high)
    } else {
        (low, high + span * 0.075)
    };
    let center = low * 0.5 + high * 0.5 + 0.5;
    let window = high - low + 1.0;
    if !center.is_finite() || !window.is_finite() {
        return recipe;
    }
    recipe.version = 2;
    recipe.window_center = center;
    recipe.window_width = window;
    // Pipeline gamma uses exponent 1/gamma. This convex curve expands the bright
    // anatomical range while darkening the air/shadow range; no spatial filter.
    recipe.gamma = 0.22;
    recipe
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ImageMetadata;

    fn source() -> SourceImage {
        let mut samples = (0..10000)
            .map(|i| 1000.0 + (i % 100) as f32 * 10.0)
            .collect::<Vec<_>>();
        // Real extrema are sparse markers/padding; they cannot dominate the window.
        samples[0] = 0.0;
        samples[9999] = 4095.0;
        SourceImage {
            width: 100,
            height: 100,
            samples,
            color: None,
            metadata: ImageMetadata {
                image_date: None,
                date_source: None,
                name: "synthetic.rvg".into(),
                format: "DICOM".into(),
                bits_stored: 12,
                signed: false,
                photometric: "MONOCHROME2".into(),
                slope: 1.0,
                intercept: 0.0,
                window_center: None,
                window_width: None,
                min: 0.0,
                max: 4095.0,
            },
        }
    }

    #[test]
    fn endpoints_do_not_determine_suggested_window_and_source_is_unchanged() {
        let s = source();
        let before = s.samples.clone();
        let r = suggested_recipe(&s);
        assert_eq!(r.version, 2);
        assert_eq!(r.gamma, 0.22);
        assert!((r.window_center - 1531.125).abs() < 0.01);
        assert!((r.window_width - 1022.25).abs() < 0.01);
        assert_eq!(r.sharpen, 0.0);
        assert_eq!(r.denoise, 0.0);
        assert_eq!(r.clahe, 0.0);
        assert_eq!(s.samples, before);
    }

    #[test]
    fn modality_mapping_is_applied_once_to_statistics() {
        let mut s = source();
        let r = suggested_recipe(&s);
        s.metadata.slope = 2.0;
        s.metadata.intercept = -1024.0;
        s.metadata.signed = true;
        let mapped = suggested_recipe(&s);
        assert!(
            (mapped.window_center - ((r.window_center - 0.5) * 2.0 - 1024.0 + 0.5)).abs() < 0.01
        );
        assert!((mapped.window_width - ((r.window_width - 1.0) * 2.0 + 1.0)).abs() < 0.01);
    }

    #[test]
    fn negative_modality_and_monochrome1_have_equivalent_display_positive_window() {
        let mut s = source();
        let positive = suggested_recipe(&s);
        s.metadata.slope = -1.0;
        s.metadata.intercept = 4095.0;
        s.metadata.photometric = "MONOCHROME1".into();
        let negative = suggested_recipe(&s);
        assert!((negative.window_width - positive.window_width).abs() < 0.01);
        assert!((negative.window_center - (4096.0 - positive.window_center)).abs() < 0.01);
        assert_eq!(negative.gamma, positive.gamma);
    }

    #[test]
    fn ordinary_images_supplied_windows_and_low_bit_images_stay_neutral() {
        for format in ["PNG", "JPEG"] {
            let mut s = source();
            s.metadata.format = format.into();
            assert_eq!(suggested_recipe(&s), Recipe::neutral(&s));
        }
        let mut s = source();
        s.metadata.window_center = Some(1800.0);
        s.metadata.window_width = Some(1200.0);
        assert_eq!(suggested_recipe(&s), Recipe::neutral(&s));
        s.metadata.window_center = None;
        s.metadata.window_width = None;
        s.metadata.bits_stored = 8;
        assert_eq!(suggested_recipe(&s), Recipe::neutral(&s));
    }

    #[test]
    fn panoramic_names_or_aspect_and_flat_fields_stay_neutral() {
        let mut s = source();
        s.metadata.name = "example.PANO".into();
        assert_eq!(suggested_recipe(&s), Recipe::neutral(&s));
        s.metadata.name = "wide.dcm".into();
        s.width = 250;
        s.height = 40;
        assert_eq!(suggested_recipe(&s), Recipe::neutral(&s));
        let mut s = source();
        s.samples.fill(2000.0);
        s.metadata.min = 2000.0;
        s.metadata.max = 2000.0;
        assert_eq!(suggested_recipe(&s), Recipe::neutral(&s));
    }
}

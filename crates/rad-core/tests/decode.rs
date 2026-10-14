use image::{ImageBuffer, Luma, Rgb};
use rad_core::decode;
use std::path::Path;

#[test]
fn png_8_and_16_bit_values_are_preserved_without_normalization() {
    let dir = tempfile::tempdir().unwrap();
    let p8 = dir.path().join("eight.bin");
    ImageBuffer::<Luma<u8>, _>::from_raw(3, 1, vec![0, 127, 255])
        .unwrap()
        .save_with_format(&p8, image::ImageFormat::Png)
        .unwrap();
    assert_eq!(decode(&p8).unwrap().samples, vec![0., 127., 255.]);
    let p16 = dir.path().join("sixteen.png");
    ImageBuffer::<Luma<u16>, _>::from_raw(4, 1, vec![0, 257, 4095, 65535])
        .unwrap()
        .save(&p16)
        .unwrap();
    let decoded = decode(&p16).unwrap();
    assert_eq!(decoded.samples, vec![0., 257., 4095., 65535.]);
    assert_eq!(decoded.metadata.bits_stored, 16);
    assert_eq!(decoded.metadata.image_date, None);
    assert_eq!(decoded.metadata.date_source, None);
    assert_eq!(rad_core::decode::read_image_date(&p16), None);
}

#[test]
fn png_rgb_16_preserves_every_channel_and_jpeg_remains_color() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("color.png");
    ImageBuffer::<Rgb<u16>, _>::from_raw(2, 1, vec![65535, 1234, 4567, 10, 40000, 10000])
        .unwrap()
        .save(&p)
        .unwrap();
    let decoded = decode(&p).unwrap();
    assert_eq!(
        decoded.color.unwrap(),
        vec![[65535., 1234., 4567.], [10., 40000., 10000.]]
    );
    assert_eq!(decoded.metadata.bits_stored, 16);
    let jpeg = dir.path().join("photo.jpg");
    ImageBuffer::<Rgb<u8>, _>::from_pixel(8, 8, Rgb([240, 30, 10]))
        .save(&jpeg)
        .unwrap();
    let rgb = decode(&jpeg).unwrap().color.unwrap();
    assert!(rgb[0][0] > 220. && rgb[0][1] < 50. && rgb[0][2] < 40.);
}

#[test]
fn malformed_and_transparent_files_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bad.rvg");
    std::fs::write(&path, b"not an image").unwrap();
    assert!(decode(&path).is_err());
    let png = dir.path().join("alpha.png");
    ImageBuffer::<image::Rgba<u8>, _>::from_pixel(1, 1, image::Rgba([100, 100, 100, 0]))
        .save(&png)
        .unwrap();
    assert!(decode(&png).unwrap_err().contains("Transparent"));
}

// Minimal synthetic Explicit VR Part 10 writer. No clinical files or tags are used.
fn element(bytes: &mut Vec<u8>, group: u16, tag: u16, vr: &[u8; 2], value: &[u8], big: bool) {
    let short = |v: u16| {
        if big {
            v.to_be_bytes()
        } else {
            v.to_le_bytes()
        }
    };
    let long = |v: u32| {
        if big {
            v.to_be_bytes()
        } else {
            v.to_le_bytes()
        }
    };
    bytes.extend(short(group));
    bytes.extend(short(tag));
    bytes.extend(vr);
    if [b"OW", b"OB", b"SQ", b"UN"].contains(&vr) {
        bytes.extend([0, 0]);
        bytes.extend(long(value.len() as u32));
    } else {
        bytes.extend(short(value.len() as u16));
    }
    bytes.extend(value);
}
fn dicom(
    path: &Path,
    signed: bool,
    bits: u16,
    photo: &str,
    frames: u16,
    big: bool,
    ts: Option<&str>,
) {
    let mut out = vec![0; 128];
    out.extend(b"DICM");
    let default_ts = if big {
        "1.2.840.10008.1.2.2"
    } else {
        "1.2.840.10008.1.2.1"
    };
    let mut syntax = ts.unwrap_or(default_ts).as_bytes().to_vec();
    if !syntax.len().is_multiple_of(2) {
        syntax.push(0);
    }
    element(
        &mut out,
        2,
        0,
        b"UL",
        &((8 + syntax.len()) as u32).to_le_bytes(),
        false,
    );
    element(&mut out, 2, 0x10, b"UI", &syntax, false);
    let us = |v: u16| {
        if big {
            v.to_be_bytes()
        } else {
            v.to_le_bytes()
        }
    };
    for (tag, value) in [
        (2, 1),
        (0x10, 1),
        (0x11, 4),
        (0x100, if bits <= 8 { 8 } else { 16 }),
        (0x101, bits),
        (0x102, bits - 1),
        (0x103, u16::from(signed)),
    ] {
        element(&mut out, 0x28, tag, b"US", &us(value), big);
    }
    let mut pi = photo.as_bytes().to_vec();
    if !pi.len().is_multiple_of(2) {
        pi.push(b' ');
    }
    element(&mut out, 0x28, 4, b"CS", &pi, big);
    element(
        &mut out,
        0x28,
        8,
        b"IS",
        format!("{frames} ").as_bytes(),
        big,
    );
    element(&mut out, 0x28, 0x1052, b"DS", b"-1024 ", big);
    element(&mut out, 0x28, 0x1053, b"DS", b"2 ", big);
    element(&mut out, 0x28, 0x1050, b"DS", b"100 ", big);
    element(&mut out, 0x28, 0x1051, b"DS", b"400 ", big);
    let raw: Vec<u8> = if bits <= 8 {
        vec![0, 127, 128, 255]
    } else {
        [0_u16, 0x7ff, 0x800, 0xfff]
            .into_iter()
            .flat_map(us)
            .collect()
    };
    element(
        &mut out,
        0x7fe0,
        0x10,
        if bits <= 8 { b"OB" } else { b"OW" },
        &raw,
        big,
    );
    std::fs::write(path, out).unwrap();
}

#[test]
fn signed_eight_bit_dicom_does_not_become_unsigned() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("signed-eight.dcm");
    dicom(&path, true, 8, "MONOCHROME2", 1, false, None);
    assert_eq!(decode(&path).unwrap().samples, vec![0., 127., -128., -1.]);
}

#[test]
fn dicom_dates_follow_priority_and_skip_invalid_or_missing_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dated.sc");
    let candidates: [(u16, &[u8; 2], &str, &str, &str); 5] = [
        (
            0x2a,
            b"DT",
            "20240229235959-0500",
            "AcquisitionDateTime",
            "2024-02-29",
        ),
        (0x22, b"DA", "20240301", "AcquisitionDate", "2024-03-01"),
        (0x23, b"DA", "20240302", "ContentDate", "2024-03-02"),
        (0x20, b"DA", "20240303", "StudyDate", "2024-03-03"),
        (0x21, b"DA", "20240304", "SeriesDate", "2024-03-04"),
    ];
    for first_valid in 0..=candidates.len() {
        dicom(&path, false, 8, "MONOCHROME2", 1, false, None);
        let mut bytes = std::fs::read(&path).unwrap();
        let mut dates = Vec::new();
        // Insert group 0008 before the fixture's first group 0028 element.
        let position = bytes
            .windows(6)
            .position(|v| v == b"\x28\x00\x02\x00US")
            .unwrap();
        let mut tags = candidates.iter().enumerate().collect::<Vec<_>>();
        tags.sort_by_key(|(_, candidate)| candidate.0);
        for (index, &(tag, vr, valid, _, _)) in tags {
            let value = if index < first_valid {
                "20230229"
            } else {
                valid
            };
            element(&mut dates, 8, tag, vr, value.as_bytes(), false);
        }
        bytes.splice(position..position, dates);
        std::fs::write(&path, &bytes).unwrap();
        let metadata = decode(&path).unwrap().metadata;
        let expected = candidates.get(first_valid);
        assert_eq!(metadata.image_date.as_deref(), expected.map(|c| c.4));
        assert_eq!(
            rad_core::decode::read_image_date(&path),
            metadata.image_date
        );
        assert_eq!(metadata.date_source.as_deref(), expected.map(|c| c.3));
        let json = serde_json::to_value(&metadata).unwrap();
        assert_eq!(
            json["imageDate"],
            serde_json::to_value(&metadata.image_date).unwrap()
        );
        assert_eq!(
            json["dateSource"],
            serde_json::to_value(&metadata.date_source).unwrap()
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
    dicom(&path, false, 8, "MONOCHROME2", 1, false, None);
    let undated = decode(&path).unwrap().metadata;
    assert_eq!(undated.image_date, None);
    assert_eq!(undated.date_source, None);
}

#[test]
fn secondary_capture_is_detected_by_content_with_sc_and_cs_extensions() {
    let dir = tempfile::tempdir().unwrap();
    let sop_class = b"1.2.840.10008.5.1.4.1.1.7\0";
    let transfer_syntax = b"1.2.840.10008.1.2.1\0";
    let mut meta = Vec::new();
    element(&mut meta, 2, 2, b"UI", sop_class, false);
    element(&mut meta, 2, 0x10, b"UI", transfer_syntax, false);
    let mut bytes = vec![0; 128];
    bytes.extend(b"DICM");
    element(
        &mut bytes,
        2,
        0,
        b"UL",
        &(meta.len() as u32).to_le_bytes(),
        false,
    );
    bytes.extend(meta);
    element(&mut bytes, 8, 0x16, b"UI", sop_class, false);
    for (tag, value) in [
        (2, 1_u16),
        (0x10, 2),
        (0x11, 3),
        (0x100, 8),
        (0x101, 8),
        (0x102, 7),
        (0x103, 0),
    ] {
        element(&mut bytes, 0x28, tag, b"US", &value.to_le_bytes(), false);
    }
    element(&mut bytes, 0x28, 4, b"CS", b"MONOCHROME2 ", false);
    element(
        &mut bytes,
        0x7fe0,
        0x10,
        b"OB",
        &[0, 1, 64, 127, 199, 255],
        false,
    );
    for extension in ["sc", "cs", "SC", "CS"] {
        let path = dir.path().join(format!("secondary-capture.{extension}"));
        std::fs::write(&path, &bytes).unwrap();
        let decoded = decode(&path).unwrap();
        assert_eq!((decoded.width, decoded.height), (3, 2));
        assert_eq!(decoded.samples, [0., 1., 64., 127., 199., 255.]);
        assert_eq!(decoded.metadata.format, "DICOM");
        assert_eq!(decoded.metadata.bits_stored, 8);
        assert!(!decoded.metadata.signed);
        assert_eq!(decoded.metadata.photometric, "MONOCHROME2");
        assert_eq!(
            (decoded.metadata.slope, decoded.metadata.intercept),
            (1., 0.)
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn jpeg_extended_secondary_capture_decodes_without_external_codec_software() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("synthetic.sc");
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
        .encode(&[0, 64, 192, 255], 4, 1, image::ExtendedColorType::L8)
        .unwrap();
    let expected = image::load_from_memory(&jpeg).unwrap().to_luma8();
    // Eight-bit sequential Huffman JPEG is also valid under the Extended
    // Sequential SOF1 process used by transfer syntax 1.2.840.10008.1.2.4.51.
    let frame_marker = jpeg.windows(2).position(|v| v == [0xff, 0xc0]).unwrap();
    jpeg[frame_marker + 1] = 0xc1;
    if !jpeg.len().is_multiple_of(2) {
        jpeg.push(0);
    }
    dicom(
        &path,
        false,
        8,
        "MONOCHROME2",
        1,
        false,
        Some("1.2.840.10008.1.2.4.51"),
    );
    let mut bytes = std::fs::read(&path).unwrap();
    let pixel_data = bytes
        .windows(6)
        .position(|v| v == b"\xe0\x7f\x10\x00OB")
        .unwrap();
    bytes.truncate(pixel_data);
    let dataset = bytes
        .windows(6)
        .position(|v| v == b"\x28\x00\x02\x00US")
        .unwrap();
    let mut sop_class = Vec::new();
    element(
        &mut sop_class,
        8,
        0x16,
        b"UI",
        b"1.2.840.10008.5.1.4.1.1.7\0",
        false,
    );
    bytes.splice(dataset..dataset, sop_class);
    // Undefined-length encapsulated Pixel Data, empty offset table, one fragment.
    bytes.extend(b"\xe0\x7f\x10\x00OB\0\0\xff\xff\xff\xff");
    bytes.extend(b"\xfe\xff\x00\xe0\0\0\0\0");
    bytes.extend(b"\xfe\xff\x00\xe0");
    bytes.extend((jpeg.len() as u32).to_le_bytes());
    bytes.extend(jpeg);
    bytes.extend(b"\xfe\xff\xdd\xe0\0\0\0\0");
    for extension in ["sc", "cs"] {
        let path = path.with_extension(extension);
        std::fs::write(&path, &bytes).unwrap();
        let decoded = decode(&path).unwrap();
        assert_eq!((decoded.width, decoded.height), (4, 1));
        assert_eq!(decoded.metadata.bits_stored, 8);
        assert_eq!(decoded.samples.len(), expected.len());
        for (actual, expected) in decoded.samples.iter().zip(expected.as_raw()) {
            // Distinct JPEG implementations may round inverse DCT by one level.
            assert!((actual - f32::from(*expected)).abs() <= 1.0);
        }
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}

// Synthetic colour Secondary Capture fixture. JPEG data is generated in memory;
// no clinical files or external codec installations are needed by these tests.
fn colour_dicom(
    path: &Path,
    photo: &str,
    planar: u16,
    width: u16,
    height: u16,
    pixels: &[u8],
    jpeg: bool,
) {
    let sop = b"1.2.840.10008.5.1.4.1.1.7\0";
    let mut syntax = if jpeg {
        b"1.2.840.10008.1.2.4.51".to_vec()
    } else {
        b"1.2.840.10008.1.2.1".to_vec()
    };
    if !syntax.len().is_multiple_of(2) {
        syntax.push(0);
    }
    let mut meta = Vec::new();
    element(&mut meta, 2, 2, b"UI", sop, false);
    element(&mut meta, 2, 0x10, b"UI", &syntax, false);
    let mut bytes = vec![0; 128];
    bytes.extend(b"DICM");
    element(
        &mut bytes,
        2,
        0,
        b"UL",
        &(meta.len() as u32).to_le_bytes(),
        false,
    );
    bytes.extend(meta);
    element(&mut bytes, 8, 0x16, b"UI", sop, false);
    element(&mut bytes, 8, 0x22, b"DA", b"20240229", false);
    for (tag, value) in [
        (2, 3),
        (6, planar),
        (0x10, height),
        (0x11, width),
        (0x100, 8),
        (0x101, 8),
        (0x102, 7),
        (0x103, 0),
    ] {
        element(&mut bytes, 0x28, tag, b"US", &value.to_le_bytes(), false);
    }
    let mut photo = photo.as_bytes().to_vec();
    if !photo.len().is_multiple_of(2) {
        photo.push(b' ');
    }
    element(&mut bytes, 0x28, 4, b"CS", &photo, false);
    let mut pixels = pixels.to_vec();
    if !pixels.len().is_multiple_of(2) {
        pixels.push(0);
    }
    if jpeg {
        bytes.extend(b"\xe0\x7f\x10\x00OB\0\0\xff\xff\xff\xff");
        bytes.extend(b"\xfe\xff\x00\xe0\0\0\0\0");
        bytes.extend(b"\xfe\xff\x00\xe0");
        bytes.extend((pixels.len() as u32).to_le_bytes());
        bytes.extend(pixels);
        bytes.extend(b"\xfe\xff\xdd\xe0\0\0\0\0");
    } else {
        element(&mut bytes, 0x7fe0, 0x10, b"OB", &pixels, false);
    }
    std::fs::write(path, bytes).unwrap();
}

fn rgb_luminance([r, g, b]: [u8; 3]) -> f32 {
    0.2126 * f32::from(r) + 0.7152 * f32::from(g) + 0.0722 * f32::from(b)
}

#[test]
fn native_rgb_dicom_becomes_grayscale_without_stretching_and_handles_both_planar_layouts() {
    let dir = tempfile::tempdir().unwrap();
    let pixels = [
        [220, 40, 80],
        [20, 190, 30],
        [80, 90, 200],
        [100; 3],
        [150; 3],
        [200; 3],
    ];
    for planar in [0, 1] {
        let path = dir.path().join(format!("colour-{planar}.cs"));
        let bytes: Vec<u8> = if planar == 0 {
            pixels.into_iter().flatten().collect()
        } else {
            (0..3)
                .flat_map(|channel| pixels.map(|p| p[channel]))
                .collect()
        };
        colour_dicom(&path, "RGB", planar, 3, 2, &bytes, false);
        let before = std::fs::read(&path).unwrap();
        let source = decode(&path).unwrap();
        assert!(source.color.is_none());
        assert_eq!(source.samples, pixels.map(rgb_luminance));
        assert_eq!(source.metadata.photometric, "MONOCHROME2");
        assert_eq!(source.metadata.image_date.as_deref(), Some("2024-02-29"));
        assert_eq!(
            (source.metadata.window_center, source.metadata.window_width),
            (Some(128.), Some(256.))
        );
        let rendered = rad_core::process(&source, &rad_core::Recipe::neutral(&source)).unwrap();
        for (output, input) in rendered.rgba.as_chunks::<4>().0.iter().zip(pixels) {
            let gray = rgb_luminance(input).round() as u8;
            assert_eq!(output, &[gray, gray, gray, 255]);
        }
        assert_eq!(std::fs::read(path).unwrap(), before);
    }
}

#[test]
fn native_ybr_full_is_converted_once_before_grayscale() {
    let dir = tempfile::tempdir().unwrap();
    let pixels = [
        [128, 128, 128],
        [76, 85, 255],
        [29, 255, 107],
        [150, 44, 21],
    ];
    let expected = [[128; 3], [254, 0, 0], [0, 0, 254], [0, 255, 1]].map(rgb_luminance);
    for planar in [0, 1] {
        let path = dir.path().join(format!("ybr-{planar}.sc"));
        let bytes: Vec<u8> = if planar == 0 {
            pixels.into_iter().flatten().collect()
        } else {
            (0..3)
                .flat_map(|channel| pixels.map(|p| p[channel]))
                .collect()
        };
        colour_dicom(&path, "YBR_FULL", planar, 2, 2, &bytes, false);
        let source = decode(&path).unwrap();
        assert_eq!(source.samples, expected);
        assert!(source.color.is_none());
        assert_eq!(source.metadata.photometric, "MONOCHROME2");
    }
}

#[test]
fn jpeg_extended_rgb_and_ybr_tags_use_codec_rgb_once_then_grayscale() {
    let dir = tempfile::tempdir().unwrap();
    for input in [
        [220, 45, 90].repeat(16 * 8),
        (0..16 * 8)
            .flat_map(|i| [((i * 13) % 256) as u8; 3])
            .collect(),
    ] {
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
            .encode(&input, 16, 8, image::ExtendedColorType::Rgb8)
            .unwrap();
        assert!(jpeg.windows(5).any(|v| v == b"JFIF\0"));
        let expected = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        let marker = jpeg.windows(2).position(|v| v == [0xff, 0xc0]).unwrap();
        jpeg[marker + 1] = 0xc1;
        let mut previous = None;
        for photo in ["RGB", "YBR_FULL", "YBR_FULL_422"] {
            for planar in [0, 1] {
                let path = dir.path().join("jpeg-colour.sc");
                colour_dicom(&path, photo, planar, 16, 8, &jpeg, true);
                let source = decode(&path).unwrap();
                assert!(source.color.is_none());
                assert_eq!(source.metadata.photometric, "MONOCHROME2");
                for (actual, pixel) in source.samples.iter().zip(expected.pixels()) {
                    assert!((actual - rgb_luminance(pixel.0)).abs() <= 1.01);
                }
                if let Some(previous) = previous.as_ref() {
                    assert_eq!(&source.samples, previous);
                }
                previous = Some(source.samples.clone());
                let rendered =
                    rad_core::process(&source, &rad_core::Recipe::neutral(&source)).unwrap();
                assert!(rendered
                    .rgba
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255));
            }
        }
    }
}

#[test]
fn unsupported_colour_layouts_and_jpeg_header_mismatch_fail_clearly() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("unsupported-colour.cs");
    colour_dicom(&path, "RGB", 2, 2, 1, &[0; 6], false);
    assert!(decode(&path).unwrap_err().contains("PlanarConfiguration"));
    colour_dicom(&path, "YBR_FULL_422", 0, 2, 1, &[0; 4], false);
    assert!(decode(&path)
        .unwrap_err()
        .contains("Unsupported colour DICOM encoding"));
    colour_dicom(&path, "PALETTE COLOR", 0, 2, 1, &[0; 6], false);
    assert!(decode(&path).unwrap_err().contains("photometric"));
    colour_dicom(&path, "RGB", 0, 2, 1, &[0; 2], false);
    assert!(decode(&path).unwrap_err().contains("truncated"));
    colour_dicom(&path, "RGB", 0, 2, 1, &[0; 6], false);
    let mut bytes = std::fs::read(&path).unwrap();
    let tag = bytes
        .windows(6)
        .position(|v| v == b"\x28\x00\x03\x01US")
        .unwrap();
    bytes[tag + 8..tag + 10].copy_from_slice(&1_u16.to_le_bytes());
    std::fs::write(&path, bytes).unwrap();
    assert!(decode(&path).unwrap_err().contains("unsigned 8-bit"));
    for format in [image::ExtendedColorType::L8, image::ExtendedColorType::Rgb8] {
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode(
                &[0; 6][..if format == image::ExtendedColorType::L8 {
                    2
                } else {
                    6
                }],
                2,
                1,
                format,
            )
            .unwrap();
        let width = if format == image::ExtendedColorType::L8 {
            2
        } else {
            3
        };
        colour_dicom(&path, "RGB", 0, width, 1, &jpeg, true);
        assert!(decode(&path)
            .unwrap_err()
            .contains("dimensions or components"));
    }
    colour_dicom(&path, "RGB", 0, 2, 1, &[0; 6], false);
    let mut bytes = std::fs::read(&path).unwrap();
    element(&mut bytes, 0x28, 0x1053, b"DS", b"2 ", false);
    std::fs::write(&path, bytes).unwrap();
    assert!(decode(&path).unwrap_err().contains("modality rescaling"));
}

#[test]
fn date_lookup_stops_before_malformed_patient_and_pixel_payloads() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("date-only.sc");
    colour_dicom(&path, "RGB", 0, 2, 1, &[0; 6], false);
    let mut bytes = std::fs::read(&path).unwrap();
    let start = bytes
        .windows(6)
        .position(|v| v == b"\x28\x00\x02\x00US")
        .unwrap();
    bytes.truncate(start);
    // Invalid/truncated patient value followed by undecodable Pixel Data.
    // Date-only scanning must not attempt to consume either value.
    bytes.extend(b"\x10\x00\x10\x00PN\xfe\xff");
    bytes.extend(b"\xe0\x7f\x10\x00OB\0\0\xff\xff\xff\xff");
    std::fs::write(&path, &bytes).unwrap();
    assert_eq!(
        rad_core::decode::read_image_date(&path).as_deref(),
        Some("2024-02-29")
    );
    assert!(decode(&path).is_err());
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}

#[test]
fn signed_dicom_preserves_samples_modality_voi_and_polarity_separately() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("signed.unknown");
    dicom(&path, true, 12, "MONOCHROME1", 1, false, None);
    let decoded = decode(&path).unwrap();
    assert_eq!(decoded.samples, vec![0., 2047., -2048., -1.]);
    assert_eq!(decoded.metadata.slope, 2.);
    assert_eq!(decoded.metadata.intercept, -1024.);
    assert_eq!(decoded.metadata.window_center, Some(100.));
    assert_eq!(decoded.metadata.window_width, Some(400.));
    assert_eq!(decoded.metadata.photometric, "MONOCHROME1");
    assert_eq!(decoded.metadata.min, -2048.);
    assert!(decoded.metadata.signed);
}

#[test]
fn explicit_big_endian_unsigned_dicom_is_interpreted_correctly() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.dcm");
    dicom(&path, false, 12, "MONOCHROME2", 1, true, None);
    assert_eq!(
        decode(&path).unwrap().samples,
        vec![0., 2047., 2048., 4095.]
    );
}

#[test]
fn multiframe_bad_bit_layout_and_unsupported_transfer_syntax_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("unsupported.dcm");
    dicom(&path, false, 12, "MONOCHROME2", 2, false, None);
    assert!(decode(&path).unwrap_err().contains("Multiframe"));
    dicom(&path, false, 17, "MONOCHROME2", 1, false, None);
    assert!(decode(&path).unwrap_err().contains("bit layout"));
    dicom(
        &path,
        false,
        12,
        "MONOCHROME2",
        1,
        false,
        Some("1.2.840.10008.1.2.4.90"),
    );
    assert!(decode(&path).is_err());
}

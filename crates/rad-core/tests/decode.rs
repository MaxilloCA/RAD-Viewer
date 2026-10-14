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

//! RGB → JPEG for Windows and Linux screenshots.
//!
//! The byte budget matches the Mac path so the exec socket stays under its read limit.
//! Downscaling changes the JPEG size only. Callers still record the monitor's input
//! coordinate size separately and map image pixels onto it.

pub fn rgb_to_jpeg_budget(
    rgb: &[u8],
    width: u32,
    height: u32,
    max_bytes: usize,
) -> Result<(Vec<u8>, u32, u32), String> {
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(3))
        .ok_or_else(|| "截图像素无效".to_string())?;
    if width == 0 || height == 0 || rgb.len() < pixels {
        return Err("截图像素无效".into());
    }
    let mut owned = rgb[..pixels].to_vec();
    let mut w = width;
    let mut h = height;
    let edges = [width.max(height).min(u16::MAX as u32), 1600, 1280, 960];
    let qualities = [75u8, 60, 45, 35];
    for edge in edges {
        if edge > 0 && w.max(h) > edge {
            let scale = edge as f64 / w.max(h) as f64;
            let nw = ((w as f64) * scale).round().max(1.0) as u32;
            let nh = ((h as f64) * scale).round().max(1.0) as u32;
            owned = box_downscale(&owned, w, h, nw, nh);
            w = nw;
            h = nh;
        }
        for quality in qualities {
            let jpeg = encode_jpeg(&owned, w, h, quality)?;
            if jpeg.len() <= max_bytes && jpeg.len() >= 32 {
                return Ok((jpeg, w, h));
            }
        }
    }
    Err("截图太大，没有把图像交给模型".into())
}

fn box_downscale(rgb: &[u8], w: u32, h: u32, nw: u32, nh: u32) -> Vec<u8> {
    let mut out = vec![0u8; (nw as usize) * (nh as usize) * 3];
    for y in 0..nh {
        let y0 = ((y as u64) * (h as u64) / (nh as u64)) as u32;
        let y1 = ((((y as u64) + 1) * (h as u64) / (nh as u64)) as u32)
            .max(y0 + 1)
            .min(h);
        for x in 0..nw {
            let x0 = ((x as u64) * (w as u64) / (nw as u64)) as u32;
            let x1 = ((((x as u64) + 1) * (w as u64) / (nw as u64)) as u32)
                .max(x0 + 1)
                .min(w);
            let mut acc = [0u32; 3];
            let mut n = 0u32;
            for sy in y0..y1 {
                for sx in x0..x1 {
                    let si = ((sy * w + sx) * 3) as usize;
                    acc[0] += rgb[si] as u32;
                    acc[1] += rgb[si + 1] as u32;
                    acc[2] += rgb[si + 2] as u32;
                    n += 1;
                }
            }
            let di = ((y * nw + x) * 3) as usize;
            let n = n.max(1);
            out[di] = (acc[0] / n) as u8;
            out[di + 1] = (acc[1] / n) as u8;
            out[di + 2] = (acc[2] / n) as u8;
        }
    }
    out
}

fn encode_jpeg(rgb: &[u8], w: u32, h: u32, quality: u8) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let encoder = jpeg_encoder::Encoder::new(&mut buf, quality);
    encoder
        .encode(rgb, w as u16, h as u16, jpeg_encoder::ColorType::Rgb)
        .map_err(|e| format!("压缩截图失败：{e}"))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::rgb_to_jpeg_budget;

    #[test]
    fn encodes_a_small_rgb_buffer_as_jpeg() {
        let mut rgb = vec![0u8; 32 * 24 * 3];
        for px in rgb.chunks_mut(3) {
            px[0] = 20;
            px[1] = 80;
            px[2] = 200;
        }
        let (jpeg, w, h) = rgb_to_jpeg_budget(&rgb, 32, 24, 50_000).unwrap();
        assert_eq!((w, h), (32, 24));
        assert!(jpeg.starts_with(&[0xff, 0xd8]), "jpeg magic");
    }
}

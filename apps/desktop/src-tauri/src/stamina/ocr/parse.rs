use super::super::Uma;
use super::{
    image::{Image, Ocr, Rect, Result, Rgb, Word},
    layout::{brown_ink, grade_rows, label, runs, Layout},
    matcher::{match_card, Mark},
};
use serde::{Deserialize, Serialize};

pub(super) fn number(text: &str) -> Option<u16> {
    let text = text.trim();
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

pub(super) fn level(text: &str) -> Option<u8> {
    let text = text.trim();
    let first = text.split_whitespace().next()?;
    let hint = first.eq_ignore_ascii_case("hint");
    let rest = if hint { &text[first.len()..] } else { text };
    let mut glyphs = rest
        .char_indices()
        .filter(|&(_, c)| !c.is_whitespace() && c != '-');
    let prefix: String = glyphs
        .by_ref()
        .take(3)
        .map(|(_, c)| c.to_ascii_lowercase())
        .collect();
    if matches!(prefix.as_str(), "lvl" | "lvi" | "lv1" | "ivl") {
        let (offset, digit) = glyphs.next()?;
        let boundary = rest[offset + digit.len_utf8()..].chars().next();
        return boundary
            .is_none_or(char::is_whitespace)
            .then(|| level_value(digit))
            .flatten();
    }
    // Some badge reads omit the small label but retain a standalone digit.
    hint.then(|| {
        text.split_whitespace()
            .nth(1)?
            .parse::<u8>()
            .ok()
            .filter(|level| (1..=5).contains(level))
    })
    .flatten()
}

fn level_value(token: char) -> Option<u8> {
    match token {
        'I' | 'l' | '|' => Some(1),
        '1'..='5' => Some(token as u8 - b'0'),
        _ => None,
    }
}

pub(super) fn read(
    ocr: &Ocr,
    image: &Image,
    area: Rect,
    glyph_height: i32,
    ink: fn(Rgb) -> u8,
) -> Result<String> {
    Ok(ocr
        .text(&image.text_crop(area, glyph_height, ink))?
        .trim()
        .to_owned())
}

pub(super) fn ink_bounds(
    image: &Image,
    area: Rect,
    mut ink: impl FnMut(Rgb) -> bool,
) -> Option<Rect> {
    let mut bounds = Rect::new(area.right, area.bottom, area.left, area.top);
    for y in area.top..area.bottom {
        for x in area.left..area.right {
            if ink(image.at(x, y)) {
                bounds.left = bounds.left.min(x);
                bounds.top = bounds.top.min(y);
                bounds.right = bounds.right.max(x + 1);
                bounds.bottom = bounds.bottom.max(y + 1);
            }
        }
    }
    (bounds.width() > 0 && bounds.height() > 0).then_some(bounds)
}

#[derive(Debug, Default, PartialEq, Deserialize, Serialize)]
pub(super) struct Attributes {
    pub stats: [Option<u16>; 5],
    pub track: String,
    pub distance: String,
    pub style: String,
}

pub(super) fn attributes(
    ocr: &Ocr,
    image: &Image,
    words: &[Word],
    panel: Rect,
) -> Result<(Attributes, Vec<String>)> {
    let mut result = Attributes::default();
    let mut raw = Vec::new();
    let width = panel.width();
    let labels: Vec<_> = ["Speed", "Stamina", "Power", "Guts", "Wit"]
        .iter()
        .enumerate()
        .filter_map(|(i, name)| {
            label(words, name)
                .find(|word| {
                    (panel.left + width / 7..panel.left + width / 2).contains(&word.x())
                        && (panel.top..panel.top + width * 7 / 10).contains(&word.y())
                })
                .map(|word| (i as i32, word))
        })
        .collect();
    if let (Some(&(first_i, first)), Some(&(last_i, last))) = (labels.first(), labels.last()) {
        if last_i > first_i {
            let pitch = (last.y() - first.y()) as f32 / (last_i - first_i) as f32;
            if (width as f32 * 0.09..=width as f32 * 0.13).contains(&pitch) {
                for (index, stat) in result.stats.iter_mut().enumerate() {
                    let y = first.y() + ((index as i32 - first_i) as f32 * pitch).round() as i32;
                    let area = Rect::new(
                        panel.left + width * 60 / 100,
                        y - width / 24,
                        panel.left + width * 84 / 100,
                        y + width / 24,
                    );
                    let text = read(ocr, image, area, width / 17, brown_ink)?;
                    *stat = number(&text);
                    raw.push(text);
                }
            }
        }
    }
    if let [track, distance, style] = grade_rows(image, panel).as_slice() {
        let track_y = (track.start + track.end) / 2;
        let distance_y = (distance.start + distance.end) / 2 + width / 100;
        let style_y = (style.start + style.end) / 2 + width / 70;
        let pairs =
            |y| [60, 92].map(|pct| grade(image, panel.left + width * pct / 100, y, width / 29));
        result.track = pairs(track_y).into_iter().collect();
        result.distance = pairs(distance_y)
            .into_iter()
            .chain(pairs(distance_y + width / 10))
            .collect();
        result.style = pairs(style_y)
            .into_iter()
            .chain(pairs(style_y + width / 10))
            .collect();
    }
    Ok((result, raw))
}

fn grade(image: &Image, cx: i32, cy: i32, radius: i32) -> char {
    let mut votes = [0; 6];
    for y in cy - radius..=cy + radius {
        for x in cx - radius..=cx + radius {
            let [r, g, b] = image.at(x, y).map(i16::from);
            let bucket = if g > 125 && g - r > 21 && r - b > 8 {
                3 // C
            } else if b - r > 9 && r - g > 26 {
                4 // E
            } else if r > 203 && b - g > 15 && r - b > 12 {
                2 // B
            } else if r > 190 && g - b > 53 && (8..=57).contains(&(r - g)) {
                0 // S
            } else if r > 170 && r - g > 66 && g - b > 30 {
                1 // A
            } else if (78..=213).contains(&r) && (r - g).abs() <= 5 && (r - b).abs() <= 5 {
                5 // G
            } else {
                continue;
            };
            votes[bucket] += 1;
        }
    }
    let (best, &count) = votes
        .iter()
        .enumerate()
        .max_by_key(|(_, count)| *count)
        .unwrap();
    let runner_up = votes
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != best)
        .map(|(_, &n)| n)
        .max()
        .unwrap();
    if count >= (radius * radius) / 9 && count > runner_up * 3 / 2 {
        ['S', 'A', 'B', 'C', 'E', 'G'][best]
    } else {
        '?'
    }
}

pub(super) fn circle(image: &Image, area: Rect, glyph_height: i32) -> Option<(Mark, i32)> {
    let ink = |x, y| brown_ink(image.at(x, y)) < 188;
    let cols = runs(area.left..area.right, |x| {
        (area.top..area.bottom).any(|y| ink(x, y))
    });
    let glyph = cols.last()?;
    let width = glyph.end - glyph.start;
    let previous = cols.iter().rev().nth(1)?;
    if glyph.start - previous.end < (width / 4).max(2) {
        return None;
    }
    if width * 5 < glyph_height * 3 || width * 4 > glyph_height * 5 {
        return None;
    }
    let rows = runs(area.top..area.bottom, |y| glyph.clone().any(|x| ink(x, y)));
    let top = rows.first()?.start;
    let bottom = rows.last()?.end;
    let height = bottom - top;
    if width * 4 < height * 3 || height * 4 < width * 3 {
        return None;
    }
    let mut outer = 0_u8;
    let mut inner = 0_u8;
    for y in top..bottom {
        for x in glyph.clone().filter(|&x| ink(x, y)) {
            let dx = (2 * (x - glyph.start) + 1) as f32 / width as f32 - 1.;
            let dy = (2 * (y - top) + 1) as f32 / height as f32 - 1.;
            let radius_squared = dx * dx + dy * dy;
            let sector =
                ((dy.atan2(dx) + std::f32::consts::PI) * (4. / std::f32::consts::PI)) as u8 % 8;
            if (0.56..=1.45).contains(&radius_squared) {
                outer |= 1 << sector;
            } else if radius_squared < 0.44 {
                inner |= 1 << sector;
            }
        }
    }
    if outer.count_ones() < 7 {
        return None;
    }
    match inner.count_ones() {
        0..=1 => Some((Mark::Circle, glyph.start)),
        6..=8 => Some((Mark::DoubleCircle, glyph.start)),
        _ => None,
    }
}

pub(super) fn card(
    ocr: &Ocr,
    image: &Image,
    words: &[Word],
    panel: Rect,
    umas: &[Uma],
) -> Result<(Option<i32>, String)> {
    let Some(profile) =
        label(words, "Profile").find(|word| word.x() > panel.right && word.y() < panel.top)
    else {
        return Ok((None, String::new()));
    };
    let w = profile.width();
    let area = Rect::new(
        profile.left - w * 19 / 10,
        profile.bottom + w,
        profile.right + w * 3 / 2,
        profile.bottom + w * 18 / 10,
    );
    let mut text = Vec::new();
    let split = area.top + area.height() / 2;
    for ys in [area.top..split, split..area.bottom] {
        let mut line: Vec<_> = words
            .iter()
            .filter(|word| {
                ys.contains(&word.bounds.y()) && (area.left..area.right).contains(&word.bounds.x())
            })
            .collect();
        line.sort_by_key(|word| word.bounds.left);
        text.extend(line.into_iter().map(|word| word.text.as_str()));
    }
    let raw = text.join(" ");
    if let Some(id) = match_card(umas, &raw) {
        return Ok((Some(id), raw));
    }
    let retry = read(ocr, image, area, profile.height() * 2 / 3, brown_ink)?;
    Ok((match_card(umas, &retry), retry))
}

fn orange_ink([r, g, b]: Rgb) -> u8 {
    let opacity = (r.saturating_sub(b).saturating_sub(28) as u16 * 4)
        .min(r.saturating_sub(g).saturating_sub(7) as u16 * 7)
        .min(g.saturating_sub(b).saturating_sub(18) as u16 * 5);
    255 - opacity.min(255) as u8
}

pub(super) fn skill_points(
    ocr: &Ocr,
    image: &Image,
    layout: &Layout,
) -> Result<(Option<u16>, String)> {
    let panel = layout.panel;
    let width = panel.width();
    let x = panel.x() + width / 12;
    let header = runs(panel.top - width / 7..panel.top, |y| {
        (x - width / 7..x + width / 15)
            .filter(|&x| {
                let [r, g, b] = image.at(x, y);
                r >= 115 && g >= 175 && g > r.saturating_add(32) && b < 95
            })
            .count()
            >= (width / 14) as usize
    })
    .into_iter()
    .max_by_key(|span| span.end - span.start)
    .filter(|span| (width / 55..=width / 18).contains(&(span.end - span.start)));
    let (top, bottom) = header.map_or((panel.top - width / 9, panel.top - width / 24), |header| {
        let y = (header.start + header.end) / 2;
        (y - width / 34, y + width / 34)
    });
    let area = Rect::new(
        panel.left + width * 73 / 100,
        top,
        panel.left + width * 96 / 100,
        bottom,
    );
    let raw = read(ocr, image, area, width / 26, orange_ink)?;
    if let Some(points) = number(&raw) {
        return Ok((Some(points), raw));
    }
    let retry = ocr.text(&image.padded_crop(area, width / 21, |rgb| rgb))?;
    Ok((number(&retry), if retry.is_empty() { raw } else { retry }))
}

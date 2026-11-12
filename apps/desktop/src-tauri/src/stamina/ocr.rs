mod image;
mod layout;
mod matcher;
mod parse;
#[cfg(test)]
mod tests;

use super::{engine, Skill, Uma};
use image::{Image, Ocr, Rect, Result};
use layout::{
    blue_channel_ink, brown_ink, faint_brown_ink, is_event, is_unique, white_ink, Screen,
};
use matcher::{Mark, Matcher, Resolution};
use parse::{
    circle, hint_level, hint_percent, ink_bounds, level, number, read, read_number, Attributes,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::OnceLock,
};
use uma_race_sim::data::SkillData;

const BUNDLED_SKILLS: &str = include_str!("../../resources/skill-data/skills.json");

pub(super) fn screenshot_bytes(
    body: &tauri::ipc::InvokeBody,
) -> std::result::Result<Vec<u8>, String> {
    use tauri::ipc::InvokeBody;
    const MAX_BYTES: usize = 32 * 1024 * 1024;
    let valid = |len| (1..=MAX_BYTES).contains(&len);
    match body {
        InvokeBody::Raw(bytes) if valid(bytes.len()) => Ok(bytes.clone()),
        // Tauri serializes ArrayBuffer as a JSON array if its binary IPC is unavailable.
        InvokeBody::Json(serde_json::Value::Array(bytes)) if valid(bytes.len()) => bytes
            .iter()
            .map(|byte| {
                byte.as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or("Expected image bytes.".into())
            })
            .collect(),
        InvokeBody::Raw(_) | InvokeBody::Json(serde_json::Value::Array(_)) => {
            Err("Choose an image under 32 MB.".into())
        }
        InvokeBody::Json(_) => Err("Expected an image.".into()),
    }
}

#[derive(Clone, Serialize)]
pub(super) struct ImportSkill {
    cost: Option<u16>,
    tier: Option<Tier>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hint_from: Option<i32>,
}

#[derive(Clone, Serialize)]
struct Tier {
    group: i32,
    rank: i32,
}

pub(super) fn import_skills(
    engine_skills: &HashMap<i32, SkillData>,
    catalog: &[Skill],
) -> std::result::Result<BTreeMap<i32, ImportSkill>, String> {
    #[derive(Deserialize)]
    struct Price {
        id: i32,
        cost: Option<u16>,
        gene_version: Option<Inherited>,
    }
    #[derive(Deserialize)]
    struct Inherited {
        id: i32,
    }
    let rows: Vec<Price> =
        serde_json::from_str(BUNDLED_SKILLS).map_err(|error| error.to_string())?;
    let costs: HashMap<_, _> = rows
        .into_iter()
        .flat_map(|row| {
            row.cost
                .map(|cost| (row.id, cost))
                .into_iter()
                .chain(row.gene_version.map(|gene| (gene.id, 200)))
        })
        .collect();
    let circles: HashMap<_, _> = catalog
        .iter()
        .filter_map(|meta| {
            let name = meta.name.strip_suffix(['○', '◯'])?.trim_end();
            let skill = engine_skills.get(&meta.id)?;
            Some(((skill.group_id, name), meta.id))
        })
        .collect();
    Ok(catalog
        .iter()
        .filter_map(|meta| {
            let skill = engine_skills
                .get(&meta.id)
                .filter(|skill| matcher::has_race_effect(skill))?;
            let cost = costs.get(&skill.id).copied().filter(|cost| *cost > 0);
            let tier = (meta.rarity != "unique" && skill.group_id > 0 && skill.group_rate > 0)
                .then_some(Tier {
                    group: skill.group_id,
                    rank: skill.group_rate,
                });
            let hint_from = meta
                .name
                .strip_suffix(['◎', '◉'])
                .and_then(|name| circles.get(&(skill.group_id, name.trim_end())).copied());
            Some((
                skill.id,
                ImportSkill {
                    cost,
                    tier,
                    hint_from,
                },
            ))
        })
        .collect())
}

pub(super) fn scan_png(bytes: &[u8]) -> std::result::Result<Import, String> {
    let engine = engine()?;
    static MATCHER: OnceLock<std::result::Result<Matcher<'static>, String>> = OnceLock::new();
    let matcher = MATCHER
        .get_or_init(|| {
            Matcher::new(&engine.catalog.skills, BUNDLED_SKILLS, &engine.data.skills)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let result = (|| {
        let ocr = Ocr::new()?;
        let image = Image::from_png(bytes)?;
        scan(&ocr, &image, matcher, &engine.catalog.umas)
    })();
    result.map_err(|error| error.to_string())
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
struct SkillFields {
    level: Option<u8>,
    cost: Option<u16>,
    hint: Option<u8>,
    obtained: Option<bool>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    hint_unreadable: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    hint_conflict: bool,
}

#[derive(Debug, Serialize)]
struct SkillRow {
    resolution: Option<Resolution>,
    fields: SkillFields,
    raw_name: String,
    raw_fields: Vec<String>,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
struct Card {
    id: i32,
    title: String,
    name: String,
}

#[derive(Serialize)]
pub struct Import {
    screen: Screen,
    instruction: Option<&'static str>,
    attributes: Option<Attributes>,
    card: Option<Card>,
    skill_points: Option<u16>,
    skills: Vec<SkillRow>,
    #[serde(skip)]
    raw: Vec<String>,
}

struct ResizedCapture<'a> {
    original: &'a Image,
    frame: Rect,
    scale: f32,
}

impl ResizedCapture<'_> {
    fn text_crop(&self, area: Rect, magnification: f32) -> Option<Image> {
        let x = |x: i32| {
            (self.frame.left + (x as f32 / self.scale).round() as i32)
                .clamp(self.frame.left, self.frame.right)
        };
        let y = |y: i32| {
            (self.frame.top + (y as f32 / self.scale).round() as i32)
                .clamp(self.frame.top, self.frame.bottom)
        };
        let original = Rect::new(x(area.left), y(area.top), x(area.right), y(area.bottom));
        (original.width() > 0 && original.height() > 0)
            .then(|| self.original.resample(original, magnification))
    }
}

fn scan(ocr: &Ocr, image: &Image, matcher: &Matcher<'_>, umas: &[Uma]) -> Result<Import> {
    const REFERENCE_BANNER_WIDTH: f32 = 570.0;
    let banner = layout::profile_banner(image);
    let resized = banner.and_then(|banner| {
        let width = banner.width();
        let scale = REFERENCE_BANNER_WIDTH / width as f32;
        // Keep the native pixels when the panel is already in the OCR working range.
        if (420..=600).contains(&width) {
            return None;
        }
        let frame = Rect::new(
            (banner.left - width * 8 / 5).max(0),
            (banner.top - width / 12).max(0),
            (banner.right + width / 7).min(image.width),
            (banner.top + width * 17 / 10).min(image.height),
        );
        Some(ResizedCapture {
            original: image,
            frame,
            scale,
        })
    });
    let normalized = resized
        .as_ref()
        .map(|capture| image.resample(capture.frame, capture.scale));
    scan_at_scale(
        ocr,
        normalized.as_ref().unwrap_or(image),
        resized.as_ref(),
        matcher,
        umas,
    )
}

fn scan_at_scale(
    ocr: &Ocr,
    image: &Image,
    resized: Option<&ResizedCapture<'_>>,
    matcher: &Matcher<'_>,
    umas: &[Uma],
) -> Result<Import> {
    let words = ocr.words(image)?;
    let profile = layout::profile_banner(image);
    let layout = layout::detect(image, &words, profile);
    let mut result = Import {
        screen: layout.screen,
        instruction: None,
        attributes: None,
        card: None,
        skill_points: None,
        skills: Vec::new(),
        raw: Vec::new(),
    };
    if matches!(
        layout.screen,
        Screen::AttributesNumbers | Screen::AttributesChart | Screen::CareerSkills
    ) {
        let (id, raw) = parse::card(ocr, image, &words, layout.panel, umas)?;
        result.card = umas
            .iter()
            .find(|uma| id == Some(uma.card_id))
            .map(|uma| Card {
                id: uma.card_id,
                title: uma.title.clone(),
                name: uma.name.clone(),
            });
        result.raw.push(raw);
    }
    match layout.screen {
        Screen::AttributesNumbers => {
            let (attributes, raw) = parse::attributes(ocr, image, &words, layout.panel)?;
            result.attributes = Some(attributes);
            result.raw.extend(raw);
        }
        Screen::AttributesChart => result.instruction = Some("Switch to the number view"),
        Screen::Learn => {
            let (points, raw) = parse::skill_points(ocr, image, &layout, &words)?;
            result.skill_points = points;
            result.raw.push(raw);
            for row in layout.rows {
                result
                    .skills
                    .push(learn_row(ocr, image, resized, matcher, row)?);
            }
        }
        Screen::CareerSkills | Screen::DetailsSkills | Screen::FinishedDetails => {
            if layout.screen == Screen::FinishedDetails {
                if let Some(header) = layout.header {
                    let (id, attributes, raw) =
                        parse::finished_details(ocr, image, &words, header, umas)?;
                    result.attributes = Some(attributes);
                    result.card = umas
                        .iter()
                        .find(|uma| id == Some(uma.card_id))
                        .map(|uma| Card {
                            id: uma.card_id,
                            title: uma.title.clone(),
                            name: uma.name.clone(),
                        });
                    result.raw.extend(raw);
                }
            }
            for row in layout.rows {
                result
                    .skills
                    .push(owned_row(ocr, image, resized, matcher, row, layout.screen)?);
            }
        }
        Screen::Unsupported => {
            result.instruction = Some(if profile.is_none() {
                "Couldn't read this screenshot. Make the game window larger and capture the full window again."
            } else if layout::label(&words, "Learned").next().is_some() {
                "Skills Learned screen"
            } else if layout::label(&words, "Inspiration").next().is_some() {
                "Finished Uma Details · Switch to Skills"
            } else if layout::label(&words, "Profile").next().is_some()
                && layout::label(&words, "Confirmation").next().is_some()
            {
                "Skill purchase confirmation"
            } else if layout::label(&words, "Close").next().is_some()
                && layout::label(&words, "Growth").next().is_some()
            {
                "Uma Details screen"
            } else {
                "Couldn't read this screenshot. Make the game window larger and capture the full window again."
            });
        }
    }
    Ok(result)
}

// All crop coordinates are percentages of the detected row.
fn region(row: Rect, left: i32, top: i32, right: i32, bottom: i32) -> Rect {
    let x = |percent| row.left + row.width() * percent / 100;
    let y = |percent| row.top + row.height() * percent / 100;
    Rect::new(x(left), y(top), x(right), y(bottom))
}

fn owned_row(
    ocr: &Ocr,
    image: &Image,
    resized: Option<&ResizedCapture<'_>>,
    matcher: &Matcher<'_>,
    row: Rect,
    screen: Screen,
) -> Result<SkillRow> {
    let paint = region(row, 82, 24, 93, 74);
    let unique = pixels_in(image, paint, is_unique) > 0.35;
    let event = pixels_in(image, paint, is_event) > 0.35;
    let has_level = screen != Screen::CareerSkills && (unique || event);
    let glyph_height = row.width() / 22;
    let area = region(row, 16, 10, if has_level { 80 } else { 96 }, 86);
    let (raw_name, matched, _) =
        read_name(ocr, image, resized, matcher, area, glyph_height, unique)?;
    let mut fields = SkillFields::default();
    let mut raw_fields = Vec::new();
    if has_level {
        let crop = region(row, 79, 29, 96, 83);
        let raw = read(ocr, image, crop, glyph_height, brown_ink)?;
        fields.level = level(&raw);
        raw_fields.push(raw);
        if fields.level.is_none() {
            let digit = region(row, 90, 24, 96, 92);
            let (value, raw) = read_number(ocr, image, digit, glyph_height, brown_ink)?;
            fields.level = value
                .filter(|value| (1..=6).contains(value))
                .map(|value| value as u8);
            raw_fields.push(raw);
        }
    }
    Ok(SkillRow {
        resolution: matched,
        fields,
        raw_name,
        raw_fields,
    })
}

fn learn_row(
    ocr: &Ocr,
    image: &Image,
    resized: Option<&ResizedCapture<'_>>,
    matcher: &Matcher<'_>,
    row: Rect,
) -> Result<SkillRow> {
    let glyph_height = row.width() / 32;
    let area = region(row, 15, 3, 70, 25);
    let unique = pixels_in(image, region(row, 92, 15, 96, 25), is_unique) > 0.5;
    let (raw_name, mut matched, mark) =
        read_name(ocr, image, resized, matcher, area, glyph_height, unique)?;
    let mut raw_fields = Vec::new();
    if matched.is_none() {
        let description = read(
            ocr,
            image,
            region(row, 15, 27, 71, 95),
            glyph_height,
            brown_ink,
        )?;
        matched = matcher
            .identify(&raw_name, Some(unique), mark, Some(&description))
            .or_else(|| matcher.identify_name_fragment(&raw_name, unique, &description));
        raw_fields.push(description);
    }
    let mut fields = SkillFields::default();
    let badge = region(row, 75, 37, 94, 61);
    if pixels_in(image, badge, |[r, g, b]| {
        r >= 222 && g < 100 && (88..=175).contains(&b)
    }) > 0.12
    {
        let raw = read(ocr, image, badge, glyph_height, |[_, g, b]| {
            (255 - g.min(b)).saturating_mul(2)
        })?;
        fields.obtained = Some(true);
        raw_fields.push(raw);
    } else {
        let crop = region(row, 78, 37, 91, 66);
        let raw = ocr.text(&image.padded_crop(crop, glyph_height * 5 / 4, |rgb| rgb))?;
        let (cost, raw) = if let Some(cost) = number(&raw) {
            (Some(cost), raw)
        } else {
            read_number(
                ocr,
                image,
                region(row, 78, 38, 90, 62),
                glyph_height,
                brown_ink,
            )?
        };
        fields.cost = cost;
        fields.obtained = fields.cost.map(|_| false);
        raw_fields.push(raw);
    }
    let search = region(row, 74, 2, 95, 29);
    let orange = |[r, g, b]: image::Rgb| r >= 242 && (112..=166).contains(&g) && b < 60;
    if pixels_in(image, search, orange) > 0.20 {
        let badge = ink_bounds(image, search, orange).unwrap_or(search);
        let top = read(
            ocr,
            image,
            region(badge, 3, 0, 97, 50),
            glyph_height * 3 / 4,
            white_ink,
        )?;
        let bottom = read(
            ocr,
            image,
            region(badge, 3, 49, 97, 95),
            glyph_height * 3 / 4,
            white_ink,
        )?;
        let mut labeled = hint_level(&top);
        let mut percent = hint_percent(&bottom);
        raw_fields.extend([top, bottom]);
        if labeled.is_none() || percent.is_none() {
            // At small sizes the white text blends into the orange paint. The
            // color crop retains strokes that the white-ink mask rejects.
            let color = if let Some(source) = resized
                .filter(|capture| capture.scale > 1.0)
                .and_then(|capture| capture.text_crop(badge, 3.0))
            {
                let area = Rect::new(0, 0, source.width, source.height);
                ocr.text(&source.padded_crop(area, 32, |rgb| rgb))?
            } else {
                ocr.text(&image.padded_crop(badge, glyph_height, |rgb| rgb))?
            };
            labeled = labeled.or_else(|| hint_level(&color));
            percent = percent.or_else(|| hint_percent(&color));
            raw_fields.push(color);
        }
        if labeled.is_none() || percent.is_none() {
            let full = read(ocr, image, badge, glyph_height, |[_, _, b]| {
                255 - (b.saturating_sub(40) as u16 * 255 / 170).min(255) as u8
            })?;
            labeled = labeled.or_else(|| hint_level(&full));
            percent = percent.or_else(|| hint_percent(&full));
            raw_fields.push(full);
        }
        fields.hint = percent.or(labeled);
        fields.hint_unreadable = fields.hint.is_none();
        fields.hint_conflict = percent.zip(labeled).is_some_and(|(a, b)| a != b);
    }
    Ok(SkillRow {
        resolution: matched,
        fields,
        raw_name,
        raw_fields,
    })
}

fn read_name(
    ocr: &Ocr,
    image: &Image,
    resized: Option<&ResizedCapture<'_>>,
    matcher: &Matcher<'_>,
    area: Rect,
    glyph_height: i32,
    unique: bool,
) -> Result<(String, Option<Resolution>, Option<Mark>)> {
    let raw = read(ocr, image, area, glyph_height, brown_ink)?;
    let matched = matcher.identify(&raw, Some(unique), None, None);
    if matched.is_some() {
        return Ok((raw, matched, None));
    }
    let glyph = circle(image, area, glyph_height);
    let mark = glyph.map(|(mark, _)| mark);
    if mark.is_some() {
        let matched = matcher.identify(&raw, Some(unique), mark, None);
        if matched.is_some() {
            return Ok((raw, matched, mark));
        }
    }
    let mut name_crop = area;
    if let Some((_, left)) = glyph {
        name_crop.right = left;
    }
    if glyph.is_some() {
        let base = read(ocr, image, name_crop, glyph_height, brown_ink)?;
        let matched = matcher.identify(&base, Some(unique), mark, None);
        if matched.is_some() {
            return Ok((raw, matched, mark));
        }
    }
    let mut best_raw = raw;
    if let Some(bounds) = ink_bounds(image, name_crop, |pixel| brown_ink(pixel) < 175) {
        let retry = ocr.text(&image.padded_crop(bounds, glyph_height, |rgb| rgb))?;
        let matched = matcher.identify(&retry, Some(unique), mark, None);
        if matched.is_some() {
            return Ok((retry, matched, mark));
        }
        if best_raw.is_empty() {
            best_raw = retry;
        }
    }
    let tight =
        ink_bounds(image, name_crop, |pixel| faint_brown_ink(pixel) < 185).unwrap_or(name_crop);
    for (crop, height, color) in [
        (
            name_crop,
            glyph_height,
            faint_brown_ink as fn(image::Rgb) -> u8,
        ),
        (tight, glyph_height * 3 / 4, faint_brown_ink),
    ] {
        let retry = read(ocr, image, crop, height, color)?;
        let matched = matcher.identify(&retry, Some(unique), mark, None);
        if matched.is_some() {
            return Ok((retry, matched, mark));
        }
        if retry.chars().filter(|c| c.is_alphanumeric()).count()
            > best_raw.chars().filter(|c| c.is_alphanumeric()).count()
        {
            best_raw = retry;
        }
    }
    if let Some(capture) = resized.filter(|capture| capture.scale > 1.0) {
        // A second resize of the working frame can smear the smallest glyphs.
        // Retry the same region enlarged directly from the original pixels.
        for scale in [3.0, 4.0] {
            let Some(crop) = capture.text_crop(name_crop, scale) else {
                break;
            };
            let retry = read(
                ocr,
                &crop,
                Rect::new(0, 0, crop.width, crop.height),
                32,
                blue_channel_ink,
            )?;
            let matched = matcher.identify(&retry, Some(unique), mark, None);
            if matched.is_some() {
                return Ok((retry, matched, mark));
            }
            if retry.chars().filter(|c| c.is_alphanumeric()).count()
                > best_raw.chars().filter(|c| c.is_alphanumeric()).count()
            {
                best_raw = retry;
            }
        }
    }
    let retry = ocr.text(&image.padded_crop(name_crop, glyph_height, |rgb| rgb))?;
    let matched = matcher.identify(&retry, Some(unique), mark, None);
    Ok((
        if matched.is_some() { retry } else { best_raw },
        matched,
        mark,
    ))
}

fn pixels_in(image: &Image, area: Rect, mut predicate: impl FnMut(image::Rgb) -> bool) -> f32 {
    let mut count = 0;
    for y in area.top..area.bottom {
        for x in area.left..area.right {
            count += usize::from(predicate(image.at(x, y)));
        }
    }
    count as f32 / (area.width() * area.height()) as f32
}

#[cfg(test)]
#[derive(Default)]
struct SkillImport {
    identified: BTreeMap<i32, SkillRow>,
    ignored: Vec<SkillRow>,
    unknown: Vec<SkillRow>,
}

#[cfg(test)]
impl SkillImport {
    fn extend(&mut self, rows: Vec<SkillRow>) {
        for row in rows {
            let matched = match row.resolution {
                Some(Resolution::Matched(matched)) => matched,
                Some(Resolution::IgnoredNoRaceEffect) => {
                    self.ignored.push(row);
                    continue;
                }
                None => {
                    self.unknown.push(row);
                    continue;
                }
            };
            self.identified
                .entry(matched.id)
                .and_modify(|existing| {
                    existing.fields.level = existing.fields.level.max(row.fields.level);
                    if existing.fields.obtained != Some(true) && row.fields.obtained == Some(true) {
                        existing.fields.obtained = Some(true);
                        existing.fields.cost = None;
                        existing.fields.hint = None;
                    } else if existing.fields.obtained != Some(true)
                        && row.fields.obtained == Some(false)
                    {
                        existing.fields.obtained = Some(false);
                        existing.fields.cost = row.fields.cost;
                        existing.fields.hint = row.fields.hint;
                    }
                    if existing
                        .resolution
                        .and_then(Resolution::matched)
                        .is_some_and(|old| old.confidence < matched.confidence)
                    {
                        existing.resolution = row.resolution;
                        existing.raw_name.clone_from(&row.raw_name);
                    }
                })
                .or_insert(row);
        }
    }
}

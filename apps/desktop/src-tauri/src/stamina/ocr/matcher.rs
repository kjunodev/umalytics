use super::super::{Skill, Uma};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uma_race_sim::data::SkillData;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Mark {
    Circle,
    DoubleCircle,
    Cross,
}

fn split_mark(name: &str) -> (&str, Option<Mark>) {
    let name = name.trim();
    for (symbols, mark) in [
        ("○◯", Mark::Circle),
        ("◎◉", Mark::DoubleCircle),
        ("×✕", Mark::Cross),
    ] {
        if let Some(base) = name.strip_suffix(|c| symbols.contains(c)) {
            return (base.trim_end(), Some(mark));
        }
    }
    (name, None)
}

fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn distance(left: &str, right: &str) -> usize {
    let right: Vec<_> = right.chars().collect();
    let mut costs: Vec<_> = (0..=right.len()).collect();
    for (i, a) in left.chars().enumerate() {
        let mut diagonal = costs[0];
        costs[0] = i + 1;
        for (j, &b) in right.iter().enumerate() {
            let above = costs[j + 1];
            costs[j + 1] = (diagonal + usize::from(a != b)).min(1 + above.min(costs[j]));
            diagonal = above;
        }
    }
    costs[right.len()]
}

#[derive(Deserialize)]
struct Metadata {
    id: i32,
    desc_en: Option<String>,
    gene_version: Option<Box<Metadata>>,
    loc: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    unreleased: Vec<String>,
}

impl Metadata {
    fn global_availability(&self) -> Option<bool> {
        if self.unreleased.iter().any(|region| region == "en") {
            Some(false)
        } else {
            self.loc
                .as_ref()
                .filter(|loc| loc.contains_key("en"))
                .map(|_| true)
        }
    }
}

struct Entry<'a> {
    skill: &'a Skill,
    name: String,
    mark: Option<Mark>,
    description: Option<String>,
    global: Option<bool>,
    non_race: bool,
}

pub(super) struct Matcher<'a>(Vec<Entry<'a>>);

#[derive(Debug, Clone, Copy, Serialize)]
pub(super) struct Match {
    pub id: i32,
    pub confidence: f32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Resolution {
    Matched(Match),
    IgnoredNoRaceEffect,
}

impl Resolution {
    #[cfg(test)]
    pub fn matched(self) -> Option<Match> {
        match self {
            Self::Matched(matched) => Some(matched),
            Self::IgnoredNoRaceEffect => None,
        }
    }
}

pub(super) fn is_race_effect(effect: i32) -> bool {
    // Match the simulator's create_ability arms and the type 6 running-style override.
    matches!(effect, 1..=14 | 21 | 22 | 27..=32 | 35..=38)
}

pub(super) fn has_race_effect(skill: &SkillData) -> bool {
    skill
        .details
        .iter()
        .flat_map(|detail| &detail.abilities)
        .any(|ability| is_race_effect(ability.ability_type))
}

const MIN_CONFIDENCE: f32 = 0.88;

impl<'a> Matcher<'a> {
    pub fn new(
        skills: &'a [Skill],
        metadata_json: &str,
        engine_skills: &HashMap<i32, SkillData>,
    ) -> serde_json::Result<Self> {
        let rows: Vec<Metadata> = serde_json::from_str(metadata_json)?;
        let mut descriptions = HashMap::new();
        let mut availability = HashMap::new();
        for row in rows {
            let global = row.global_availability();
            for metadata in std::iter::once(&row).chain(row.gene_version.as_deref()) {
                descriptions.extend(
                    metadata
                        .desc_en
                        .as_ref()
                        .map(|desc| (metadata.id, normalize(desc))),
                );
                availability
                    .entry(metadata.id)
                    .or_insert(metadata.global_availability().or(global));
            }
        }
        Ok(Self(
            skills
                .iter()
                .filter_map(|skill| {
                    if skill.name == format!("Skill {}", skill.id) {
                        return None;
                    }
                    let display = skill
                        .name
                        .strip_suffix(" (inherited)")
                        .unwrap_or(&skill.name);
                    let (base, mark) = split_mark(display);
                    Some(Entry {
                        skill,
                        name: normalize(base),
                        mark,
                        description: descriptions.remove(&skill.id),
                        global: availability.get(&skill.id).copied().flatten(),
                        non_race: engine_skills
                            .get(&skill.id)
                            .is_some_and(|skill| !has_race_effect(skill)),
                    })
                })
                .collect(),
        ))
    }

    pub fn identify(
        &self,
        raw: &str,
        unique: Option<bool>,
        visual_mark: Option<Mark>,
        description: Option<&str>,
    ) -> Option<Resolution> {
        let (base, _) = split_mark(raw);
        let key = normalize(base);
        let without_ocr_mark = base
            .rsplit_once(char::is_whitespace)
            .and_then(|(head, tail)| {
                matches!(
                    tail.to_ascii_lowercase().as_str(),
                    "o" | "0" | "00" | "x" | "c"
                )
                .then(|| normalize(head))
            });
        let eligible = || {
            self.0.iter().filter(|entry| {
                unique.is_none_or(|unique| (entry.skill.rarity == "unique") == unique)
            })
        };
        let query = |entry: &Entry<'_>| {
            if entry.mark.is_some() {
                without_ocr_mark.as_ref().unwrap_or(&key)
            } else {
                &key
            }
        };
        let mut ranked: Vec<_> = eligible()
            .filter_map(|entry| {
                let query = query(entry);
                (entry.name == *query).then(|| (0, query.chars().count(), entry))
            })
            .collect();
        if ranked.is_empty() {
            for entry in eligible() {
                let query = query(entry);
                let length = query.chars().count();
                if length.abs_diff(entry.name.chars().count()) <= 3 {
                    ranked.push((distance(query, &entry.name), length, entry));
                }
            }
            ranked.sort_unstable_by_key(|&(edits, _, _)| edits);
        }
        let &(edits, length, best) = ranked.first()?;
        let confidence = 1.0 - edits as f32 / length.max(1) as f32;
        let budget = match length {
            0..=5 => 0,
            6..=13 => 1,
            _ => 2,
        };
        if length == 0 || edits > budget || confidence < MIN_CONFIDENCE {
            return None;
        }
        // Only use metadata and glyph shape to disambiguate the same base name.
        // A similarly spelled different name needs independent name evidence.
        if ranked.iter().any(|&(other_edits, _, other)| {
            other.name != best.name && other_edits < edits + if edits == 0 { 1 } else { 2 }
        }) {
            return None;
        }
        let mut family: Vec<_> = ranked
            .iter()
            .filter_map(|&(other_edits, _, entry)| {
                (entry.name == best.name && other_edits == edits).then_some(entry)
            })
            .collect();
        if family.iter().all(|entry| entry.non_race) {
            return Some(Resolution::IgnoredNoRaceEffect);
        }
        if family.iter().any(|entry| entry.global == Some(true)) {
            family.retain(|entry| entry.global != Some(false));
        }
        let chosen = if family.len() == 1 && family[0].mark.is_none() && visual_mark.is_none() {
            family[0]
        } else if let Some(description) = description.filter(|desc| !desc.trim().is_empty()) {
            match_description(&family, description, visual_mark)?
        } else {
            only(
                family
                    .into_iter()
                    .filter(|entry| entry.mark.is_some() && entry.mark == visual_mark),
            )?
        };
        if chosen.non_race {
            return None;
        }
        Some(Resolution::Matched(Match {
            id: chosen.skill.id,
            confidence,
        }))
    }
}

fn only<T>(mut choices: impl Iterator<Item = T>) -> Option<T> {
    let first = choices.next()?;
    choices.next().is_none().then_some(first)
}

pub(super) fn match_card(umas: &[Uma], raw: &str) -> Option<i32> {
    let key = normalize(raw);
    only(
        umas.iter()
            .filter(|uma| key == normalize(&format!("{} {}", uma.title, uma.name)))
            .map(|uma| uma.card_id),
    )
}

fn match_description<'a, 's>(
    family: &[&'a Entry<'s>],
    description: &str,
    visual_mark: Option<Mark>,
) -> Option<&'a Entry<'s>> {
    let key = normalize(description);
    if key.len() < 12 {
        return None;
    }
    let mut ranked: Vec<_> = family
        .iter()
        .map(|&entry| Some((distance(&key, entry.description.as_ref()?), entry)))
        .collect::<Option<_>>()?;
    ranked.sort_unstable_by_key(|&(edits, _)| edits);
    let (edits, best) = *ranked.first()?;
    let min_margin = if edits == 0 { 1 } else { 3 };
    if edits * 5 > key.chars().count()
        || ranked
            .get(1)
            .is_some_and(|&(next, _)| next < edits + min_margin)
        || visual_mark.is_some_and(|mark| best.mark != Some(mark))
    {
        return None;
    }
    Some(best)
}

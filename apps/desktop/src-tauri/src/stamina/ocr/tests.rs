use super::*;
use crate::stamina::{engine, skill_data, Skill, UmaAptitudes};
use matcher::{Mark, Match};
use parse::number;
use std::{collections::HashMap, fs, path::Path, time::Instant};

#[test]
fn engine_effect_types_are_accounted_for() {
    let mut unknown = BTreeMap::<i32, Vec<i32>>::new();
    for (&id, skill) in &engine().unwrap().data.skills {
        for ability in skill.details.iter().flat_map(|detail| &detail.abilities) {
            let kind = ability.ability_type;
            // Zero is an unused slot. These three Carnival Bonus skills only affect event points.
            let non_race =
                kind == 0 || matches!((id, kind), (1000011, 501) | (1000012 | 1000013, 502 | 503));
            if !matcher::is_race_effect(kind) && !non_race {
                unknown.entry(kind).or_default().push(id);
            }
        }
    }
    assert!(
        unknown.is_empty(),
        "Unclassified engine effects (type → skill IDs): {unknown:?}"
    );
}

#[test]
fn import_catalog_uses_shipped_prices_and_engine_tiers() {
    let skills = &engine().unwrap().catalog.screenshot_skills;
    assert_eq!(skills[&200501].cost, Some(120));
    assert_eq!(skills[&200502].cost, Some(120));
    assert_eq!(skills[&910311].cost, Some(200));
    assert_eq!(skills[&110311].cost, None);
    assert!(!skills.contains_key(&1000011));
    for (first, second) in [(200502, 200501), (200012, 200011)] {
        let first = skills[&first].tier.as_ref().unwrap();
        let second = skills[&second].tier.as_ref().unwrap();
        assert_eq!(first.group, second.group);
        assert_eq!((first.rank, second.rank), (1, 2));
    }
    assert!(
        skills[&200013].tier.is_none(),
        "A negative skill is independent"
    );
    assert_eq!(skills[&201111].hint_from, Some(201112));
    assert_eq!(skills[&200181].hint_from, Some(200182));
}

#[test]
fn recognizes_hint_max_and_reads_the_percentage_independently() {
    assert_eq!(hint_level("Hint Lvl Max 40% OFF!"), Some(5));
    assert_eq!(hint_percent("Hint Lvl Max 40% OFF!"), Some(5));
    assert_eq!(hint_level("Hint LVI I"), Some(1));
    assert_eq!(hint_percent("Hint LVI I 1096 OFF!"), Some(1));
    assert_eq!(hint_level("Hint Lvl 3 35% OFF!"), Some(3));
    assert_eq!(hint_percent("Hint Lvl 3 35% OFF!"), Some(4));
}

#[test]
fn screenshot_ipc_accepts_binary_and_tauri_post_message_fallback() {
    use tauri::ipc::InvokeBody;
    let png_signature = vec![137, 80, 78, 71, 13, 10, 26, 10];
    assert_eq!(
        screenshot_bytes(&InvokeBody::Raw(png_signature.clone())).unwrap(),
        png_signature
    );
    assert_eq!(
        screenshot_bytes(&InvokeBody::Json(serde_json::json!(png_signature))).unwrap(),
        png_signature
    );
    assert!(screenshot_bytes(&InvokeBody::Raw(Vec::new())).is_err());
    assert!(screenshot_bytes(&InvokeBody::Json(serde_json::json!([256]))).is_err());
}

#[derive(Deserialize, Debug)]
enum ExpectedResult {
    #[serde(rename = "ignored: no race effect")]
    IgnoredNoRaceEffect,
}

#[derive(Deserialize)]
struct ExpectedRow {
    id: Option<i32>,
    result: Option<ExpectedResult>,
    name: String,
    #[serde(flatten)]
    fields: SkillFields,
}

#[derive(Deserialize)]
struct Expected {
    screen: Option<Screen>,
    crop: Option<String>,
    attributes: Option<Attributes>,
    card: Option<Card>,
    skill_points: Option<u16>,
    #[serde(default)]
    skills: Vec<ExpectedRow>,
}

#[derive(Default)]
struct Score {
    screens: usize,
    classified: usize,
    skill_rows: usize,
    identified: usize,
    ignored: usize,
    rows_with_fields: usize,
    wrong: usize,
    non_skill_fields: usize,
    correct_non_skill_fields: usize,
}

fn compare(name: &str, expected: &Expected, actual: &Import, score: &mut Score) {
    let screen = expected.screen.unwrap();
    score.screens += 1;
    score.classified += usize::from(actual.screen == screen);
    score.skill_rows += expected.skills.len();
    if actual.screen != screen {
        println!(
            "MISS {name} screen {:?}, expected {:?}",
            actual.screen, screen
        );
    }
    for (field, matches, details) in [
        (
            "attributes",
            expected.attributes == actual.attributes,
            format!("{:?} expected {:?}", actual.attributes, expected.attributes),
        ),
        (
            "card",
            expected.card == actual.card,
            format!("{:?} expected {:?}", actual.card, expected.card),
        ),
        (
            "skill points",
            expected.skill_points == actual.skill_points,
            format!(
                "{:?} expected {:?}",
                actual.skill_points, expected.skill_points
            ),
        ),
        (
            "instruction",
            (screen == Screen::AttributesChart)
                == (actual.instruction == Some("Switch to the number view")),
            format!("{:?}", actual.instruction),
        ),
    ] {
        let expected_field = match field {
            "attributes" => expected.attributes.is_some(),
            "card" => expected.card.is_some(),
            "skill points" => expected.skill_points.is_some(),
            _ => screen == Screen::AttributesChart,
        };
        score.non_skill_fields += usize::from(expected_field);
        score.correct_non_skill_fields += usize::from(expected_field && matches);
        if !matches {
            println!("MISS {name} {field}: {details}, raw {:?}", actual.raw);
        }
    }

    let mut matched_rows = vec![false; actual.skills.len()];
    for (index, row) in expected.skills.iter().enumerate() {
        let is_match = |candidate: &SkillRow| match (candidate.resolution, &row.result) {
            (Some(Resolution::Matched(matched)), None) => row.id == Some(matched.id),
            (Some(Resolution::IgnoredNoRaceEffect), Some(ExpectedResult::IgnoredNoRaceEffect)) => {
                candidate.raw_name.eq_ignore_ascii_case(&row.name)
            }
            _ => false,
        };
        let found = {
            if actual.skills.len() == expected.skills.len() {
                actual
                    .skills
                    .get(index)
                    .filter(|candidate| is_match(candidate))
                    .map(|candidate| (index, candidate))
            } else {
                actual
                    .skills
                    .iter()
                    .enumerate()
                    .find(|(i, candidate)| !matched_rows[*i] && is_match(candidate))
            }
        };
        if let Some((i, found)) = found {
            matched_rows[i] = true;
            if row.id.is_some() {
                score.identified += 1;
            } else {
                score.ignored += 1;
            }
            if found.fields == row.fields {
                score.rows_with_fields += 1;
            } else {
                println!(
                    "MISS {name} {:?} fields {:?}, expected {:?}, raw name {:?}, raw fields {:?}",
                    row.name, found.fields, row.fields, found.raw_name, found.raw_fields
                );
            }
        } else {
            let at_position = actual.skills.get(index);
            let raw = at_position
                .filter(|_| actual.skills.len() == expected.skills.len())
                .map(|row| &row.raw_name);
            println!(
                "MISS {name} expected {:?} id {:?}, result {:?}, fields {:?}, raw {raw:?}",
                row.name, row.id, row.result, row.fields
            );
        }
    }
    for (row, accounted_for) in actual.skills.iter().zip(matched_rows) {
        if !accounted_for {
            score.wrong += usize::from(row.resolution.is_some());
            println!(
                "{} {name} result {:?}, raw {:?}, fields {:?}, raw fields {:?}",
                if row.resolution.is_some() {
                    "WRONG/EXTRA"
                } else {
                    "UNKNOWN"
                },
                row.resolution,
                row.raw_name,
                row.fields,
                row.raw_fields
            );
        }
    }
}

#[test]
#[ignore = "requires UMALYTICS_OCR_SAMPLES and the Windows English OCR language pack"]
fn screenshot_accuracy() -> Result<()> {
    let folder = std::env::var_os("UMALYTICS_OCR_SAMPLES").ok_or("Set UMALYTICS_OCR_SAMPLES")?;
    let folder = Path::new(&folder);
    const SCALES: &[f32] = &[0.75, 1.0, 1.25];
    let mut passed = benchmark_set(folder, SCALES, folder.ends_with("small-window"))?;
    for (name, verify_native_fields) in [
        ("career-2", false),
        ("small-window", true),
        ("retest-2026-11-12", false),
    ] {
        let extra = folder.join(name);
        if extra.is_dir() {
            passed &= benchmark_set(&extra, SCALES, verify_native_fields)?;
        }
    }
    assert!(passed, "Expected correct screen classifications, at least 98% correct rows, and zero wrong matches at each scale");
    Ok(())
}

fn benchmark_set(folder: &Path, scales: &[f32], verify_fields: bool) -> Result<bool> {
    let json = fs::read_to_string(folder.join("expected.json"))?;
    let expected: BTreeMap<String, Expected> =
        serde_json::from_str(json.trim_start_matches('\u{feff}'))?;
    let images = fs::read_dir(folder)?.collect::<std::io::Result<Vec<_>>>()?;
    let images: std::collections::BTreeSet<_> = images
        .iter()
        .filter_map(|file| {
            file.path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
                .then(|| file.file_name().to_string_lossy().into_owned())
        })
        .collect();
    assert!(!expected.is_empty(), "No labeled screenshots");
    assert!(
        images.iter().eq(expected.keys()),
        "expected.json must label every PNG in the folder"
    );

    let engine = engine()?;
    let mut skills = engine.catalog.skills.clone();
    let metadata = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/skill-data");
    assert!(skill_data::enrich_from(&mut skills, &metadata).0);
    let metadata = fs::read_to_string(metadata.join("skills.json"))?;
    let matcher = Matcher::new(&skills, &metadata, &engine.data.skills)?;
    let ocr = Ocr::new()?;
    let dump = std::env::var_os("UMALYTICS_OCR_DUMP").is_some();
    if dump {
        println!(
            "OCR_CATALOG {}",
            serde_json::to_string(&import_skills(&engine.data.skills, &skills)?)?
        );
    }
    let crops = expected
        .values()
        .filter(|entry| entry.crop.is_some())
        .count();
    println!(
        "Set {}: {} screenshots, {crops} labeled crops excluded",
        folder.file_name().unwrap_or_default().to_string_lossy(),
        expected.len() - crops
    );
    let mut passed = true;
    for &scale in scales {
        let mut scores = BTreeMap::<Screen, Score>::new();
        let mut dedup = SkillImport::default();
        let mut scan_time = std::time::Duration::ZERO;
        println!("Scale {scale:.2}x");
        for (name, expected) in &expected {
            assert_ne!(
                expected.screen.is_some(),
                expected.crop.is_some(),
                "{name} needs a screen or a crop label"
            );
            let Some(screen) = expected.screen else {
                continue;
            };
            for row in &expected.skills {
                assert_ne!(
                    row.id.is_some(),
                    row.result.is_some(),
                    "{name} must specify an ID or an ignore result for {:?}",
                    row.name
                );
                if let Some(id) = row.id {
                    assert!(
                        skills.iter().any(|skill| skill.id == id
                            && skill
                                .name
                                .strip_suffix(" (inherited)")
                                .unwrap_or(&skill.name)
                                == row.name),
                        "{name} expected {:?} with id {id} is absent from the catalog",
                        row.name
                    );
                }
            }
            let screenshot = Image::open(&folder.join(name))?;
            let screenshot = if scale == 1. {
                screenshot
            } else {
                screenshot.resize(scale)
            };
            let start = Instant::now();
            let actual = scan(&ocr, &screenshot, &matcher, &engine.catalog.umas)?;
            let elapsed = start.elapsed();
            scan_time += elapsed;
            if dump {
                println!(
                    "OCR_SCAN {}",
                    serde_json::json!({ "scale": scale, "name": name, "width": screenshot.width, "height": screenshot.height, "scan": actual })
                );
            }
            println!(
                "{name}: {:?}, {} rows, {:.1} ms",
                actual.screen,
                actual.skills.len(),
                elapsed.as_secs_f64() * 1000.
            );
            compare(name, expected, &actual, scores.entry(screen).or_default());
            dedup.extend(actual.skills);
        }
        for (screen, score) in &scores {
            println!("{screen:?}: screens {}/{}, IDs {}, correctly ignored {}, complete rows {}/{}, wrong/extra {}, non-skill results {}/{}",
                score.classified, score.screens, score.identified, score.ignored,
                score.rows_with_fields, score.skill_rows, score.wrong,
                score.correct_non_skill_fields, score.non_skill_fields);
        }
        let correct: usize = scores.values().map(|s| s.identified + s.ignored).sum();
        let total: usize = scores.values().map(|s| s.skill_rows).sum();
        let wrong: usize = scores.values().map(|s| s.wrong).sum();
        let screens: usize = scores.values().map(|s| s.screens).sum();
        let classified: usize = scores.values().map(|s| s.classified).sum();
        let accuracy = correct as f64 / total.max(1) as f64;
        let gate = total > 0
            && correct * 100 >= total * 98
            && wrong == 0
            && scores
                .values()
                .all(|score| score.classified == score.screens)
            && scores
                .get(&Screen::FinishedDetails)
                .is_none_or(|score| score.correct_non_skill_fields == score.non_skill_fields)
            && (!verify_fields
                || scale != 1.0
                || scores.values().all(|score| {
                    score.correct_non_skill_fields == score.non_skill_fields
                        && score.rows_with_fields == score.skill_rows
                }));
        passed &= gate;
        println!("Gate {scale:.2}x: {classified}/{screens} screens, {correct}/{total} rows ({:.2}%), wrong/extra {wrong}, {:.2}s total, {:.0}ms/image: {}",
            100. * accuracy, scan_time.as_secs_f64(), scan_time.as_secs_f64() * 1000. / screens.max(1) as f64, if gate { "PASS" } else { "FAIL" });
        for row in &dedup.ignored {
            println!(
                "IGNORED: no race effect, raw {:?}, level {:?}",
                row.raw_name, row.fields.level
            );
        }
    }
    Ok(passed)
}

fn skill(id: i32, name: &str, rarity: &str) -> Skill {
    Skill {
        id,
        name: name.to_owned(),
        rarity: rarity.to_owned(),
        hp_recovery: false,
        icon_path: None,
    }
}

#[test]
fn fuzzy_match_uses_catalog_and_rejects_close_competitors() {
    let skills = [
        skill(1, "Leader's Pride", "white"),
        skill(2, "Victoria por plancha ☆ (inherited)", "white"),
        skill(3, "Front Runner", "white"),
        skill(4, "Front Runners", "white"),
        skill(5, "Victoria por plancha ☆", "unique"),
    ];
    let matcher = Matcher::new(&skills, "[]", &HashMap::new()).unwrap();
    assert_eq!(
        matcher
            .identify("Leaders Prlde", None, None, None)
            .and_then(Resolution::matched)
            .unwrap()
            .id,
        1
    );
    assert_eq!(
        matcher
            .identify("Victoria por plancha", Some(false), None, None)
            .and_then(Resolution::matched)
            .unwrap()
            .id,
        2
    );
    assert!(matcher
        .identify("Victoria por plancha", None, None, None)
        .is_none());
    assert!(matcher.identify("Front Runnes", None, None, None).is_none());
    assert!(matcher.identify("No skill", None, None, None).is_none());
}

#[test]
fn circle_variants_need_shape_or_description_and_conflict_is_unknown() {
    let skills = [
        skill(1, "Tokyo Racecourse ○", "white"),
        skill(2, "Tokyo Racecourse ◎", "white"),
        skill(3, "Tokyo Racecourse ×", "white"),
    ];
    let matcher = Matcher::new(
        &skills,
        r#"[
        {"id":1,"desc_en":"Moderately increase performance at Tokyo Racecourse."},
        {"id":2,"desc_en":"Increase performance at Tokyo Racecourse."},
        {"id":3,"desc_en":"Moderately decrease performance at Tokyo Racecourse."}
    ]"#,
        &HashMap::new(),
    )
    .unwrap();
    let name = "Tokyo Racecourse O";
    assert!(matcher.identify(name, None, None, None).is_none());
    let choice = matcher.circle_variants(name, Some(Mark::Circle)).unwrap();
    assert_eq!(
        (
            choice.name.as_str(),
            choice.circle,
            choice.double_circle,
            choice.suggested
        ),
        ("Tokyo Racecourse", 1, 2, Some(1))
    );
    assert_eq!(
        matcher.circle_variants(name, None).unwrap().suggested,
        Some(1)
    );
    assert_eq!(
        matcher
            .circle_variants("Tokyo Racecourse", None)
            .unwrap()
            .suggested,
        None
    );
    assert!(matcher
        .circle_variants("Unknown Racecourse", Some(Mark::Circle))
        .is_none());
    assert!(matcher
        .identify("Tokyo Racecourse ○", None, None, None)
        .is_none());
    assert_eq!(
        matcher
            .identify(name, None, Some(Mark::DoubleCircle), None)
            .and_then(Resolution::matched)
            .unwrap()
            .id,
        2
    );
    let description = "Moderately increase performance at Tokyo Racecourse.";
    assert_eq!(
        matcher
            .identify(name, None, None, Some(description))
            .and_then(Resolution::matched)
            .unwrap()
            .id,
        1
    );
    assert!(matcher
        .identify(name, None, Some(Mark::DoubleCircle), Some(description))
        .is_none());
}

#[test]
fn same_name_requires_positive_global_evidence_to_exclude_unreleased_duplicate() {
    let skills = [
        skill(1, "Firm Resolve", "white"),
        skill(2, "Firm Resolve", "white"),
    ];
    let matcher = Matcher::new(
        &skills,
        r#"[{"id":2,"unreleased":["en"]}]"#,
        &HashMap::new(),
    )
    .unwrap();
    assert!(matcher.identify("Firm Resolve", None, None, None).is_none());
    let matcher = Matcher::new(
        &skills,
        r#"[{"id":1,"loc":{"en":{}}},{"id":2,"unreleased":["en"]}]"#,
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(
        matcher
            .identify("Firm Resolve", None, None, None)
            .and_then(Resolution::matched)
            .unwrap()
            .id,
        1
    );
}

#[test]
fn ignores_only_names_whose_candidates_have_no_race_effect() {
    use uma_race_sim::data::SkillData;
    let skills = [
        skill(1, "Event Bonus", "white"),
        skill(2, "Event Bonus", "white"),
        skill(3, "Race Bonus", "white"),
        skill(4, "Race Bonus", "white"),
        skill(5, "Mixed Effects", "white"),
    ];
    let with_effects = |effects: &[i32]| {
        let mut skill = SkillData::default();
        for (slot, &kind) in skill
            .details
            .iter_mut()
            .flat_map(|detail| &mut detail.abilities)
            .zip(effects)
        {
            slot.ability_type = kind;
        }
        skill
    };
    let mut effects = HashMap::from([
        (1, with_effects(&[501])),
        (2, with_effects(&[502, 503])),
        (3, with_effects(&[9])),
        (4, with_effects(&[31])),
        (5, with_effects(&[501, 502, 503, 6])),
    ]);
    let matcher = Matcher::new(&skills, "[]", &effects).unwrap();
    assert!(matches!(
        matcher.identify("Event Bonus", None, None, None),
        Some(Resolution::IgnoredNoRaceEffect)
    ));
    assert!(matcher.identify("Race Bonus", None, None, None).is_none());
    assert_eq!(
        matcher
            .identify("Mixed Effects", None, None, None)
            .and_then(Resolution::matched)
            .unwrap()
            .id,
        5
    );

    effects.remove(&2);
    let matcher = Matcher::new(&skills, "[]", &effects).unwrap();
    assert!(matcher.identify("Event Bonus", None, None, None).is_none());
}

#[test]
fn parsers_require_complete_numeric_fields_and_full_card_identity() {
    assert_eq!(number(" 1210 "), Some(1210));
    assert_eq!(number("O70"), None);
    assert_eq!(number("715/1330"), None);
    assert_eq!(level("Hint LvI 4 35% OFF!"), Some(4));
    assert_eq!(level("Hint Lvl 4 35% OFF!"), Some(4));
    assert_eq!(level("Hint L vl 4 35% OFF!"), Some(4));
    assert_eq!(level("Hint Lvl 35% OFF!"), None);
    assert_eq!(level("Hint I vl"), None);
    assert_eq!(level("Lvl 5"), Some(5));
    assert_eq!(level("Lvl 0"), None);
    assert_eq!(level("10% OFF!"), None);
    let umas = [Uma {
        card_id: 42,
        name: "Runner".to_owned(),
        title: "[First Card]".to_owned(),
        unique_skill_id: 1,
        aptitudes: UmaAptitudes {
            distance: [0; 4],
            style: [0; 4],
            ground: [0; 2],
        },
    }];
    assert_eq!(matcher::match_card(&umas, "[First Card]\nRunner"), Some(42));
    assert_eq!(matcher::match_card(&umas, "Runner"), None);
}

#[test]
fn dedup_merges_identified_ids_and_keeps_unknown_observations() {
    let row = |resolution, level| SkillRow {
        resolution,
        variant_choice: None,
        fields: SkillFields {
            level,
            ..SkillFields::default()
        },
        raw_name: "Name".to_owned(),
        raw_fields: Vec::new(),
    };
    let mut merged = SkillImport::default();
    let matched = Some(Resolution::Matched(Match {
        id: 1,
        confidence: 1.,
    }));
    merged.extend(vec![row(matched, None), row(None, None)]);
    merged.extend(vec![
        row(matched, Some(5)),
        row(None, None),
        row(Some(Resolution::IgnoredNoRaceEffect), Some(1)),
    ]);
    assert_eq!(merged.identified.len(), 1);
    assert_eq!(merged.identified[&1].fields.level, Some(5));
    assert_eq!(merged.unknown.len(), 2);
    assert_eq!(merged.ignored.len(), 1);
    assert_eq!(merged.ignored[0].fields.level, Some(1));
}

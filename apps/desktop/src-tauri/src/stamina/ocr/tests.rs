use super::*;
use crate::stamina::{engine, skill_data, Skill, UmaAptitudes};
use matcher::Mark;
use std::{fs, path::Path, time::Instant};

#[derive(Deserialize)]
struct ExpectedRow {
    id: Option<i32>,
    name: String,
    #[serde(flatten)]
    fields: SkillFields,
}

#[derive(Deserialize)]
struct Expected {
    screen: Screen,
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
    rows_with_fields: usize,
    wrong: usize,
    non_skill_fields: usize,
    correct_non_skill_fields: usize,
}

fn compare(name: &str, expected: &Expected, actual: &Import, score: &mut Score) {
    score.screens += 1;
    score.classified += usize::from(actual.screen == expected.screen);
    score.skill_rows += expected.skills.len();
    if actual.screen != expected.screen {
        println!(
            "MISS {name} screen {:?}, expected {:?}",
            actual.screen, expected.screen
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
            (expected.screen == Screen::AttributesChart)
                == (actual.instruction == Some("Switch to the number view")),
            format!("{:?}", actual.instruction),
        ),
    ] {
        let expected_field = match field {
            "attributes" => expected.attributes.is_some(),
            "card" => expected.card.is_some(),
            "skill points" => expected.skill_points.is_some(),
            _ => expected.screen == Screen::AttributesChart,
        };
        score.non_skill_fields += usize::from(expected_field);
        score.correct_non_skill_fields += usize::from(expected_field && matches);
        if !matches {
            println!("MISS {name} {field}: {details}, raw {:?}", actual.raw);
        }
    }

    let mut matched_rows = vec![false; actual.skills.len()];
    for (index, row) in expected.skills.iter().enumerate() {
        let found = row.id.and_then(|id| {
            let is_match =
                |candidate: &SkillRow| candidate.matched.is_some_and(|matched| matched.id == id);
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
        });
        if let Some((i, found)) = found {
            matched_rows[i] = true;
            score.identified += 1;
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
                "MISS {name} expected {:?} id {:?}, raw {raw:?}",
                row.name, row.id
            );
        }
    }
    for (row, accounted_for) in actual.skills.iter().zip(matched_rows) {
        if !accounted_for {
            score.wrong += usize::from(row.matched.is_some());
            println!(
                "{} {name} id {:?}, raw {:?}, fields {:?}, raw fields {:?}",
                if row.matched.is_some() {
                    "WRONG/EXTRA"
                } else {
                    "UNKNOWN"
                },
                row.matched,
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
    let matcher = Matcher::new(&skills, &metadata)?;
    let ocr = Ocr::new()?;
    let mut passed = true;
    for scale in [1., 0.75, 1.25] {
        let mut scores = BTreeMap::<Screen, Score>::new();
        let mut dedup = SkillImport::default();
        println!("Scale {scale:.2}x");
        for (name, expected) in &expected {
            for row in &expected.skills {
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
            println!(
                "{name}: {:?}, {} rows, {:.1} ms",
                actual.screen,
                actual.skills.len(),
                start.elapsed().as_secs_f64() * 1000.
            );
            compare(
                name,
                expected,
                &actual,
                scores.entry(expected.screen).or_default(),
            );
            dedup.extend(actual.skills);
        }
        for (screen, score) in &scores {
            println!("{screen:?}: screens {}/{}, IDs {}/{}, complete rows {}/{}, wrong/extra {}, non-skill results {}/{}",
                score.classified, score.screens, score.identified, score.skill_rows,
                score.rows_with_fields, score.skill_rows, score.wrong,
                score.correct_non_skill_fields, score.non_skill_fields);
        }
        let identified: usize = scores.values().map(|s| s.identified).sum();
        let total: usize = scores.values().map(|s| s.skill_rows).sum();
        let wrong: usize = scores.values().map(|s| s.wrong).sum();
        let accuracy = identified as f64 / total.max(1) as f64;
        let gate = total > 0 && identified * 100 >= total * 98 && wrong == 0;
        passed &= gate;
        println!("Gate {scale:.2}x: {identified}/{total} ({:.2}%), wrong/extra {wrong}, {} distinct IDs, {} unknown rows: {}",
            100. * accuracy, dedup.identified.len(), dedup.unknown.len(), if gate { "PASS" } else { "FAIL" });
    }
    assert!(
        passed,
        "Expected at least 98% identified and zero wrong IDs at each scale"
    );
    Ok(())
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
    let matcher = Matcher::new(&skills, "[]").unwrap();
    assert_eq!(
        matcher
            .identify("Leaders Prlde", None, None, None)
            .unwrap()
            .id,
        1
    );
    assert_eq!(
        matcher
            .identify("Victoria por plancha", Some(false), None, None)
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
    )
    .unwrap();
    let name = "Tokyo Racecourse O";
    assert!(matcher.identify(name, None, None, None).is_none());
    assert!(matcher
        .identify("Tokyo Racecourse ○", None, None, None)
        .is_none());
    assert_eq!(
        matcher
            .identify(name, None, Some(Mark::DoubleCircle), None)
            .unwrap()
            .id,
        2
    );
    let description = "Moderately increase performance at Tokyo Racecourse.";
    assert_eq!(
        matcher
            .identify(name, None, None, Some(description))
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
    let matcher = Matcher::new(&skills, r#"[{"id":2,"unreleased":["en"]}]"#).unwrap();
    assert!(matcher.identify("Firm Resolve", None, None, None).is_none());
    let matcher = Matcher::new(
        &skills,
        r#"[{"id":1,"loc":{"en":{}}},{"id":2,"unreleased":["en"]}]"#,
    )
    .unwrap();
    assert_eq!(
        matcher
            .identify("Firm Resolve", None, None, None)
            .unwrap()
            .id,
        1
    );
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
    let row = |id: Option<i32>, level| SkillRow {
        matched: id.map(|id| Match { id, confidence: 1. }),
        fields: SkillFields {
            level,
            ..SkillFields::default()
        },
        raw_name: "Name".to_owned(),
        raw_fields: Vec::new(),
    };
    let mut merged = SkillImport::default();
    merged.extend(vec![row(Some(1), None), row(None, None)]);
    merged.extend(vec![row(Some(1), Some(5)), row(None, None)]);
    assert_eq!(merged.identified.len(), 1);
    assert_eq!(merged.identified[&1].fields.level, Some(5));
    assert_eq!(merged.unknown.len(), 2);
}

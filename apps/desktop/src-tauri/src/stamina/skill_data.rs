use super::Skill;
use serde_json::Value;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

pub(super) fn rarity(value: i32) -> &'static str {
    match value {
        3..=5 => "unique",
        2 => "gold",
        _ => "white",
    }
}

fn data_dir() -> PathBuf {
    std::env::var_os("UMALYTICS_GAMEDATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default())
                .join("Documents/Coding Projects/UmaLytics-GameData/gametora")
        })
}

// Only numbered image files whose canonical path stays inside icons/ are
// returned to the asset protocol. Symlinks escaping that directory are rejected.
fn icon_path(dir: &Path, icon: i64) -> Option<String> {
    if icon <= 0 {
        return None;
    }
    let root = dir.join("icons").canonicalize().ok()?;
    for ext in ["webp", "png"] {
        if let Ok(path) = root.join(format!("{icon}.{ext}")).canonicalize() {
            if path.starts_with(&root) && path.is_file() {
                return Some(path.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn apply(skills: &mut [Skill], rows: &[Value], dir: &Path) {
    let mut metadata = HashMap::new();
    for row in rows {
        let global = row.pointer("/loc/en").is_some_and(Value::is_object);
        if let Some(id) = row["id"].as_i64() {
            metadata.insert(id, (row, global, false));
        }
        if let Some(gene) = row.get("gene_version") {
            if let Some(id) = gene["id"].as_i64() {
                metadata.insert(id, (gene, global, true));
            }
        }
    }
    for skill in skills {
        // When local metadata exists, unlisted skills have no verified Global
        // release. Without metadata the complete engine catalog stays usable.
        skill.global = false;
        if let Some((row, global, inherited)) = metadata.get(&i64::from(skill.id)) {
            skill.global = *global;
            if let Some(name) = row["name_en"]
                .as_str()
                .or_else(|| row["enname"].as_str())
                .or_else(|| row["jpname"].as_str())
            {
                skill.name = if *inherited {
                    format!("{name} (inherited)")
                } else {
                    name.into()
                };
            }
            skill.rarity = match row["rarity"].as_i64() {
                Some(2) => "gold",
                Some(3..=5) if !inherited => "unique",
                _ => "white",
            }
            .into();
            skill.icon_path = row["iconid"].as_i64().and_then(|id| icon_path(dir, id));
        }
    }
}

pub(super) fn enrich(skills: &mut [Skill]) -> bool {
    enrich_from(skills, &data_dir())
}

fn enrich_from(skills: &mut [Skill], dir: &Path) -> bool {
    let rows = std::fs::read_to_string(dir.join("skills.json"))
        .ok()
        .and_then(|json| serde_json::from_str::<Vec<Value>>(&json).ok());
    if let Some(rows) = rows.filter(|rows| !rows.is_empty()) {
        apply(skills, &rows, dir);
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_metadata_maps_global_inherited_and_rarity_without_bundling_data() {
        let make = |id| Skill {
            id,
            name: "Engine name".into(),
            hp_recovery: false,
            global: true,
            rarity: "white".into(),
            icon_path: None,
        };
        let mut skills = vec![make(110001), make(910001), make(200001), make(200002)];
        let rows = serde_json::json!([
            {"id":110001,"name_en":"Fixture unique","rarity":5,"loc":{"en":{}},
             "gene_version":{"id":910001,"name_en":"Fixture inherited","rarity":1}},
            {"id":200001,"name_en":"Fixture gold","rarity":2}
        ]);
        apply(&mut skills, rows.as_array().unwrap(), Path::new("missing"));
        assert!(skills[0].global && skills[1].global);
        assert!(!skills[2].global && !skills[3].global);
        assert_eq!(skills[0].rarity, "unique");
        assert_eq!(skills[1].rarity, "white");
        assert_eq!(skills[1].name, "Fixture inherited (inherited)");
        assert_eq!(skills[2].rarity, "gold");
        assert!(skills.iter().all(|s| s.icon_path.is_none()));
    }

    #[test]
    fn missing_metadata_preserves_engine_names_and_icons_are_numbered_images_only() {
        let root = std::env::temp_dir().join(format!(
            "umalytics-icon-scope-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("icons")).unwrap();
        let mut skills = vec![Skill {
            id: 123,
            name: "Engine fallback".into(),
            hp_recovery: true,
            global: true,
            rarity: "white".into(),
            icon_path: None,
        }];
        assert!(!enrich_from(&mut skills, &root));
        assert_eq!(skills[0].name, "Engine fallback");
        assert!(skills[0].global && skills[0].icon_path.is_none());
        std::fs::write(root.join("icons/123.png"), b"synthetic").unwrap();
        std::fs::write(root.join("icons/456.svg"), b"synthetic").unwrap();
        std::fs::write(root.join("789.png"), b"synthetic").unwrap();
        assert_eq!(
            PathBuf::from(icon_path(&root, 123).unwrap()),
            root.join("icons/123.png").canonicalize().unwrap()
        );
        assert!(icon_path(&root, 456).is_none());
        assert!(icon_path(&root, 789).is_none());
        assert!(icon_path(&root, -123).is_none());
        std::fs::write(root.join("icons/123.webp"), b"synthetic").unwrap();
        assert!(icon_path(&root, 123).unwrap().ends_with("123.webp"));
        std::fs::write(root.join("skills.json"), b"broken").unwrap();
        assert!(!enrich_from(&mut skills, &root));
        std::fs::remove_dir_all(root).unwrap();
    }
}

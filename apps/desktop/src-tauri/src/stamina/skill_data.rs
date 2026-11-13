use super::Skill;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    ffi::{OsStr, OsString},
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
    crate::resources::skill_dir()
}

struct Icons {
    root: Option<PathBuf>,
    names: HashSet<OsString>,
}

impl Icons {
    fn new(dir: &Path) -> Self {
        let root = dir.join("icons").canonicalize().ok();
        let names = root
            .as_ref()
            .and_then(|root| std::fs::read_dir(root).ok())
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();
        Self { root, names }
    }

    fn resolve(&self, name: &OsStr) -> Option<PathBuf> {
        if !self.names.contains(name) {
            return None;
        }
        let root = self.root.as_ref()?;
        contained_icon(root, &root.join(name))
    }

    fn count(&self) -> usize {
        self.names
            .iter()
            .filter(|name| {
                let path = Path::new(name);
                let id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(|s| s.parse::<i64>().ok());
                matches!(
                    path.extension().and_then(|s| s.to_str()),
                    Some("webp" | "png")
                ) && id.is_some_and(|id| id > 0)
                    && self.resolve(name).is_some()
            })
            .count()
    }

    fn path(&self, icon: i64) -> Option<String> {
        if icon <= 0 {
            return None;
        }
        for ext in ["webp", "png"] {
            if let Some(path) = self.resolve(OsStr::new(&format!("{icon}.{ext}"))) {
                return Some(path.to_string_lossy().into_owned());
            }
        }
        None
    }
}

// Only numbered image files whose canonical path stays inside icons/ are
// returned to the asset protocol. Symlinks escaping that directory are rejected.
fn contained_icon(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let path = candidate.canonicalize().ok()?;
    (path.starts_with(root) && path.is_file()).then_some(path)
}

fn apply(skills: &mut [Skill], rows: &[Value], icons: &Icons) {
    let mut metadata = HashMap::new();
    for row in rows {
        if let Some(id) = row["id"].as_i64() {
            metadata.insert(id, (row, false));
        }
        if let Some(gene) = row.get("gene_version") {
            if let Some(id) = gene["id"].as_i64() {
                metadata.insert(id, (gene, true));
            }
        }
    }
    for skill in skills {
        if let Some((row, inherited)) = metadata.get(&i64::from(skill.id)) {
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
            skill.icon_path = row["iconid"].as_i64().and_then(|id| icons.path(id));
        }
    }
}

pub(super) fn enrich(skills: &mut [Skill]) -> (bool, String, usize, usize) {
    enrich_from(skills, &data_dir())
}

pub(super) fn enrich_from(skills: &mut [Skill], dir: &Path) -> (bool, String, usize, usize) {
    let rows = std::fs::read_to_string(dir.join("skills.json"))
        .ok()
        .and_then(|json| serde_json::from_str::<Vec<Value>>(&json).ok());
    let count = rows.as_ref().map_or(0, Vec::len);
    let icons = Icons::new(dir);
    let enriched = if let Some(rows) = rows.filter(|rows| !rows.is_empty()) {
        apply(skills, &rows, &icons);
        true
    } else {
        false
    };
    (
        enriched,
        dir.to_string_lossy().into_owned(),
        count,
        icons.count(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_fresh_parlor_has_an_icon() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/skill-data");
        let mut skills = [Skill {
            id: 110311,
            name: "Fresh☆Parlor".into(),
            hp_recovery: true,
            rarity: "unique".into(),
            icon_path: None,
        }];
        assert!(enrich_from(&mut skills, &dir).0);
        assert!(skills[0].icon_path.is_some());
    }

    #[test]
    fn local_metadata_maps_inherited_and_rarity_without_filtering_sources() {
        let make = |id| Skill {
            id,
            name: "Engine name".into(),
            hp_recovery: false,
            rarity: "white".into(),
            icon_path: None,
        };
        let mut skills = vec![make(110001), make(910001), make(200001), make(200002)];
        let rows = serde_json::json!([
            {"id":110001,"name_en":"Fixture unique","rarity":5,"loc":{"en":{}},
             "gene_version":{"id":910001,"name_en":"Fixture inherited","rarity":1}},
            {"id":200001,"name_en":"Fixture gold","rarity":2}
        ]);
        apply(
            &mut skills,
            rows.as_array().unwrap(),
            &Icons::new(Path::new("missing")),
        );
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
            rarity: "white".into(),
            icon_path: None,
        }];
        assert!(!enrich_from(&mut skills, &root).0);
        assert_eq!(
            enrich_from(&mut skills, &root),
            (false, root.to_string_lossy().into_owned(), 0, 0)
        );
        assert_eq!(skills[0].name, "Engine fallback");
        assert!(skills[0].icon_path.is_none());
        std::fs::write(root.join("icons/123.png"), b"synthetic").unwrap();
        std::fs::write(root.join("icons/456.svg"), b"synthetic").unwrap();
        std::fs::write(root.join("789.png"), b"synthetic").unwrap();
        std::fs::create_dir(root.join("icons/321.png")).unwrap();
        assert_eq!(
            PathBuf::from(Icons::new(&root).path(123).unwrap()),
            root.join("icons/123.png").canonicalize().unwrap()
        );
        assert!(Icons::new(&root).path(456).is_none());
        assert!(Icons::new(&root).path(789).is_none());
        assert!(Icons::new(&root).path(321).is_none());
        assert!(Icons::new(&root).path(-123).is_none());
        let icons = Icons::new(&root);
        assert!(contained_icon(icons.root.as_ref().unwrap(), &root.join("789.png")).is_none());
        assert!(contained_icon(icons.root.as_ref().unwrap(), &root.join("icons")).is_none());
        assert_eq!(enrich_from(&mut skills, &root).3, 1);
        std::fs::write(root.join("icons/123.webp"), b"synthetic").unwrap();
        assert!(Icons::new(&root).path(123).unwrap().ends_with("123.webp"));
        std::fs::write(root.join("skills.json"), b"broken").unwrap();
        assert!(!enrich_from(&mut skills, &root).0);
        assert_eq!(enrich_from(&mut skills, &root).2, 0);
        std::fs::write(root.join("skills.json"), b"[{\"id\":123,\"iconid\":123}]").unwrap();
        let status = enrich_from(&mut skills, &root);
        assert!(status.0);
        assert_eq!(status.2, 1);
        assert!(skills[0].icon_path.as_ref().unwrap().ends_with("123.webp"));
        std::fs::remove_dir_all(root).unwrap();
    }
}

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();
static ENGINE_DIR: OnceLock<Result<PathBuf, String>> = OnceLock::new();

fn engine_path(resources: &Path, debug: bool, development: &Path) -> Result<PathBuf, String> {
    let path = if debug {
        development.to_path_buf()
    } else {
        resources.join("engine-data")
    };
    if !path.join("names.json").is_file() {
        return Err(format!("UmaLytics engine data is missing at {}. Reinstall UmaLytics to restore its bundled resources.", path.display()));
    }
    Ok(path)
}

fn load_engine_path(resources: &Path, debug: bool, development: &Path) -> Result<PathBuf, String> {
    let engine = engine_path(resources, debug, development)?;
    // Validate the complete data set before any lazy engine command can run.
    uma_race_sim::data::GameData::load(&engine, uma_race_sim::data::DataEra::current()).map_err(
        |error| {
            format!(
                "Unable to load UmaLytics engine data at {}: {error}",
                engine.display()
            )
        },
    )?;
    Ok(engine)
}

pub fn initialize(resources: Result<PathBuf, String>) {
    ENGINE_DIR.get_or_init(|| {
        let resources = resources?;
        let engine = load_engine_path(&resources, cfg!(debug_assertions), Path::new(uma_race_sim::data::DATA_DIR));
        RESOURCE_DIR.get_or_init(|| resources);
        engine
    });
}

fn initialized_engine(state: &OnceLock<Result<PathBuf, String>>) -> Result<&Path, String> {
    state.get().ok_or_else(|| "UmaLytics race data was not initialized.".to_string())?
        .as_deref().map_err(Clone::clone)
}

pub fn engine_dir() -> Result<&'static Path, String> {
    #[cfg(test)]
    if ENGINE_DIR.get().is_none() {
        return Ok(Path::new(uma_race_sim::data::DATA_DIR));
    }
    initialized_engine(&ENGINE_DIR)
}

pub fn skill_path(
    override_dir: Option<PathBuf>,
    resources: Option<&Path>,
    debug_fallback: Option<PathBuf>,
) -> PathBuf {
    if let Some(path) = override_dir {
        return path;
    }
    if let Some(path) = resources.map(|path| path.join("skill-data")) {
        if path.join("skills.json").is_file() || debug_fallback.is_none() {
            return path;
        }
    }
    debug_fallback.unwrap_or_else(|| PathBuf::from("skill-data"))
}

pub fn skill_dir() -> PathBuf {
    #[cfg(debug_assertions)]
    let fallback = std::env::var_os("USERPROFILE").map(|home| {
        PathBuf::from(home).join("Documents/Coding Projects/UmaLytics-GameData/gametora")
    });
    #[cfg(not(debug_assertions))]
    let fallback = None;
    skill_path(
        std::env::var_os("UMALYTICS_GAMEDATA_DIR").map(PathBuf::from),
        RESOURCE_DIR.get().map(PathBuf::as_path),
        fallback,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_engine_data_surfaces_startup_error() {
        let state = OnceLock::new();
        let resources = Path::new("missing-race-data-fixture");
        state.get_or_init(|| load_engine_path(resources, false, Path::new("unused")));
        let error = initialized_engine(&state).unwrap_err();
        assert!(error.contains("missing-race-data-fixture") && error.contains("Reinstall"));
    }

    #[test]
    fn release_requires_bundled_engine_and_debug_uses_checkout() {
        let development = Path::new(uma_race_sim::data::DATA_DIR);
        let missing = Path::new("nonexistent-resource-fixture");
        assert_eq!(
            engine_path(missing, true, development).unwrap(),
            development
        );
        let error = engine_path(missing, false, development).unwrap_err();
        assert!(error.contains("engine-data") && error.contains("Reinstall"));
        let root = std::env::temp_dir().join(format!("umalytics-resources-{}", std::process::id()));
        std::fs::create_dir_all(root.join("engine-data")).unwrap();
        std::fs::write(root.join("engine-data/names.json"), "{}").unwrap();
        assert_eq!(
            engine_path(&root, false, development).unwrap(),
            root.join("engine-data")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skill_lookup_prefers_override_then_bundle_then_debug_fallback() {
        let root = std::env::temp_dir().join(format!("umalytics-skills-{}", std::process::id()));
        let fallback = Some(PathBuf::from("development"));
        assert_eq!(
            skill_path(Some("override".into()), Some(&root), fallback.clone()),
            PathBuf::from("override")
        );
        assert_eq!(
            skill_path(None, Some(&root), fallback.clone()),
            PathBuf::from("development")
        );
        assert_eq!(skill_path(None, Some(&root), None), root.join("skill-data"));
        std::fs::create_dir_all(root.join("skill-data")).unwrap();
        std::fs::write(root.join("skill-data/skills.json"), "[]").unwrap();
        assert_eq!(
            skill_path(None, Some(&root), fallback),
            root.join("skill-data")
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

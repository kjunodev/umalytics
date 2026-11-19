use super::*;

#[test]
fn screenshot_import_respects_the_saved_choice_and_both_overrides() {
    for flag in [None, Some(""), Some("0"), Some("true"), Some("1")] {
        for saved in [false, true] {
            let flag_value = flag.map(OsStr::new);
            let release = ScreenshotImportAccess::new(saved, forced_by(false, flag_value));
            let debug = ScreenshotImportAccess::new(saved, forced_by(true, flag_value));
            assert_eq!(release.enabled(), saved || flag == Some("1"));
            assert_eq!(
                release.setting(saved).forced_by,
                (flag == Some("1")).then_some(ForceSource::Environment)
            );
            assert!(debug.enabled());
            assert_eq!(debug.setting(saved).forced_by, Some(ForceSource::Debug));
            assert_eq!(release.setting(saved).saved, saved);
            assert_eq!(release.setting(saved).supported, cfg!(windows));
            assert_eq!(release.setting(saved).enabled, cfg!(windows) && release.enabled());
            assert_eq!(debug.setting(saved).enabled, cfg!(windows));
        }
    }
}

#[test]
fn screenshot_import_setting_defaults_off_and_round_trips() {
    let dir = std::env::temp_dir().join(format!(
        "umalytics-experimental-settings-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let path = dir.join("experimental.json");
    assert!(!saved_choice(&path));
    fs::create_dir_all(&dir).unwrap();
    fs::write(&path, b"{").unwrap();
    assert!(!saved_choice(&path));
    fs::write(&path, br#"{"screenshotImport":"true"}"#).unwrap();
    assert!(!saved_choice(&path));
    write_choice(&path, true).unwrap();
    assert!(saved_choice(&path));
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        r#"{"screenshotImport":true}"#
    );
    write_choice(&path, false).unwrap();
    assert!(!saved_choice(&path));
    fs::remove_dir_all(&dir).unwrap();
}

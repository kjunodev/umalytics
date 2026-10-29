use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Instant,
};
use tauri::Emitter;
use uma_race_sim::{
    data::{DataEra, GameData},
    sim::{race, tick},
    HorseInput, RaceInput, SkillInput,
};

/// The single data-location boundary for a future packaged data provider.
fn engine_data_dir() -> &'static Path {
    Path::new(uma_race_sim::data::DATA_DIR)
}

type CmRow = (i32, String, Option<String>, i32, i32, i32, i32, i32, i32);

#[derive(Deserialize)]
struct Names {
    track: HashMap<i32, String>,
    skill: HashMap<i32, Vec<serde_json::Value>>,
    cm: Vec<CmRow>,
}

#[derive(Clone, Serialize)]
pub struct Course {
    id: i32,
    track_name: String,
    distance: i32,
    surface: i32,
    direction: i32,
    race_instance_id: Option<i32>,
}

#[derive(Clone, Serialize)]
pub struct Preset {
    id: i32,
    name: String,
    date: Option<String>,
    course_set_id: i32,
    ground_condition: i32,
    weather: i32,
    season: i32,
}

#[derive(Clone, Serialize)]
pub struct Skill {
    id: i32,
    name: String,
}

#[derive(Clone, Serialize)]
pub struct Catalog {
    courses: Vec<Course>,
    presets: Vec<Preset>,
    skills: Vec<Skill>,
}

struct Engine {
    data: GameData,
    catalog: Catalog,
}

fn guarded<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    // The upstream library has panicking data lookups. Never unwind across IPC.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).map_err(|_| {
        "The race engine could not simulate this build or load its data.".to_string()
    })?
}

fn engine() -> Result<&'static Engine, String> {
    static ENGINE: OnceLock<Result<Engine, String>> = OnceLock::new();
    ENGINE
        .get_or_init(|| guarded(load_engine))
        .as_ref()
        .map_err(Clone::clone)
}

fn load_engine() -> Result<Engine, String> {
    let data = GameData::load(engine_data_dir(), DataEra::current())?;
    let names: Names = serde_json::from_str(
        &std::fs::read_to_string(engine_data_dir().join("names.json"))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let valid_instance = |id: i32, course: i32| {
        data.master
            .race_instance
            .get(&id)
            .and_then(|instance| data.master.race.get(&instance.race_id))
            .is_some_and(|race| race.course_set == course && race.grade == 100)
    };
    let mut courses: Vec<_> = data
        .master
        .race_course_set
        .values()
        .map(|course| {
            // CM entries carry the intended G1 identity for grade/race skill conditions.
            // Otherwise choose the lowest valid G1 instance on this exact course, never
            // borrow a race from another course. Courses without one cannot be simulated.
            let race_instance_id = names
                .cm
                .iter()
                .find(|cm| cm.3 == course.id && valid_instance(cm.4, course.id))
                .map(|cm| cm.4)
                .or_else(|| {
                    data.master
                        .race_instance
                        .keys()
                        .copied()
                        .filter(|id| valid_instance(*id, course.id))
                        .min()
                });
            Course {
                id: course.id,
                track_name: names
                    .track
                    .get(&course.race_track_id)
                    .cloned()
                    .unwrap_or_else(|| format!("Track {}", course.race_track_id)),
                distance: course.distance,
                surface: course.ground,
                direction: course.turn,
                race_instance_id,
            }
        })
        .collect();
    courses.sort_by_key(|c| (c.track_name.clone(), c.distance, c.surface, c.id));
    let presets = names
        .cm
        .into_iter()
        .filter(|cm| valid_instance(cm.4, cm.3))
        .map(|cm| Preset {
            id: cm.0,
            name: cm.1,
            date: cm.2,
            course_set_id: cm.3,
            ground_condition: cm.5,
            weather: cm.6,
            season: cm.7,
        })
        .collect();
    let mut skills: Vec<_> = data
        .skills
        .keys()
        .map(|id| Skill {
            id: *id,
            name: names
                .skill
                .get(id)
                .and_then(|row| row.first())
                .and_then(|name| name.as_str())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("Skill {id}")),
        })
        .collect();
    skills.sort_by_key(|s| (s.name.clone(), s.id));
    Ok(Engine {
        data,
        catalog: Catalog {
            courses,
            presets,
            skills,
        },
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Stats {
    speed: i32,
    stamina: i32,
    pow: i32,
    guts: i32,
    wiz: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedSkill {
    id: i32,
    level: i32,
}

fn default_seeds() -> usize {
    200
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    #[serde(default)]
    request_id: String,
    course_set_id: i32,
    ground_condition: i32,
    weather: i32,
    season: i32,
    running_style: i32,
    stats: Stats,
    motivation: i32,
    distance: [i32; 4],
    style: [i32; 4],
    ground: [i32; 2],
    #[serde(default)]
    skills: Vec<SelectedSkill>,
    #[serde(default = "default_seeds")]
    seeds: usize,
}

fn validate(input: &Input, engine: &Engine) -> Result<i32, String> {
    let range = |name: &str, value: i32, low, high| {
        if (low..=high).contains(&value) {
            Ok(())
        } else {
            Err(format!("{name} must be between {low} and {high}."))
        }
    };
    if input.request_id.len() > 128 {
        return Err("Request ID is too long.".into());
    }
    range("Ground condition", input.ground_condition, 1, 4)?;
    range("Weather", input.weather, 1, 4)?;
    range("Season", input.season, 1, 5)?;
    range("Running style", input.running_style, 1, 4)?;
    range("Motivation", input.motivation, 1, 5)?;
    for (name, value) in [
        ("Speed", input.stats.speed),
        ("Power", input.stats.pow),
        ("Guts", input.stats.guts),
        ("Wit", input.stats.wiz),
    ] {
        range(name, value, 1, 2000)?;
    }
    range("Stamina", input.stats.stamina, 300, 1600)?;
    for grade in input
        .distance
        .iter()
        .chain(&input.style)
        .chain(&input.ground)
    {
        range("Aptitude", *grade, 1, 8)?;
    }
    if !(1..=1000).contains(&input.seeds) {
        return Err("Seeds must be between 1 and 1000.".into());
    }
    if input.skills.len() > 100 {
        return Err("Select at most 100 skills.".into());
    }
    let mut unique = HashSet::new();
    for skill in &input.skills {
        if !engine.data.skills.contains_key(&skill.id) {
            return Err(format!("Unknown skill ID {}.", skill.id));
        }
        if !unique.insert(skill.id) {
            return Err(format!("Duplicate skill ID {}.", skill.id));
        }
        range("Skill level", skill.level, 1, 6)?;
    }
    engine
        .catalog
        .courses
        .iter()
        .find(|c| c.id == input.course_set_id)
        .ok_or_else(|| "Unknown course ID.".to_string())?
        .race_instance_id
        .ok_or_else(|| "This course has no valid G1 race instance in the engine data.".into())
}

#[derive(Default)]
pub struct Checks {
    active: Mutex<Option<Arc<AtomicBool>>>,
}

impl Checks {
    fn begin(&self) -> Result<Arc<AtomicBool>, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Stamina request state is unavailable.")?;
        let token = Arc::new(AtomicBool::new(false));
        if let Some(old) = active.replace(token.clone()) {
            old.store(true, Ordering::Relaxed);
        }
        Ok(token)
    }
    fn cancel(&self) -> Result<(), String> {
        if let Some(token) = self
            .active
            .lock()
            .map_err(|_| "Stamina request state is unavailable.")?
            .take()
        {
            token.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
    fn finish(&self, token: &Arc<AtomicBool>) {
        if let Ok(mut active) = self.active.lock() {
            if active
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, token))
            {
                active.take();
            }
        }
    }
}

fn cancelled(token: &AtomicBool) -> Result<(), String> {
    if token.load(Ordering::Relaxed) {
        Err("Stamina check cancelled.".into())
    } else {
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Point {
    stamina: i32,
    no_hp_out_percent: f64,
    avg_min_hp: f64,
}

#[derive(Debug, Serialize)]
pub struct CheckResult {
    request_id: String,
    curve: Vec<Point>,
    current: Point,
    threshold: Option<i32>,
    seeds: usize,
    races: usize,
    elapsed_ms: f64,
    ms_per_race: f64,
    race_instance_id: i32,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    request_id: String,
    completed: usize,
    total: usize,
}

fn sweep(stamina: i32) -> Vec<i32> {
    let mut values = BTreeSet::from([300, 1600, stamina]);
    let mut value = stamina - 50;
    while value > 300 {
        values.insert(value);
        value -= 50;
    }
    value = stamina + 50;
    while value < 1600 {
        values.insert(value);
        value += 50;
    }
    values.into_iter().collect()
}

fn race_input(input: &Input, instance: i32) -> RaceInput {
    let build = HorseInput {
        speed: input.stats.speed,
        stamina: input.stats.stamina,
        pow: input.stats.pow,
        guts: input.stats.guts,
        wiz: input.stats.wiz,
        running_style: input.running_style,
        motivation: input.motivation,
        proper_distance: input.distance,
        proper_running_style: input.style,
        proper_ground: input.ground,
        skills: input
            .skills
            .iter()
            .map(|s| SkillInput {
                skill_id: s.id,
                level: s.level,
            })
            .collect(),
        viewer_id: 1,
        rarity: 3,
        ..Default::default()
    };
    RaceInput {
        course_set_id: input.course_set_id,
        ground_condition: input.ground_condition,
        weather: input.weather,
        season: input.season,
        time: 2,
        race_type: 5,
        race_instance_id: instance,
        horses: (1..=9)
            .map(|gate| HorseInput {
                popularity: gate,
                frame_order: gate,
                ..build.clone()
            })
            .collect(),
        ..Default::default()
    }
}

fn one_race(input: &RaceInput, data: &GameData, token: &AtomicBool) -> Result<(bool, f64), String> {
    cancelled(token)?;
    let mut race = race::init(input, data);
    tick::start(&mut race);
    let mut min_hp = race.horses[0].hp;
    // Read HP every engine tick, not the sparse replay frames. The sticky flag
    // also captures an HP-out followed by healing. Include the goal-crossing
    // tick as the engine does for is_hp_empty_on_race.
    for step in 0..30_000 {
        if step % 32 == 0 {
            cancelled(token)?;
        }
        tick::step(&mut race);
        let horse = &race.horses[0];
        if !horse.hp.is_finite() {
            return Err("The race engine produced invalid HP.".into());
        }
        min_hp = min_hp.min(horse.hp);
        if horse.is_finished {
            return Ok((
                !horse.is_hp_empty_on_race && min_hp > 0.0,
                f64::from(min_hp),
            ));
        }
    }
    Err("The race engine exceeded the race time limit.".into())
}

fn run(
    input: Input,
    token: &AtomicBool,
    progress: &(impl Fn(Progress) + Sync),
) -> Result<CheckResult, String> {
    let start = Instant::now();
    cancelled(token)?;
    let engine = engine()?;
    let instance = validate(&input, engine)?;
    cancelled(token)?;
    let values = sweep(input.stats.stamina);
    let total = values.len() * input.seeds;
    let completed = AtomicUsize::new(0);
    let next = AtomicUsize::new(0);
    let base = race_input(&input, instance);
    progress(Progress {
        request_id: input.request_id.clone(),
        completed: 0,
        total,
    });
    let workers = std::thread::available_parallelism()
        .map_or(1, usize::from)
        .min(total);
    let samples = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                scope.spawn(|| {
                    guarded(|| {
                        let mut samples = Vec::new();
                        loop {
                            cancelled(token)?;
                            let index = next.fetch_add(1, Ordering::Relaxed);
                            if index >= total {
                                break;
                            }
                            let point = index / input.seeds;
                            let seed = index % input.seeds;
                            let mut race = base.clone();
                            // Common deterministic seeds across stamina values; opponents
                            // retain the user's original stats throughout the sweep.
                            race.random_seed = ((seed as i32 + 1) * 104_729) ^ 0x005a_17c9;
                            race.horses[0].stamina = values[point];
                            let sample = one_race(&race, &engine.data, token)?;
                            samples.push((index, sample));
                            let count = completed.fetch_add(1, Ordering::Relaxed) + 1;
                            if count.is_multiple_of(10) || count == total {
                                progress(Progress {
                                    request_id: input.request_id.clone(),
                                    completed: count,
                                    total,
                                });
                            }
                        }
                        Ok(samples)
                    })
                })
            })
            .collect();
        let mut all = Vec::with_capacity(total);
        let mut failure = None;
        for handle in handles {
            match handle
                .join()
                .unwrap_or_else(|_| Err("Race worker failed.".into()))
            {
                Ok(samples) => all.extend(samples),
                Err(error) => {
                    failure.get_or_insert(error);
                    token.store(true, Ordering::Relaxed);
                }
            }
        }
        failure.map_or(Ok(all), Err)
    })?;
    cancelled(token)?;
    // Stable summation order makes results independent of worker scheduling.
    let mut samples = samples;
    samples.sort_by_key(|(index, _)| *index);
    let curve: Vec<_> = values
        .into_iter()
        .zip(samples.chunks(input.seeds))
        .map(|(stamina, samples)| Point {
            stamina,
            no_hp_out_percent: 100.0 * samples.iter().filter(|(_, (ok, _))| *ok).count() as f64
                / input.seeds as f64,
            avg_min_hp: samples.iter().map(|(_, (_, hp))| hp).sum::<f64>() / input.seeds as f64,
        })
        .collect();
    let current = curve
        .iter()
        .find(|p| p.stamina == input.stats.stamina)
        .cloned()
        .ok_or("The sweep did not include current stamina.")?;
    let threshold = curve
        .iter()
        .find(|p| p.no_hp_out_percent >= 95.0)
        .map(|p| p.stamina);
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    Ok(CheckResult {
        request_id: input.request_id,
        curve,
        current,
        threshold,
        seeds: input.seeds,
        races: total,
        elapsed_ms,
        ms_per_race: elapsed_ms / total as f64,
        race_instance_id: instance,
    })
}

#[tauri::command]
pub async fn engine_catalog() -> Result<Catalog, String> {
    tauri::async_runtime::spawn_blocking(|| engine().map(|e| e.catalog.clone()))
        .await
        .map_err(|_| "Unable to load engine catalog.".to_string())?
}

#[tauri::command]
pub async fn stamina_check(
    input: Input,
    app: tauri::AppHandle,
    checks: tauri::State<'_, Checks>,
) -> Result<CheckResult, String> {
    let token = checks.begin()?;
    let worker_token = token.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        guarded(|| {
            run(input, &worker_token, &|progress| {
                let _ = app.emit("stamina-progress", progress);
            })
        })
    })
    .await
    .map_err(|_| "Stamina worker failed.".to_string());
    checks.finish(&token);
    result?
}

#[tauri::command]
pub fn cancel_stamina_check(checks: tauri::State<'_, Checks>) -> Result<(), String> {
    checks.cancel()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> Input {
        Input {
            request_id: "test".into(),
            course_set_id: 10506,
            ground_condition: 2,
            weather: 2,
            season: 4,
            running_style: 2,
            stats: Stats {
                speed: 1200,
                stamina: 800,
                pow: 1000,
                guts: 600,
                wiz: 1000,
            },
            motivation: 5,
            distance: [7; 4],
            style: [7; 4],
            ground: [7; 2],
            skills: vec![],
            seeds: 8,
        }
    }

    #[test]
    fn validates_ranges_ids_and_defaults() {
        let engine = engine().unwrap();
        let valid = input();
        assert!(validate(&valid, engine).is_ok());
        let mut cases = Vec::new();
        for (field, bad) in [
            ("course_set_id", 0),
            ("ground_condition", 0),
            ("weather", 5),
            ("season", 6),
            ("running_style", 0),
            ("motivation", 6),
            ("seeds", 0),
            ("seeds", 1001),
        ] {
            let mut value = serde_json::to_value(&valid).unwrap();
            value[field] = bad.into();
            cases.push(serde_json::from_value::<Input>(value).unwrap());
        }
        let mut bad = valid.clone();
        bad.stats.stamina = 299;
        cases.push(bad);
        let mut bad = valid.clone();
        bad.stats.speed = 2001;
        cases.push(bad);
        let mut bad = valid.clone();
        bad.distance[0] = 0;
        cases.push(bad);
        let mut bad = valid.clone();
        bad.style[0] = 9;
        cases.push(bad);
        let mut bad = valid.clone();
        bad.ground[1] = 9;
        cases.push(bad);
        let mut bad = valid.clone();
        bad.skills.push(SelectedSkill { id: -1, level: 1 });
        cases.push(bad);
        let id = *engine.data.skills.keys().min().unwrap();
        let mut bad = valid.clone();
        bad.skills.push(SelectedSkill { id, level: 7 });
        cases.push(bad);
        let mut bad = valid.clone();
        bad.skills = vec![SelectedSkill { id, level: 1 }; 2];
        cases.push(bad);
        for case in cases {
            assert!(validate(&case, engine).is_err(), "{case:?}");
        }
        let mut value = serde_json::to_value(&valid).unwrap();
        value.as_object_mut().unwrap().remove("seeds");
        assert_eq!(serde_json::from_value::<Input>(value).unwrap().seeds, 200);
    }

    #[test]
    fn sweep_includes_exact_current_and_bounds() {
        for stamina in [300, 323, 800, 1599, 1600] {
            let values = sweep(stamina);
            assert_eq!(values.first(), Some(&300));
            assert_eq!(values.last(), Some(&1600));
            assert!(values.contains(&stamina));
            assert!(values.windows(2).all(|w| (1..=50).contains(&(w[1] - w[0]))));
        }
    }

    #[test]
    fn catalog_instances_match_courses_and_names() {
        let engine = engine().unwrap();
        assert_eq!(
            engine.catalog.courses.len(),
            engine.data.master.race_course_set.len()
        );
        assert_eq!(engine.catalog.skills.len(), engine.data.skills.len());
        assert!(!engine.catalog.presets.is_empty());
        for course in &engine.catalog.courses {
            assert!(!course.track_name.starts_with("Track "));
            if let Some(id) = course.race_instance_id {
                let instance = &engine.data.master.race_instance[&id];
                let race = &engine.data.master.race[&instance.race_id];
                assert_eq!(race.course_set, course.id);
                assert_eq!(race.grade, 100);
            } else {
                let mut input = input();
                input.course_set_id = course.id;
                assert!(validate(&input, engine)
                    .unwrap_err()
                    .contains("no valid G1"));
            }
        }
        assert!(engine
            .catalog
            .skills
            .iter()
            .all(|skill| !skill.name.is_empty()));
        let mut input = input();
        input.skills.push(SelectedSkill {
            id: 200331,
            level: 1,
        });
        let instance = validate(&input, engine).unwrap();
        let output = guarded(|| {
            one_race(
                &race_input(&input, instance),
                &engine.data,
                &AtomicBool::new(false),
            )
        })
        .unwrap();
        assert!(output.1.is_finite());
    }

    #[test]
    fn deterministic_curve_and_neutral_field() {
        let input = input();
        let field = race_input(&input, validate(&input, engine().unwrap()).unwrap());
        assert_eq!(field.horses.len(), 9);
        assert!(field.horses.iter().all(|h| h.stamina == 800));
        assert_eq!((field.time, field.race_type), (2, 5));
        let a = run(input.clone(), &AtomicBool::new(false), &|_| {}).unwrap();
        let b = run(input, &AtomicBool::new(false), &|_| {}).unwrap();
        assert_eq!(a.races, 27 * 8);
        assert_eq!(a.current.stamina, 800);
        assert_eq!(a.threshold, b.threshold);
        for (a, b) in a.curve.iter().zip(&b.curve) {
            assert_eq!(a.no_hp_out_percent, b.no_hp_out_percent);
            assert_eq!(a.avg_min_hp, b.avg_min_hp);
            assert!((0.0..=100.0).contains(&a.no_hp_out_percent));
            assert!(a.avg_min_hp.is_finite());
        }
        assert!(a.curve.last().unwrap().no_hp_out_percent >= a.curve[0].no_hp_out_percent);
        assert!(a
            .curve
            .windows(2)
            .all(|w| w[1].no_hp_out_percent + 25.0 >= w[0].no_hp_out_percent));
    }

    #[test]
    fn cancellation_and_replacement_stop_work() {
        let checks = Checks::default();
        let old = checks.begin().unwrap();
        let next = checks.begin().unwrap();
        assert!(cancelled(&old).is_err());
        checks.finish(&old);
        assert!(cancelled(&next).is_ok());
        checks.cancel().unwrap();
        assert!(run(input(), &next, &|_| {}).is_err());
        let token = AtomicBool::new(false);
        let completed = AtomicUsize::new(0);
        let result = run(input(), &token, &|p| {
            completed.store(p.completed, Ordering::Relaxed);
            if p.completed >= 10 {
                token.store(true, Ordering::Relaxed);
            }
        });
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(completed.load(Ordering::Relaxed) < 27 * 8);
    }

    #[test]
    #[ignore = "local performance measurement: 200 seeds across the full sweep"]
    fn benchmark_200_seed_sweep() {
        let mut input = input();
        input.seeds = 200;
        let result = run(input, &AtomicBool::new(false), &|_| {}).unwrap();
        println!("{}", serde_json::to_string(&result).unwrap());
    }
}

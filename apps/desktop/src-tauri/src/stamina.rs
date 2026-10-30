use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
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
    sim::{defs::last_spurt_calc_result, race, tick},
    AnalysisOptions, HorseInput, RaceInput, SkillInput, SkillWizCheck,
};
mod skill_data;

fn engine_data_dir() -> &'static Path {
    Path::new(uma_race_sim::data::DATA_DIR)
}

#[derive(Deserialize)]
struct Names {
    track: HashMap<i32, String>,
    skill: HashMap<i32, Vec<serde_json::Value>>,
}
#[derive(Deserialize)]
struct Pool {
    maps: Vec<PoolMap>,
}
#[derive(Deserialize)]
struct PoolMap {
    id: String,
    track: String,
    distance: i32,
    surface: String,
    direction: String,
    variant: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Course {
    id: String,
    track_name: String,
    distance: i32,
    surface: i32,
    direction: i32,
    variant: Option<String>,
    course_set_id: i32,
    race_instance_id: i32,
    race_id: i32,
    grade: i32,
    time: i32,
    month: i32,
    instance_reason: String,
    unavailable_reason: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Skill {
    id: i32,
    name: String,
    hp_recovery: bool,
    rarity: String,
    icon_path: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Catalog {
    courses: Vec<Course>,
    skills: Vec<Skill>,
    local_skill_data: bool,
}
struct Engine {
    data: GameData,
    catalog: Catalog,
}

fn guarded<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
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
fn inout(variant: Option<&str>) -> Result<i32, String> {
    match variant {
        None => Ok(1),
        Some("Inner") => Ok(2),
        Some("Outer") => Ok(3),
        Some("Outer to Inner") => Ok(4),
        Some(other) => Err(format!("Unknown course variant: {other}")),
    }
}
fn load_engine() -> Result<Engine, String> {
    let data = GameData::load(engine_data_dir(), DataEra::current())?;
    let names: Names = serde_json::from_str(
        &std::fs::read_to_string(engine_data_dir().join("names.json"))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let pool: Pool = serde_json::from_str(include_str!("../data/drafter-map-pool-global.json"))
        .map_err(|e| e.to_string())?;
    let mut courses = Vec::with_capacity(pool.maps.len());
    for map in pool.maps {
        let track_name = if map.track == "Ooi" { "Oi" } else { &map.track };
        let surface = match map.surface.as_str() {
            "Turf" => 1,
            "Dirt" => 2,
            _ => return Err(format!("Unknown surface: {}", map.id)),
        };
        let variant = inout(map.variant.as_deref())?;
        let matches: Vec<_> = data
            .master
            .race_course_set
            .values()
            .filter(|c| {
                names
                    .track
                    .get(&c.race_track_id)
                    .is_some_and(|n| n == track_name)
                    && c.distance == map.distance
                    && c.ground == surface
                    && c.inout == variant
                    && match map.direction.as_str() {
                        "right" => c.turn == 1,
                        "left" => c.turn == 2,
                        "straight" => c.turn == 3 || c.turn == 4,
                        _ => false,
                    }
            })
            .collect();
        if matches.len() != 1 {
            return Err(format!(
                "Pool map {} matched {} engine courses; expected exactly one.",
                map.id,
                matches.len()
            ));
        }
        let c = matches[0];
        // Exact course only. Grade 0 is unspecified, not higher than G1.
        let (instance, race) = data
            .master
            .race_instance
            .values()
            .filter_map(|i| {
                data.master
                    .race
                    .get(&i.race_id)
                    .filter(|r| r.course_set == c.id)
                    .map(|r| (i, r))
            })
            .min_by_key(|(i, r)| (if r.grade == 0 { i32::MAX } else { r.grade }, i.id))
            .ok_or_else(|| {
                format!(
                    "Pool map {} has no race instance on its exact course.",
                    map.id
                )
            })?;
        if !(1..=4).contains(&instance.time) {
            return Err(format!(
                "Pool map {} has invalid instance time {}.",
                map.id, instance.time
            ));
        }
        let path = uma_race_sim::data::course::lane_path_name(
            c.race_track_id,
            c.distance,
            c.ground,
            c.inout,
            0,
        );
        let unavailable_reason = if data.course_event_params.get(&c.id.to_string()).is_none() {
            Some(format!(
                "Engine course geometry missing: courseeventparam {}.",
                c.id
            ))
        } else if data.course_paths.get(&path).is_none() {
            Some(format!("Engine lane path missing: {path}."))
        } else {
            None
        };
        courses.push(Course {
            unavailable_reason,
            id: map.id,
            track_name: map.track,
            distance: c.distance,
            surface,
            direction: c.turn,
            variant: map.variant,
            course_set_id: c.id,
            race_instance_id: instance.id,
            race_id: race.id,
            grade: race.grade,
            time: instance.time,
            month: instance.date / 100,
            instance_reason: if race.grade == 100 {
                "G1 on exact course"
            } else if (200..=300).contains(&race.grade) {
                "No G1; best graded race on exact course"
            } else {
                "No graded race; best available race on exact course"
            }
            .into(),
        });
    }
    let mut skills: Vec<_> = data
        .skills
        .keys()
        .map(|id| Skill {
            id: *id,
            rarity: skill_data::rarity(data.skills[id].rarity).into(),
            icon_path: None,
            hp_recovery: hp_recovery(&data.skills[id]),
            name: names
                .skill
                .get(id)
                .and_then(|r| r.first())
                .and_then(|n| n.as_str())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("Skill {id}")),
        })
        .collect();
    let kits: serde_json::Value =
        serde_json::from_str(include_str!("../data/role-kits.json")).map_err(|e| e.to_string())?;
    for role in ["front", "pace", "late", "end", "runaway"] {
        for id in kits[role].as_array().ok_or("Invalid role kit")? {
            let id = id.as_i64().ok_or("Invalid role skill ID")? as i32;
            if !data.skills.contains_key(&id) {
                return Err(format!("Unknown role kit skill {id}"));
            }
        }
    }
    let local_skill_data = skill_data::enrich(&mut skills);
    skills.sort_by_key(|s| (s.name.clone(), s.id));
    Ok(Engine {
        data,
        catalog: Catalog {
            courses,
            skills,
            local_skill_data,
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
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Build {
    running_style: i32,
    stats: Stats,
    motivation: i32,
    distance: [i32; 4],
    style: [i32; 4],
    ground: [i32; 2],
    #[serde(default)]
    skills: Vec<SelectedSkill>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RaceSelection {
    map_id: String,
    ground_condition: i32,
    weather: i32,
    season: i32,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Field {
    Pacemaker,
    #[default]
    AverageLobby,
    Mirror,
    WeakLobby,
}
fn default_seeds() -> usize {
    256
}
fn seed_count(input: &Input, engine: &Engine) -> usize {
    let base = input.seeds.unwrap_or_else(|| {
        if input
            .build
            .skills
            .iter()
            .any(|s| engine.data.skills.get(&s.id).is_some_and(hp_recovery))
        {
            512
        } else {
            default_seeds()
        }
    });
    base * target_scale(input.target)
}
fn default_target() -> i32 {
    90
}
// Keep roughly the same expected number of failures at the target crossing.
fn target_scale(target: i32) -> usize {
    match target {
        95 => 2,
        99 => 10,
        _ => 1,
    }
}
fn default_true() -> bool {
    true
}
fn hp_recovery(skill: &uma_race_sim::data::SkillData) -> bool {
    skill
        .details
        .iter()
        .flat_map(|d| &d.abilities)
        .any(|a| a.ability_type == 9 && a.float_ability_value > 0)
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    #[serde(default)]
    request_id: String,
    build: Build,
    race: RaceSelection,
    #[serde(default)]
    field: Field,
    #[serde(default)]
    seeds: Option<usize>,
    #[serde(default = "default_target")]
    target: i32,
    #[serde(default = "default_true")]
    assume_skills_activate: bool,
    #[serde(default = "default_true")]
    rushed: bool,
    #[serde(default)]
    spot_struggle: bool,
    #[serde(default)]
    dueling: bool,
    #[serde(default = "default_true")]
    lane_movement: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MultiInput {
    #[serde(default)]
    request_id: String,
    build: Build,
    races: Vec<RaceSelection>,
    #[serde(default)]
    field: Field,
    #[serde(default)]
    seeds: Option<usize>,
    #[serde(default = "default_target")]
    target: i32,
    #[serde(default = "default_true")]
    assume_skills_activate: bool,
    #[serde(default = "default_true")]
    rushed: bool,
    #[serde(default)]
    spot_struggle: bool,
    #[serde(default)]
    dueling: bool,
    #[serde(default = "default_true")]
    lane_movement: bool,
}
fn validate(input: &Input, engine: &Engine) -> Result<Course, String> {
    let range = |name, value, low, high| {
        if (low..=high).contains(&value) {
            Ok(())
        } else {
            Err(format!("{name} must be between {low} and {high}."))
        }
    };
    if input.request_id.len() > 128 {
        return Err("Request ID is too long.".into());
    }
    range("Ground condition", input.race.ground_condition, 1, 4)?;
    range("Weather", input.race.weather, 1, 4)?;
    range("Season", input.race.season, 1, 4)?;
    if ![90, 95, 99].contains(&input.target) {
        return Err("Target must be 90%, 95% or 99%.".into());
    }
    let b = &input.build;
    range("Running style", b.running_style, 1, 4)?;
    range("Motivation", b.motivation, 1, 5)?;
    for (name, value) in [
        ("Speed", b.stats.speed),
        ("Stamina", b.stats.stamina),
        ("Power", b.stats.pow),
        ("Guts", b.stats.guts),
        ("Wit", b.stats.wiz),
    ] {
        range(name, value, 1, 2000)?;
    }
    for grade in b.distance.iter().chain(&b.style).chain(&b.ground) {
        range("Aptitude", *grade, 1, 8)?;
    }
    if input
        .seeds
        .is_some_and(|seeds| !(1..=1000).contains(&seeds))
    {
        return Err("Seeds must be between 1 and 1000.".into());
    }
    if b.skills.len() > 100 {
        return Err("Select at most 100 skills.".into());
    }
    let mut unique = HashSet::new();
    for s in &b.skills {
        if !engine.data.skills.contains_key(&s.id) {
            return Err(format!("Unknown skill ID {}.", s.id));
        }
        if !unique.insert(s.id) {
            return Err(format!("Duplicate skill ID {}.", s.id));
        }
        range("Skill level", s.level, 1, 6)?;
    }
    let course = engine
        .catalog
        .courses
        .iter()
        .find(|c| c.id == input.race.map_id)
        .cloned()
        .ok_or_else(|| "Unknown drafter map ID.".to_string())?;
    if let Some(reason) = &course.unavailable_reason {
        return Err(format!("{}: {reason}", course.id));
    }
    Ok(course)
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
            if active.as_ref().is_some_and(|c| Arc::ptr_eq(c, token)) {
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
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Rates {
    joint_percent: f64,
    survival_percent: f64,
    full_spurt_percent: f64,
    full_spurt_at_entry_percent: f64,
    avg_min_hp: f64,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Point {
    joint_percent: f64,
    seeds: usize,
    stamina: i32,
    survival_percent: f64,
    full_spurt_percent: f64,
    full_spurt_at_entry_percent: f64,
    avg_min_hp: f64,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Thresholds {
    joint: Option<i32>,
    full_spurt: Option<i32>,
    survival: Option<i32>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct EffectiveThresholds {
    joint: Option<f64>,
    full_spurt: Option<f64>,
    survival: Option<f64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SampleCounts {
    seeds: usize,
}
impl From<&Point> for SampleCounts {
    fn from(point: &Point) -> Self {
        Self { seeds: point.seeds }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct ThresholdSamples {
    joint: Option<SampleCounts>,
    full_spurt: Option<SampleCounts>,
    survival: Option<SampleCounts>,
}
#[derive(Clone, Debug, Serialize)]
pub struct HealEquivalent {
    skill_id: i32,
    fraction: f64,
    stamina: f64,
    variable: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct CheckResult {
    input: Input,
    request_id: String,
    curve: Vec<Point>,
    current: Point,
    thresholds: Thresholds,
    threshold_samples: ThresholdSamples,
    needed_effective_stamina: EffectiveThresholds,
    effective_stamina: f64,
    heal_equivalents: Vec<HealEquivalent>,
    seeds: usize,
    races: usize,
    elapsed_ms: f64,
    ms_per_race: f64,
    course: Course,
}
#[derive(Clone, Serialize)]
pub struct Progress {
    request_id: String,
    map_id: String,
    completed: usize,
    total: usize,
    stage: &'static str,
    race_index: usize,
    race_total: usize,
    percent: f64,
}
#[derive(Clone, Serialize)]
pub struct RaceResultEvent {
    request_id: String,
    index: usize,
    total: usize,
    result: CheckResult,
}

fn race_input(input: &Input, course: &Course) -> RaceInput {
    let b = &input.build;
    let build = HorseInput {
        speed: b.stats.speed,
        stamina: b.stats.stamina,
        pow: b.stats.pow,
        guts: b.stats.guts,
        wiz: b.stats.wiz,
        running_style: b.running_style,
        motivation: b.motivation,
        proper_distance: b.distance,
        proper_running_style: b.style,
        proper_ground: b.ground,
        skills: b
            .skills
            .iter()
            .map(|s| SkillInput {
                skill_id: s.id,
                level: s.level,
            })
            .collect(),
        viewer_id: 1,
        rarity: 3,
        popularity: 1,
        frame_order: 1,
        ..Default::default()
    };
    let opponents: &[i32] = match input.field {
        Field::Pacemaker => &[1],
        Field::AverageLobby | Field::Mirror | Field::WeakLobby => &[1, 1, 2, 2, 2, 3, 3, 4],
    };
    let mut horses = vec![build];
    for (i, style) in opponents.iter().enumerate() {
        let pacer = input.field == Field::Pacemaker;
        let stats = match input.field {
            Field::Mirror => b.stats.clone(),
            Field::WeakLobby => Stats {
                speed: 1200,
                stamina: 900,
                pow: 900,
                guts: 500,
                wiz: 900,
            },
            _ => Stats {
                speed: if pacer { 1605 } else { 1600 },
                stamina: 1200,
                pow: if pacer { 1194 } else { 1200 },
                guts: if pacer { 664 } else { 600 },
                wiz: 1200,
            },
        };
        horses.push(HorseInput {
            speed: stats.speed,
            stamina: stats.stamina,
            pow: stats.pow,
            guts: stats.guts,
            wiz: stats.wiz,
            running_style: *style,
            motivation: 5,
            proper_distance: [7; 4],
            proper_running_style: [7; 4],
            proper_ground: [7; 2],
            rarity: 3,
            popularity: i as i32 + 2,
            frame_order: i as i32 + 2,
            ..Default::default()
        });
    }
    RaceInput {
        analysis_options: AnalysisOptions {
            skill_wiz_check: if input.assume_skills_activate {
                SkillWizCheck::AlwaysPass
            } else {
                SkillWizCheck::Normal
            },
            rushed: input.rushed,
            spot_struggle: input.spot_struggle,
            dueling: input.dueling,
            lane_movement: input.lane_movement,
        },
        course_set_id: course.course_set_id,
        ground_condition: input.race.ground_condition,
        weather: input.race.weather,
        season: input.race.season,
        time: course.time,
        race_type: 5,
        race_instance_id: course.race_instance_id,
        horses,
        ..Default::default()
    }
}
#[derive(Clone, Debug)]
struct Sample {
    survival: bool,
    full_spurt: bool,
    entry_full: bool,
    min_hp: f64,
}
fn full_spurt(result: i32) -> bool {
    result == last_spurt_calc_result::TRUE_EXCEED_NEED_MAX_HP
}
fn one_race(input: &RaceInput, data: &GameData, token: &AtomicBool) -> Result<Sample, String> {
    cancelled(token)?;
    let mut race = race::init(input, data);
    tick::start(&mut race);
    // Frames are output-only. Keep all AI, events, spans and RNG behavior.
    race.record_timer = f32::INFINITY;
    let mut min_hp = race.horses[0].hp;
    let mut entry_full = None;
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
        // First decision at late entry, before subsequent heal recalculations.
        if entry_full.is_none() && horse.ai.last_spurt_calc_count > 0 {
            entry_full = Some(full_spurt(horse.ai.last_spurt_calc_result));
        }
        if horse.is_finished {
            return Ok(Sample {
                survival: !horse.is_hp_empty_on_race && min_hp > 0.0,
                full_spurt: full_spurt(horse.ai.last_spurt_calc_result),
                entry_full: entry_full.unwrap_or(false),
                min_hp: f64::from(min_hp),
            });
        }
    }
    Err("The race engine exceeded the race time limit.".into())
}
fn heal_equivalent(stamina: i32, distance: i32, style: i32, fraction: f64) -> f64 {
    let coef = [0.95, 0.89, 1.0, 0.995, 0.86][(style - 1) as usize];
    fraction * (f64::from(stamina) + f64::from(distance) / (0.8 * coef))
}
fn effective_style(build: &Build) -> i32 {
    if build.running_style == 1 && build.skills.iter().any(|s| s.id == 202051) {
        5
    } else {
        build.running_style
    }
}
fn heals(input: &Input, engine: &Engine, distance: i32) -> Vec<HealEquivalent> {
    input
        .build
        .skills
        .iter()
        .filter_map(|s| {
            let skill = &engine.data.skills[&s.id];
            let abilities: Vec<_> = skill
                .details
                .iter()
                .flat_map(|d| &d.abilities)
                .filter(|a| {
                    a.ability_type == 9
                        && a.float_ability_value > 0
                        && [1, 2].contains(&a.target_type)
                })
                .collect();
            if abilities.is_empty() {
                return None;
            }
            let fraction: f64 = abilities
                .iter()
                .map(|a| {
                    f64::from(uma_race_sim::sim::skill::value::apply_level_to_value(
                        &engine.data,
                        s.level,
                        9,
                        a.float_ability_value as f32 / 10_000.0,
                        a.ability_value_level_usage,
                    ))
                })
                .sum();
            Some(HealEquivalent {
                skill_id: s.id,
                fraction,
                stamina: heal_equivalent(
                    input.build.stats.stamina,
                    distance,
                    effective_style(&input.build),
                    fraction,
                ),
                variable: abilities.iter().any(|a| {
                    ![0, 1].contains(&a.ability_value_usage) || a.additional_activate_type != 0
                }),
            })
        })
        .collect()
}
fn seed(index: usize, bank: i32) -> i32 {
    ((index as i32 + 1 + bank * 10_000) * 104_729) ^ 0x005a_17c9
}
struct Solver<'a> {
    input: &'a Input,
    engine: &'a Engine,
    token: &'a AtomicBool,
    progress: &'a (dyn Fn(Progress) + Sync),
    base: RaceInput,
    cache: BTreeMap<i32, Point>,
    samples: BTreeMap<i32, Vec<Sample>>,
    races: usize,
    bank: i32,
    seeds: usize,
}
impl Solver<'_> {
    fn evaluate(
        &mut self,
        values: impl IntoIterator<Item = i32>,
        target: usize,
    ) -> Result<(), String> {
        cancelled(self.token)?;
        let values: Vec<_> = values
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let missing: BTreeMap<usize, Vec<i32>> =
            values
                .into_iter()
                .fold(BTreeMap::new(), |mut groups, stamina| {
                    let count = self.samples.get(&stamina).map_or(0, Vec::len);
                    if count < target {
                        groups.entry(target - count).or_default().push(stamina);
                    }
                    groups
                });
        for (count, values) in missing {
            self.evaluate_batch(values, count)?;
        }
        Ok(())
    }
    fn evaluate_batch(
        &mut self,
        values: impl IntoIterator<Item = i32>,
        seeds: usize,
    ) -> Result<(), String> {
        let values: Vec<_> = values
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter(|_| seeds > 0)
            .collect();
        let jobs: Vec<_> = values
            .iter()
            .flat_map(|s| {
                (self.samples.get(s).map_or(0, Vec::len)
                    ..(self.samples.get(s).map_or(0, Vec::len) + seeds))
                    .map(move |seed| (*s, seed))
            })
            .collect();
        if jobs.is_empty() {
            return Ok(());
        }
        cancelled(self.token)?;
        let total = jobs.len();
        let next = AtomicUsize::new(0);
        let completed = AtomicUsize::new(0);
        let workers = std::thread::available_parallelism()
            .map_or(1, usize::from)
            .min(8)
            .min(total);
        #[cfg(test)]
        let workers = std::env::var("STAMINA_BENCH_WORKERS")
            .ok()
            .map(|s| s.parse::<usize>().expect("worker count"))
            .map_or(workers, |n| n.clamp(1, total));
        let offset = self.races;
        let progress_value = |count: usize| {
            if offset == 0 {
                40.0 * count as f64 / total as f64
            }
            // Adaptive refinement has no known race total. Mark the stage,
            // rather than pretending its expanding work queue is a percentage.
            else {
                65.0
            }
        };
        (self.progress)(Progress {
            request_id: self.input.request_id.clone(),
            race_index: 0,
            race_total: 1,
            map_id: self.input.race.map_id.clone(),
            completed: offset,
            total: offset + total,
            stage: if offset == 0 { "mapping" } else { "refining" },
            percent: progress_value(0),
        });
        let samples = std::thread::scope(|scope| {
            let this = &*self;
            let handles: Vec<_> = (0..workers)
                .map(|_| {
                    let jobs = &jobs;
                    let next = &next;
                    let completed = &completed;
                    scope.spawn(move || {
                        guarded(|| {
                            let mut samples = Vec::new();
                            loop {
                                cancelled(this.token)?;
                                let index = next.fetch_add(1, Ordering::Relaxed);
                                if index >= total {
                                    break;
                                }
                                let (stamina, seed_index) = jobs[index];
                                let mut input = this.base.clone();
                                input.random_seed = seed(seed_index, this.bank);
                                input.horses[0].stamina = stamina;
                                samples.push((
                                    index,
                                    one_race(&input, &this.engine.data, this.token)?,
                                ));
                                let count = completed.fetch_add(1, Ordering::Relaxed) + 1;
                                if count.is_multiple_of(32) || count == total {
                                    (this.progress)(Progress {
                                        request_id: this.input.request_id.clone(),
                                        race_index: 0,
                                        race_total: 1,
                                        map_id: this.input.race.map_id.clone(),
                                        completed: offset + count,
                                        total: offset + total,
                                        stage: if offset == 0 { "mapping" } else { "refining" },
                                        percent: progress_value(count),
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
                        self.token.store(true, Ordering::Relaxed);
                    }
                }
            }
            failure.map_or(Ok(all), Err)
        })?;
        cancelled(self.token)?;
        let mut samples = samples;
        samples.sort_by_key(|(index, _)| *index);
        for (index, sample) in samples {
            self.samples.entry(jobs[index].0).or_default().push(sample);
        }
        for stamina in values {
            self.cache
                .insert(stamina, point(stamina, &self.samples[&stamina]));
        }
        self.races += total;
        Ok(())
    }
    fn threshold(&mut self, metric: fn(&Point) -> f64) -> Result<Option<i32>, String> {
        let seeds = self.seeds;
        // Promote the coarse crossing and the preceding value to the full seed
        // bank; walk either way until the bracket is stable at that sample count.
        let (mut low, mut high) = loop {
            let high = match stable_crossing(&self.cache, metric, self.input.target) {
                Some(high) => high,
                None => {
                    self.evaluate([2000], seeds)?;
                    match stable_crossing(&self.cache, metric, self.input.target) {
                        Some(high) => high,
                        None => return Ok(None),
                    }
                }
            };
            let low = self
                .cache
                .range(..high)
                .rev()
                .find(|(s, _)| **s % 10 == 0)
                .map_or(0, |(s, _)| *s);
            if low == 0 && high > 10 {
                self.evaluate([10], seeds)?;
                continue;
            }
            self.evaluate([low, high].into_iter().filter(|s| *s > 0), seeds)?;
            if stable_crossing(&self.cache, metric, self.input.target) == Some(high) {
                break (low, high);
            }
        };
        while high - low > 10 {
            let middle = ((low + high) / 20) * 10;
            self.evaluate([middle], seeds)?;
            if metric(&self.cache[&middle]) >= f64::from(self.input.target) {
                high = middle;
            } else {
                low = middle;
            }
        }
        Ok(stable_crossing(&self.cache, metric, self.input.target))
    }
    fn solve(&mut self) -> Result<Thresholds, String> {
        let curve_seeds = self.seeds.min(32 * target_scale(self.input.target));
        self.evaluate((600..=1400).step_by(50), curve_seeds)?;
        let thresholds = loop {
            let full_spurt = self.threshold(|p| p.full_spurt_percent)?;
            let survival = self.threshold(|p| p.survival_percent)?;
            let joint = self.threshold(|p| p.joint_percent)?;
            // All metrics share seeds and cached outcomes. A refinement can
            // reveal a dip in an earlier metric; reconcile every crossing.
            if full_spurt
                == stable_crossing(&self.cache, |p| p.full_spurt_percent, self.input.target)
                && survival
                    == stable_crossing(&self.cache, |p| p.survival_percent, self.input.target)
            {
                break Thresholds {
                    joint,
                    full_spurt,
                    survival,
                };
            }
        };
        Ok(thresholds)
    }
}

fn rates(samples: &[Sample]) -> Option<Rates> {
    if samples.is_empty() {
        return None;
    }
    let percent = |test: fn(&Sample) -> bool| {
        100.0 * samples.iter().filter(|s| test(s)).count() as f64 / samples.len() as f64
    };
    Some(Rates {
        joint_percent: percent(|s| s.survival && s.full_spurt),
        survival_percent: percent(|s| s.survival),
        full_spurt_percent: percent(|s| s.full_spurt),
        full_spurt_at_entry_percent: percent(|s| s.entry_full),
        avg_min_hp: samples.iter().map(|s| s.min_hp).sum::<f64>() / samples.len() as f64,
    })
}
fn point(stamina: i32, samples: &[Sample]) -> Point {
    let rates = rates(samples).unwrap_or_default();
    Point {
        joint_percent: rates.joint_percent,
        stamina,
        seeds: samples.len(),
        survival_percent: rates.survival_percent,
        full_spurt_percent: rates.full_spurt_percent,
        full_spurt_at_entry_percent: rates.full_spurt_at_entry_percent,
        avg_min_hp: rates.avg_min_hp,
    }
}
fn effective_thresholds(
    thresholds: &Thresholds,
    equivalents: &[HealEquivalent],
    distance: i32,
    style: i32,
) -> EffectiveThresholds {
    let fraction = equivalents.iter().map(|h| h.fraction).sum::<f64>();
    let effective =
        |stamina| f64::from(stamina) + heal_equivalent(stamina, distance, style, fraction);
    EffectiveThresholds {
        joint: thresholds.joint.map(effective),
        full_spurt: thresholds.full_spurt.map(effective),
        survival: thresholds.survival.map(effective),
    }
}

fn stable_crossing(
    points: &BTreeMap<i32, Point>,
    metric: fn(&Point) -> f64,
    target: i32,
) -> Option<i32> {
    let mut minimum = 100.0_f64;
    let mut crossing = None;
    for (stamina, point) in points.iter().rev().filter(|(s, _)| **s % 10 == 0) {
        minimum = minimum.min(metric(point));
        if minimum >= f64::from(target) {
            crossing = Some(*stamina);
        }
    }
    crossing
}
fn run(
    input: Input,
    token: &AtomicBool,
    progress: &(impl Fn(Progress) + Sync),
) -> Result<CheckResult, String> {
    run_bank(input, token, progress, 0)
}
fn run_bank(
    input: Input,
    token: &AtomicBool,
    progress: &(impl Fn(Progress) + Sync),
    bank: i32,
) -> Result<CheckResult, String> {
    let start = Instant::now();
    cancelled(token)?;
    let engine = engine()?;
    let course = validate(&input, engine)?;
    let seeds = seed_count(&input, engine);
    let equivalents = heals(&input, engine, course.distance);
    let mut solver = Solver {
        input: &input,
        engine,
        token,
        progress,
        base: race_input(&input, &course),
        cache: BTreeMap::new(),
        samples: BTreeMap::new(),
        races: 0,
        bank,
        seeds,
    };
    let thresholds = solver.solve()?;
    let threshold_samples = ThresholdSamples {
        joint: thresholds
            .joint
            .map(|s| SampleCounts::from(&solver.cache[&s])),
        full_spurt: thresholds
            .full_spurt
            .map(|s| SampleCounts::from(&solver.cache[&s])),
        survival: thresholds
            .survival
            .map(|s| SampleCounts::from(&solver.cache[&s])),
    };
    let curve = (600..=1400)
        .step_by(50)
        .map(|s| solver.cache[&s].clone())
        .collect();
    // Snapshot the curve before promoting current stamina, so changing only the
    // displayed current value cannot change the curve or threshold search.
    solver.evaluate([input.build.stats.stamina], seeds)?;
    let current = solver.cache[&input.build.stats.stamina].clone();
    let races = solver.races;
    let needed_effective_stamina = effective_thresholds(
        &thresholds,
        &equivalents,
        course.distance,
        effective_style(&input.build),
    );
    cancelled(token)?;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    progress(Progress {
        race_index: 0,
        race_total: 1,
        request_id: input.request_id.clone(),
        map_id: input.race.map_id.clone(),
        completed: races,
        total: races,
        stage: "done",
        percent: 100.0,
    });
    Ok(CheckResult {
        request_id: input.request_id.clone(),
        curve,
        current,
        thresholds,
        threshold_samples,
        needed_effective_stamina,
        effective_stamina: f64::from(input.build.stats.stamina)
            + equivalents.iter().map(|h| h.stamina).sum::<f64>(),
        heal_equivalents: equivalents,
        seeds,
        races,
        elapsed_ms,
        ms_per_race: elapsed_ms / races as f64,
        course,
        input,
    })
}
fn batch_inputs(input: MultiInput, engine: &Engine) -> Result<Vec<Input>, String> {
    if input.races.is_empty() || input.races.len() > 7 {
        return Err("Select between 1 and 7 races.".into());
    }
    let inputs: Vec<_> = input
        .races
        .into_iter()
        .map(|race| Input {
            request_id: input.request_id.clone(),
            build: input.build.clone(),
            race,
            field: input.field,
            seeds: input.seeds,
            target: input.target,
            assume_skills_activate: input.assume_skills_activate,
            rushed: input.rushed,
            spot_struggle: input.spot_struggle,
            dueling: input.dueling,
            lane_movement: input.lane_movement,
        })
        .collect();
    // Validate everything before emitting any per-race result.
    for input in &inputs {
        validate(input, engine)?;
    }
    Ok(inputs)
}
fn run_races(
    input: MultiInput,
    token: &AtomicBool,
    progress: &(impl Fn(Progress) + Sync),
    result: &impl Fn(RaceResultEvent),
) -> Result<Vec<CheckResult>, String> {
    cancelled(token)?;
    let inputs = batch_inputs(input, engine()?)?;
    let total = inputs.len();
    let mut results = Vec::with_capacity(total);
    for (index, input) in inputs.into_iter().enumerate() {
        cancelled(token)?;
        let completed = run(input, token, &|mut p| {
            p.race_index = index;
            p.race_total = total;
            p.percent = (index as f64 * 100.0 + p.percent) / total as f64;
            progress(p);
        })?;
        result(RaceResultEvent {
            request_id: completed.request_id.clone(),
            index,
            total,
            result: completed.clone(),
        });
        results.push(completed);
    }
    Ok(results)
}
#[tauri::command]
pub async fn engine_catalog(app: tauri::AppHandle) -> Result<Catalog, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let catalog = engine()?.catalog.clone();
        for skill in &catalog.skills {
            if let Some(path) = &skill.icon_path {
                app.asset_protocol_scope()
                    .allow_file(path)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(catalog)
    })
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
            run(input, &worker_token, &|p| {
                let _ = app.emit("stamina-progress", p);
            })
        })
    })
    .await
    .map_err(|_| "Stamina worker failed.".to_string());
    checks.finish(&token);
    result?
}
#[tauri::command]
pub async fn stamina_check_races(
    input: MultiInput,
    app: tauri::AppHandle,
    checks: tauri::State<'_, Checks>,
) -> Result<Vec<CheckResult>, String> {
    let token = checks.begin()?;
    let worker_token = token.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        guarded(|| {
            run_races(
                input,
                &worker_token,
                &|p| {
                    let _ = app.emit("stamina-progress", p);
                },
                &|r| {
                    let _ = app.emit("stamina-race-result", r);
                },
            )
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
mod tests;

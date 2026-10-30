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
    HorseInput, RaceInput, SkillInput,
};

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
}
#[derive(Clone, Serialize)]
pub struct Catalog {
    courses: Vec<Course>,
    skills: Vec<Skill>,
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
    skills.sort_by_key(|s| (s.name.clone(), s.id));
    Ok(Engine {
        data,
        catalog: Catalog { courses, skills },
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
}
fn default_seeds() -> usize {
    256
}
fn seed_count(input: &Input, engine: &Engine) -> usize {
    input.seeds.unwrap_or_else(|| {
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
    })
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
    #[serde(default = "default_true")]
    assume_heals_activate: bool,
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
    #[serde(default = "default_true")]
    assume_heals_activate: bool,
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
    survival_percent: f64,
    full_spurt_percent: f64,
    full_spurt_at_entry_percent: f64,
    avg_min_hp: f64,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Point {
    // All attempted seeds, including failed heal lotteries.
    seeds: usize,
    conditional_samples: usize,
    stamina: i32,
    survival_percent: f64,
    full_spurt_percent: f64,
    full_spurt_at_entry_percent: f64,
    avg_min_hp: f64,
    unconditional: Rates,
    conditional: Option<Rates>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Thresholds {
    full_spurt: Option<i32>,
    survival: Option<i32>,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct EffectiveThresholds {
    full_spurt: Option<f64>,
    survival: Option<f64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SampleCounts {
    conditional: usize,
    attempted: usize,
}
impl From<&Point> for SampleCounts {
    fn from(point: &Point) -> Self {
        Self {
            conditional: point.conditional_samples,
            attempted: point.seeds,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct ThresholdSamples {
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
        Field::AverageLobby => &[1, 1, 2, 2, 2, 3, 3, 4],
    };
    let mut horses = vec![build];
    for (i, style) in opponents.iter().enumerate() {
        let pacer = input.field == Field::Pacemaker;
        horses.push(HorseInput {
            speed: if pacer { 1605 } else { 1600 },
            stamina: 1200,
            pow: if pacer { 1194 } else { 1200 },
            guts: if pacer { 664 } else { 600 },
            wiz: 1200,
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
    heals_passed: bool,
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
    // Only the pre-race lot writes this enable flag. Do not inspect whether a
    // skill actually triggers: position/condition failures remain real outcomes.
    let heals_passed = race.horses[0]
        .skill_manager
        .skills
        .iter()
        .filter(|skill| hp_recovery(&skill.skill_master))
        .all(|skill| skill.is_activate_enable);
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
                heals_passed,
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
    let coef = [0.95, 0.89, 1.0, 0.995][(style - 1) as usize];
    fraction * (f64::from(stamina) + f64::from(distance) / (0.8 * coef))
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
                    input.build.running_style,
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
        let values: Vec<_> = values
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        loop {
            cancelled(self.token)?;
            let mut groups: BTreeMap<usize, Vec<i32>> = BTreeMap::new();
            for stamina in &values {
                let samples = self.samples.get(stamina).map_or(&[][..], Vec::as_slice);
                let eligible = if self.input.assume_heals_activate {
                    samples.iter().filter(|s| s.heals_passed).count()
                } else {
                    samples.len()
                };
                if eligible >= target {
                    continue;
                }
                if samples.len() >= MAX_POINT_SEEDS {
                    return Err(format!("Could not collect {target} qualifying samples at {stamina} stamina after {MAX_POINT_SEEDS} seeds ({eligible} qualified)."));
                }
                // Missing eligible samples are an upper bound on new successes:
                // no overshoot, no worker-dependent stopping or dropped outcomes.
                groups.entry(target - eligible).or_default().push(*stamina);
            }
            if groups.is_empty() {
                return Ok(());
            }
            for (missing, points) in groups {
                self.evaluate_batch(points, missing)?;
            }
        }
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
                    ..(self.samples.get(s).map_or(0, Vec::len) + seeds).min(MAX_POINT_SEEDS))
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
        let offset = self.races;
        (self.progress)(Progress {
            request_id: self.input.request_id.clone(),
            map_id: self.input.race.map_id.clone(),
            completed: offset,
            total: offset + total,
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
                                        map_id: this.input.race.map_id.clone(),
                                        completed: offset + count,
                                        total: offset + total,
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
            self.cache.insert(
                stamina,
                point(
                    stamina,
                    &self.samples[&stamina],
                    self.input.assume_heals_activate,
                ),
            );
        }
        self.races += total;
        Ok(())
    }
    fn threshold(&mut self, metric: fn(&Point) -> f64) -> Result<Option<i32>, String> {
        let seeds = self.seeds;
        // Promote the coarse crossing and the preceding value to the full seed
        // bank; walk either way until the bracket is stable at that sample count.
        let (mut low, mut high) = loop {
            let high = match stable_crossing(&self.cache, metric) {
                Some(high) => high,
                None => {
                    self.evaluate([2000], seeds)?;
                    match stable_crossing(&self.cache, metric) {
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
            if stable_crossing(&self.cache, metric) == Some(high) {
                break (low, high);
            }
        };
        while high - low > 10 {
            let middle = ((low + high) / 20) * 10;
            self.evaluate([middle], seeds)?;
            if metric(&self.cache[&middle]) >= 90.0 {
                high = middle;
            } else {
                low = middle;
            }
        }
        Ok(stable_crossing(&self.cache, metric))
    }
    fn solve(&mut self) -> Result<Thresholds, String> {
        let curve_seeds = self.seeds.min(32);
        self.evaluate((600..=1400).step_by(50), curve_seeds)?;
        let thresholds = loop {
            let full_spurt = self.threshold(|p| p.full_spurt_percent)?;
            let survival = self.threshold(|p| p.survival_percent)?;
            // Refining one metric can reveal a dip in the other; reconcile both.
            if full_spurt == stable_crossing(&self.cache, |p| p.full_spurt_percent) {
                break Thresholds {
                    full_spurt,
                    survival,
                };
            }
        };
        Ok(thresholds)
    }
}

const MAX_POINT_SEEDS: usize = 10_000;

fn rates(samples: &[&Sample]) -> Option<Rates> {
    if samples.is_empty() {
        return None;
    }
    let percent = |test: fn(&Sample) -> bool| {
        100.0 * samples.iter().filter(|s| test(s)).count() as f64 / samples.len() as f64
    };
    Some(Rates {
        survival_percent: percent(|s| s.survival),
        full_spurt_percent: percent(|s| s.full_spurt),
        full_spurt_at_entry_percent: percent(|s| s.entry_full),
        avg_min_hp: samples.iter().map(|s| s.min_hp).sum::<f64>() / samples.len() as f64,
    })
}
fn point(stamina: i32, samples: &[Sample], assume_heals_activate: bool) -> Point {
    let all: Vec<_> = samples.iter().collect();
    let passing: Vec<_> = samples.iter().filter(|s| s.heals_passed).collect();
    let unconditional = rates(&all).unwrap_or_default();
    let conditional = rates(&passing);
    let headline = if assume_heals_activate {
        conditional.clone().unwrap_or_default()
    } else {
        unconditional.clone()
    };
    Point {
        stamina,
        seeds: samples.len(),
        conditional_samples: passing.len(),
        survival_percent: headline.survival_percent,
        full_spurt_percent: headline.full_spurt_percent,
        full_spurt_at_entry_percent: headline.full_spurt_at_entry_percent,
        avg_min_hp: headline.avg_min_hp,
        unconditional,
        conditional,
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
        full_spurt: thresholds.full_spurt.map(effective),
        survival: thresholds.survival.map(effective),
    }
}

fn stable_crossing(points: &BTreeMap<i32, Point>, metric: fn(&Point) -> f64) -> Option<i32> {
    let mut minimum = 100.0_f64;
    let mut crossing = None;
    for (stamina, point) in points.iter().rev().filter(|(s, _)| **s % 10 == 0) {
        minimum = minimum.min(metric(point));
        if minimum >= 90.0 {
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
        input.build.running_style,
    );
    cancelled(token)?;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
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
            assume_heals_activate: input.assume_heals_activate,
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
        let completed = run(input, token, progress)?;
        cancelled(token)?;
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

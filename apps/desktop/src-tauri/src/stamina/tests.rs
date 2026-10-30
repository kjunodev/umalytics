use super::*;

#[test]
fn bundled_role_kits_only_reference_catalog_skills() {
    let e = engine().unwrap();
    let kits: serde_json::Value =
        serde_json::from_str(include_str!("../../data/role-kits.json")).unwrap();
    let mut count = 0;
    for role in ["front", "pace", "late", "end", "runaway"] {
        let mut seen = HashSet::new();
        for id in kits[role].as_array().unwrap() {
            let id = id.as_i64().unwrap() as i32;
            assert!(seen.insert(id), "Duplicate {id} in {role}");
            let skill = e
                .catalog
                .skills
                .iter()
                .find(|s| s.id == id)
                .unwrap_or_else(|| panic!("Unknown {role} skill {id}"));
            assert_ne!(skill.rarity, "unique", "User unique in kit {role}: {id}");
            assert!(!skill.hp_recovery, "Heal in kit {role}: {id}");
            count += 1;
        }
    }
    assert_eq!(count, 69);
}

#[test]
fn catalog_includes_upgrades_and_scenario_skills_without_region_flags() {
    let e = engine().unwrap();
    for id in [201241, 210052, 202051] {
        let skill = e.catalog.skills.iter().find(|s| s.id == id).unwrap();
        let payload = serde_json::to_value(skill).unwrap();
        assert!(payload.get("global").is_none());
        let mut i = input();
        i.build.skills.push(SelectedSkill { id, level: 1 });
        assert!(validate(&i, e).is_ok());
    }
}

#[test]
fn runaway_is_front_with_skill_and_changes_engine_behavior() {
    use uma_race_sim::sim::defs::RunningStyleEx;
    let e = engine().unwrap();
    let mut i = input();
    i.build.running_style = 1;
    let c = validate(&i, e).unwrap();
    let front_input = race_input(&i, &c);
    let mut front = race::init(&front_input, &e.data);
    tick::start(&mut front);
    i.build.skills.push(SelectedSkill {
        id: 202051,
        level: 1,
    });
    let runaway_input = race_input(&i, &c);
    let mut runaway = race::init(&runaway_input, &e.data);
    tick::start(&mut runaway);
    assert_eq!(
        front.horses[0].horse_data.running_style_ex,
        RunningStyleEx::None
    );
    assert_eq!(
        runaway.horses[0].horse_data.running_style_ex,
        RunningStyleEx::Oonige
    );
    assert!(runaway.horses[0].max_hp < front.horses[0].max_hp);
    for _ in 0..300 {
        tick::step(&mut front);
        tick::step(&mut runaway);
    }
    assert_ne!(front.horses[0].distance, runaway.horses[0].distance);
    assert_eq!(effective_style(&i.build), 5);
    assert!(heal_equivalent(800, 2500, 5, 0.055) > heal_equivalent(800, 2500, 1, 0.055));
}

#[test]
fn targets_reject_100_and_scale_sampling_without_changing_90() {
    let e = engine().unwrap();
    let mut i = input();
    i.seeds = None;
    for (target, samples) in [(90, 256), (95, 512), (99, 2560)] {
        i.target = target;
        assert!(validate(&i, e).is_ok());
        assert_eq!(seed_count(&i, e), samples);
        i.build.skills = vec![SelectedSkill {
            id: 200351,
            level: 1,
        }];
        assert_eq!(seed_count(&i, e), samples * 2);
        i.build.skills.clear();
    }
    for target in [0, 89, 91, 100] {
        i.target = target;
        assert!(validate(&i, e).is_err());
    }
    let p = Point {
        joint_percent: 95.0,
        survival_percent: 99.0,
        full_spurt_percent: 95.0,
        full_spurt_at_entry_percent: 95.0,
        avg_min_hp: 1.0,
        seeds: 100,
        stamina: 1000,
    };
    let points = BTreeMap::from([(1000, p)]);
    assert_eq!(
        stable_crossing(&points, |p| p.joint_percent, 95),
        Some(1000)
    );
    assert_eq!(stable_crossing(&points, |p| p.joint_percent, 99), None);
}

#[test]
#[ignore = "local target stability measurement; two seed banks at each target"]
fn measure_targets() {
    for (map, style, heal) in [
        ("kyoto-3000-turf-outer", 4, true),
        ("hanshin-3200-turf-outer-to-inner", 1, false),
    ] {
        for target in [90, 95, 99] {
            for bank in [0, 1] {
                let mut i = input();
                i.seeds = None;
                i.field = Field::AverageLobby;
                i.target = target;
                i.race.map_id = map.into();
                i.build.running_style = style;
                i.build.stats.speed = 1600;
                i.build.stats.pow = 1200;
                i.build.stats.wiz = 1200;
                if heal {
                    i.build.skills.push(SelectedSkill {
                        id: 200351,
                        level: 1,
                    });
                }
                let r = run_bank(i, &AtomicBool::new(false), &|_| {}, bank).unwrap();
                println!(
                    "TARGET_MEASUREMENT {}",
                    serde_json::json!({"map":map,"target":target,"bank":bank,"thresholds":r.thresholds,"effective":r.needed_effective_stamina,"seeds":r.seeds,"races":r.races,"ms":r.elapsed_ms})
                );
            }
        }
    }
}
fn input() -> Input {
    Input {
        request_id: "test".into(),
        race: RaceSelection {
            map_id: "nakayama-2500-turf-inner".into(),
            ground_condition: 2,
            weather: 2,
            season: 4,
        },
        build: Build {
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
        },
        field: Field::Pacemaker,
        seeds: Some(8),
        target: 90,
        assume_skills_activate: true,
        rushed: true,
        spot_struggle: false,
        dueling: false,
        lane_movement: true,
    }
}
#[test]
fn pool_maps_all_104_exact_courses_and_instances() {
    let e = engine().unwrap();
    assert_eq!(e.catalog.courses.len(), 104);
    let mut ids = HashSet::new();
    for c in &e.catalog.courses {
        assert!(ids.insert(&c.id));
        let cs = &e.data.master.race_course_set[&c.course_set_id];
        assert_eq!(
            (cs.distance, cs.ground, cs.turn, cs.inout),
            (
                c.distance,
                c.surface,
                c.direction,
                inout(c.variant.as_deref()).unwrap()
            )
        );
        let instance = &e.data.master.race_instance[&c.race_instance_id];
        let race = &e.data.master.race[&instance.race_id];
        assert_eq!(race.course_set, c.course_set_id);
        assert_eq!(instance.time, c.time);
        assert_eq!(instance.date / 100, c.month);
        let mut i = input();
        i.race.map_id = c.id.clone();
        assert!(c.unavailable_reason.is_none(), "{}", c.id);
        let sample = one_race(&race_input(&i, c), &e.data, &AtomicBool::new(false)).unwrap();
        assert!(sample.min_hp.is_finite(), "{}", c.id);
    }
    assert_eq!(
        e.catalog.courses.iter().filter(|c| c.grade == 100).count(),
        99
    );
    assert_eq!(inout(Some("Outer to Inner")).unwrap(), 4);
    assert_eq!(
        e.catalog
            .courses
            .iter()
            .filter(|c| c.unavailable_reason.is_some())
            .count(),
        0
    );
}
#[test]
fn fallback_instances_are_explicit_and_on_course() {
    let e = engine().unwrap();
    let expected = [
        ("niigata-1200-dirt", 407601, 400),
        ("fukushima-1150-dirt", 903940, 800),
        ("nakayama-1200-dirt", 306901, 300),
        ("tokyo-1300-dirt", 902430, 800),
        ("funabashi-2400-dirt", 204001, 200),
    ];
    for (id, instance, grade) in expected {
        let c = e.catalog.courses.iter().find(|c| c.id == id).unwrap();
        assert_eq!((c.race_instance_id, c.grade), (instance, grade));
        assert!(c.instance_reason.starts_with("No "));
        assert!(!e
            .data
            .master
            .race
            .values()
            .any(|r| r.course_set == c.course_set_id && r.grade == 100));
    }
    assert_eq!(
        e.catalog
            .courses
            .iter()
            .find(|c| c.id == "funabashi-2400-dirt")
            .unwrap()
            .time,
        4
    );
}
#[test]
fn validates_conditions_build_ids_and_defaults() {
    let e = engine().unwrap();
    let i = input();
    assert!(validate(&i, e).is_ok());
    for (group, key, bad) in [
        ("race", "ground_condition", 0),
        ("race", "ground_condition", 5),
        ("race", "weather", 5),
        ("race", "season", 5),
        ("build", "running_style", 0),
        ("build", "motivation", 6),
    ] {
        let mut v = serde_json::to_value(&i).unwrap();
        v[group][key] = bad.into();
        assert!(validate(&serde_json::from_value(v).unwrap(), e).is_err());
    }
    for bad in [0, 2001] {
        let mut b = i.clone();
        b.build.stats.stamina = bad;
        assert!(validate(&b, e).is_err());
        let mut b = i.clone();
        b.build.stats.speed = bad;
        assert!(validate(&b, e).is_err());
    }
    for bad in [0, 9] {
        let mut b = i.clone();
        b.build.distance[0] = bad;
        assert!(validate(&b, e).is_err());
    }
    for bad in [0, 1001] {
        let mut b = i.clone();
        b.seeds = Some(bad);
        assert!(validate(&b, e).is_err());
    }
    let mut b = i.clone();
    b.race.map_id = "not-a-map".into();
    assert!(validate(&b, e).is_err());
    let mut b = i.clone();
    b.build.skills = vec![SelectedSkill { id: -1, level: 1 }];
    assert!(validate(&b, e).is_err());
    let mut b = i.clone();
    b.build.skills = vec![
        SelectedSkill {
            id: 200351,
            level: 1
        };
        2
    ];
    assert!(validate(&b, e).is_err());
    let mut b = i.clone();
    b.build.skills = vec![SelectedSkill {
        id: 200351,
        level: 7,
    }];
    assert!(validate(&b, e).is_err());
    let mut v = serde_json::to_value(&i).unwrap();
    v.as_object_mut().unwrap().remove("seeds");
    v.as_object_mut().unwrap().remove("field");
    for key in [
        "assume_skills_activate",
        "rushed",
        "spot_struggle",
        "dueling",
        "lane_movement",
    ] {
        v.as_object_mut().unwrap().remove(key);
    }
    let decoded: Input = serde_json::from_value(v).unwrap();
    assert_eq!(decoded.seeds, None);
    assert_eq!(seed_count(&decoded, e), 256);
    let mut healing = decoded.clone();
    healing.build.skills.push(SelectedSkill {
        id: 200351,
        level: 1,
    });
    assert_eq!(seed_count(&healing, e), 512);
    assert!(decoded.assume_skills_activate);
    assert!(decoded.rushed && decoded.lane_movement);
    assert!(!decoded.spot_struggle && !decoded.dueling);
    assert_eq!(decoded.field, Field::AverageLobby);
    let course = validate(&decoded, e).unwrap();
    let field = race_input(&decoded, &course);
    assert_eq!(field.horses.len(), 9);
    assert_eq!(race::init(&field, &e.data).info.num_race_horses, 9);
    let multi: MultiInput = serde_json::from_value(
        serde_json::json!({ "build": decoded.build, "races": [decoded.race] }),
    )
    .unwrap();
    assert_eq!(multi.field, Field::AverageLobby);
    assert!(multi.assume_skills_activate && multi.rushed && multi.lane_movement);
    assert!(!multi.spot_struggle && !multi.dueling);
}
#[test]
fn ground_weather_season_pass_through_exactly() {
    let e = engine().unwrap();
    for ground in 1..=4 {
        let mut i = input();
        i.race.ground_condition = ground;
        i.race.weather = ground;
        i.race.season = ground;
        let c = validate(&i, e).unwrap();
        let r = race_input(&i, &c);
        assert_eq!(
            (r.ground_condition, r.weather, r.season, r.time),
            (ground, ground, ground, c.time)
        );
        let race = race::init(&r, &e.data);
        assert_eq!(race.info.ground_condition, ground);
    }
}
#[test]
fn fields_match_requested_stats_and_skill_ownership() {
    let mut i = input();
    i.build.skills.push(SelectedSkill {
        id: 200351,
        level: 1,
    });
    let c = validate(&i, engine().unwrap()).unwrap();
    let p = race_input(&i, &c);
    assert_eq!(p.horses.len(), 2);
    let h = &p.horses[1];
    assert_eq!(
        (h.speed, h.stamina, h.pow, h.guts, h.wiz, h.running_style),
        (1605, 1200, 1194, 664, 1200, 1)
    );
    assert_eq!(
        race::init(&p, &engine().unwrap().data).info.num_race_horses,
        2
    );
    i.field = Field::AverageLobby;
    let lobby = race_input(&i, &c);
    assert_eq!(lobby.horses.len(), 9);
    assert_eq!(
        lobby.horses[1..]
            .iter()
            .map(|h| h.running_style)
            .collect::<Vec<_>>(),
        vec![1, 1, 2, 2, 2, 3, 3, 4]
    );
    for h in &lobby.horses[1..] {
        assert_eq!(
            (h.speed, h.stamina, h.pow, h.guts, h.wiz),
            (1600, 1200, 1200, 600, 1200)
        );
        assert!(h.skills.is_empty());
        assert_eq!(h.proper_distance, [7; 4]);
        assert_eq!(h.proper_running_style, [7; 4]);
        assert_eq!(h.proper_ground, [7; 2]);
        assert_eq!(h.motivation, 5);
    }
    assert_eq!(lobby.horses[0].skills.len(), 1);
}
#[test]
fn effective_stamina_known_numbers_and_engine_heals() {
    for (d, f, expected) in [
        (2000, 0.015, 54.0),
        (2000, 0.055, 200.0),
        (3000, 0.015, 74.0),
        (3000, 0.055, 272.0),
    ] {
        assert_eq!(heal_equivalent(1000, d, 1, f).round(), expected);
    }
    let e = engine().unwrap();
    let mut i = input();
    i.build.skills.push(SelectedSkill {
        id: 200351,
        level: 1,
    });
    i.build.skills.push(SelectedSkill {
        id: 200331,
        level: 1,
    });
    let h = heals(&i, e, 2500);
    assert_eq!(h.len(), 1);
    assert!(h[0].fraction > 0.0);
    let r = run(i, &AtomicBool::new(false), &|_| {}).unwrap();
    assert!(r.effective_stamina > 800.0);
    assert_eq!(
        r.needed_effective_stamina,
        effective_thresholds(
            &r.thresholds,
            &r.heal_equivalents,
            r.course.distance,
            r.input.build.running_style
        )
    );
    assert_eq!(r.current.seeds, r.seeds);
}
#[test]
fn full_spurt_fixture_and_recording_do_not_change_result() {
    let e = engine().unwrap();
    let i = input();
    let c = validate(&i, e).unwrap();
    assert!(!full_spurt(last_spurt_calc_result::TRUE));
    assert!(!full_spurt(last_spurt_calc_result::FALSE));
    assert!(full_spurt(last_spurt_calc_result::TRUE_EXCEED_NEED_MAX_HP));
    for stamina in [10, 2000] {
        let mut r = race_input(&i, &c);
        r.horses[0].stamina = stamina;
        r.random_seed = seed(0, 0);
        let actual = one_race(&r, &e.data, &AtomicBool::new(false)).unwrap();
        let mut race = race::init(&r, &e.data);
        tick::start(&mut race);
        while !race.horses[0].is_finished {
            tick::step(&mut race);
        }
        let h = &race.horses[0];
        assert_eq!(actual.full_spurt, full_spurt(h.ai.last_spurt_calc_result));
        assert_eq!(actual.min_hp, f64::from(h.hp));
        assert_eq!(actual.full_spurt, stamina == 2000);
        assert_eq!(actual.entry_full, actual.full_spurt);
        assert_eq!(actual.survival, !h.is_hp_empty_on_race);
    }
}
#[test]
fn late_heal_can_upgrade_finish_plan_without_changing_entry() {
    let e = engine().unwrap();
    let mut data = GameData::load(engine_data_dir(), DataEra::current()).unwrap();
    // Synthetic unconditional late heal, using the real engine's ability path.
    let mut skill = data.skills[&200351].clone();
    skill.id = 999990;
    skill.activate_lot = 0;
    skill.details[0].precondition.clear();
    skill.details[0].condition = "phase>=2&distance_rate>=75".into();
    for ability in &mut skill.details[0].abilities {
        if ability.ability_type == 9 {
            ability.float_ability_value = 9000;
        }
    }
    data.skills.insert(skill.id, skill);
    let mut i = input();
    i.build.stats.stamina = 600;
    i.build.skills.push(SelectedSkill {
        id: 999990,
        level: 1,
    });
    let c = &e
        .catalog
        .courses
        .iter()
        .find(|c| c.id == i.race.map_id)
        .unwrap();
    let mut found = false;
    for seed_index in 0..8 {
        let mut r = race_input(&i, c);
        r.random_seed = seed(seed_index, 0);
        let sample = one_race(&r, &data, &AtomicBool::new(false)).unwrap();
        found |= !sample.entry_full && sample.full_spurt;
    }
    assert!(found, "late heal should upgrade the retained plan");
}
#[test]
fn stable_crossing_rejects_isolated_lucky_crossings() {
    let mut points = BTreeMap::new();
    for (s, rate) in [
        (600, 85.0),
        (650, 95.0),
        (700, 87.5),
        (750, 92.0),
        (800, 100.0),
    ] {
        points.insert(
            s,
            Point {
                joint_percent: rate,
                stamina: s,
                seeds: 8,
                survival_percent: rate,
                full_spurt_percent: rate,
                full_spurt_at_entry_percent: rate,
                avg_min_hp: 0.0,
            },
        );
    }
    assert_eq!(
        stable_crossing(&points, |p| p.survival_percent, 90),
        Some(750)
    );
    // Raising the required rate cannot lower the crossing.
    let mut prior = 0;
    for target in 80..=100 {
        let adjusted = |p: &Point| p.survival_percent - f64::from(target) + 90.0;
        // Equivalent reverse scan, checking monotonicity of the lower envelope.
        let mut minimum = 100.0_f64;
        let mut crossing = None;
        for (s, p) in points.iter().rev() {
            minimum = minimum.min(adjusted(p));
            if minimum >= 90.0 {
                crossing = Some(*s);
            }
        }
        if let Some(s) = crossing {
            assert!(s >= prior);
            prior = s;
        }
    }
}
#[test]
fn deterministic_curve_threshold_resolution_and_current_independence() {
    let i = input();
    let a = run(i.clone(), &AtomicBool::new(false), &|_| {}).unwrap();
    let b = run(i.clone(), &AtomicBool::new(false), &|_| {}).unwrap();
    assert_eq!(a.curve, b.curve);
    assert_eq!(a.current, b.current);
    assert_eq!(a.thresholds, b.thresholds);
    assert_eq!(a.races, b.races);
    assert_eq!(a.curve.len(), 17);
    assert_eq!(a.curve[0].stamina, 600);
    assert_eq!(a.curve[16].stamina, 1400);
    for t in [
        a.thresholds.joint,
        a.thresholds.full_spurt,
        a.thresholds.survival,
    ]
    .into_iter()
    .flatten()
    {
        assert_eq!(t % 10, 0);
    }
    assert_eq!(
        a.needed_effective_stamina,
        effective_thresholds(
            &a.thresholds,
            &[],
            a.course.distance,
            a.input.build.running_style
        )
    );
    assert_eq!(a.current.seeds, a.seeds);
    let mut offgrid = i;
    offgrid.build.stats.stamina = 825;
    let c = run(offgrid, &AtomicBool::new(false), &|_| {}).unwrap();
    assert_eq!(a.thresholds, c.thresholds);
    assert_eq!(c.current.stamina, 825);
    assert_eq!(a.curve, c.curve);
}
#[test]
fn adaptive_promotion_reuses_seeds_and_brackets_at_full_precision() {
    let mut i = input();
    i.seeds = Some(64);
    let e = engine().unwrap();
    let c = validate(&i, e).unwrap();
    let token = AtomicBool::new(false);
    let make = || Solver {
        input: &i,
        engine: e,
        token: &token,
        progress: &|_| {},
        base: race_input(&i, &c),
        cache: BTreeMap::new(),
        samples: BTreeMap::new(),
        races: 0,
        bank: 0,
        seeds: 64,
    };
    let mut incremental = make();
    incremental.evaluate([800], 32).unwrap();
    incremental.evaluate([800], 64).unwrap();
    assert_eq!(incremental.races, 64);
    let mut direct = make();
    direct.evaluate([800], 64).unwrap();
    assert_eq!(incremental.cache, direct.cache);
    let thresholds = incremental.solve().unwrap();
    for t in [thresholds.joint, thresholds.full_spurt, thresholds.survival]
        .into_iter()
        .flatten()
    {
        assert_eq!(incremental.cache[&t].seeds, 64);
        assert_eq!(t % 10, 0);
    }
    assert!(incremental.races < incremental.cache.len() * 64);
}

#[test]
fn cancellation_and_request_replacement() {
    let checks = Checks::default();
    let old = checks.begin().unwrap();
    let next = checks.begin().unwrap();
    assert!(cancelled(&old).is_err());
    checks.finish(&old);
    assert!(cancelled(&next).is_ok());
    checks.cancel().unwrap();
    assert!(run(input(), &next, &|_| {}).is_err());
    let token = AtomicBool::new(false);
    let result = run(input(), &token, &|p| {
        if p.completed >= 32 {
            token.store(true, Ordering::Relaxed);
        }
    });
    assert!(result.unwrap_err().contains("cancelled"));
}
#[test]
fn multi_race_validation_events_and_cancellation() {
    let i = input();
    let make = |races| MultiInput {
        request_id: i.request_id.clone(),
        build: i.build.clone(),
        races,
        field: i.field,
        seeds: Some(1),
        target: 90,
        assume_skills_activate: i.assume_skills_activate,
        rushed: i.rushed,
        spot_struggle: i.spot_struggle,
        dueling: i.dueling,
        lane_movement: i.lane_movement,
    };
    assert!(batch_inputs(make(vec![]), engine().unwrap()).is_err());
    assert!(batch_inputs(make(vec![i.race.clone(); 8]), engine().unwrap()).is_err());
    assert_eq!(
        batch_inputs(make(vec![i.race.clone(); 7]), engine().unwrap())
            .unwrap()
            .len(),
        7
    );
    let mut bad = i.race.clone();
    bad.season = 5;
    let events = Mutex::new(Vec::new());
    assert!(run_races(
        make(vec![i.race.clone(), bad]),
        &AtomicBool::new(false),
        &|_| {},
        &|r| events.lock().unwrap().push(r)
    )
    .is_err());
    assert!(events.lock().unwrap().is_empty());
    let result = run_races(
        make(vec![i.race.clone(); 2]),
        &AtomicBool::new(false),
        &|_| {},
        &|r| events.lock().unwrap().push(r),
    )
    .unwrap();
    assert_eq!(result.len(), 2);
    let events = events.lock().unwrap();
    for (index, e) in events.iter().enumerate() {
        assert_eq!(e.index, index);
        assert_eq!(e.total, 2);
        assert_eq!(e.request_id, "test");
        assert_eq!(e.result.curve, result[index].curve);
    }
    let token = AtomicBool::new(false);
    let count = AtomicUsize::new(0);
    assert!(
        run_races(make(vec![i.race.clone(); 2]), &token, &|_| {}, &|_| {
            count.fetch_add(1, Ordering::Relaxed);
            token.store(true, Ordering::Relaxed);
        })
        .is_err()
    );
    assert_eq!(count.load(Ordering::Relaxed), 1);

    // Cancellation after the completed-race progress event must retain that
    // race's result, even when it arrives before the result event is emitted.
    let token = AtomicBool::new(false);
    let count = AtomicUsize::new(0);
    assert!(run_races(
        make(vec![i.race.clone(); 2]),
        &token,
        &|p| {
            if p.stage == "done" {
                token.store(true, Ordering::Relaxed);
            }
        },
        &|_| {
            count.fetch_add(1, Ordering::Relaxed);
        },
    )
    .is_err());
    assert_eq!(count.load(Ordering::Relaxed), 1);
}
#[test]
#[ignore = "local solver timing and independent seed bank audit"]
fn benchmark_seed_banks() {
    engine().unwrap();
    let counts: Vec<usize> = std::env::var("STAMINA_BENCH_SEEDS")
        .unwrap_or_else(|_| "0".into())
        .split(',')
        .map(|s| s.parse().unwrap())
        .collect();
    let mut comparisons = Vec::new();
    for seeds in counts {
        for (map, style, field, skills) in [
            ("tokyo-1600-turf", 1, Field::Pacemaker, vec![]),
            ("morioka-2000-dirt", 2, Field::AverageLobby, vec![]),
            ("tokyo-2000-turf", 2, Field::Pacemaker, vec![]),
            ("nakayama-2500-turf-inner", 2, Field::Pacemaker, vec![]),
            (
                "kyoto-3000-turf-outer",
                4,
                Field::Pacemaker,
                vec![SelectedSkill {
                    id: 200351,
                    level: 1,
                }],
            ),
            (
                "hanshin-3200-turf-outer-to-inner",
                1,
                Field::Pacemaker,
                vec![],
            ),
            ("fukushima-1150-dirt", 3, Field::AverageLobby, vec![]),
            (
                "tokyo-2400-turf",
                3,
                Field::AverageLobby,
                vec![SelectedSkill {
                    id: 200351,
                    level: 1,
                }],
            ),
        ] {
            if std::env::var("STAMINA_BENCH_MAP").is_ok_and(|selected| selected != map) {
                continue;
            }
            let mut i = input();
            i.seeds = if seeds == 0 { None } else { Some(seeds) };
            i.race.map_id = map.into();
            i.build.running_style = style;
            i.field = match std::env::var("STAMINA_BENCH_FIELD").as_deref() {
                Ok("average_lobby") => Field::AverageLobby,
                Ok("pacemaker") => Field::Pacemaker,
                Err(_) => field,
                Ok(other) => panic!("Unknown benchmark field {other}"),
            };
            let field = i.field;
            i.build.skills = skills;
            i.build.stats.speed = 1600;
            i.build.stats.pow = 1200;
            i.build.stats.wiz = 1200;
            let seeds = seed_count(&i, engine().unwrap());
            let a = run_bank(i.clone(), &AtomicBool::new(false), &|_| {}, 0).unwrap();
            let b = run_bank(i, &AtomicBool::new(false), &|_| {}, 1).unwrap();
            let counts = |r: &CheckResult| {
                serde_json::json!({
                    "current": r.current.seeds,
                    "thresholds": r.threshold_samples,
                    "curve": r.curve.iter().map(|p| serde_json::json!({"stamina": p.stamina, "samples": p.seeds})).collect::<Vec<_>>(),
                })
            };
            println!(
                "FIXTURE {map} {field:?} seeds={seeds} a={:?} b={:?} current={}/{} ms={:.0}/{:.0}",
                a.thresholds,
                b.thresholds,
                a.current.seeds,
                b.current.seeds,
                a.elapsed_ms,
                b.elapsed_ms
            );
            comparisons.push(serde_json::json!({ "map": map, "field": field, "seeds": seeds, "a": a.thresholds, "b": b.thresholds,
                "needed_a": a.needed_effective_stamina, "needed_b": b.needed_effective_stamina,
                "counts_a": counts(&a), "counts_b": counts(&b), "current_a": a.current, "current_b": b.current,
                "ms_a": a.elapsed_ms, "ms_b": b.elapsed_ms, "races_a": a.races, "races_b": b.races }));
        }
    }
    println!("BENCHMARK {}", serde_json::to_string(&comparisons).unwrap());
}
#[test]
#[ignore = "local per-map instance audit"]
fn mapping_report() {
    println!(
        "MAPPING {}",
        serde_json::to_string(&engine().unwrap().catalog.courses).unwrap()
    );
}

#[test]
fn rates_include_every_simulated_outcome() {
    let samples = [
        Sample {
            survival: true,
            full_spurt: true,
            entry_full: false,
            min_hp: 100.0,
        },
        Sample {
            survival: false,
            full_spurt: false,
            entry_full: false,
            min_hp: 0.0,
        },
        Sample {
            survival: true,
            full_spurt: false,
            entry_full: false,
            min_hp: 50.0,
        },
    ];
    let point = point(800, &samples);
    assert_eq!(point.seeds, 3);
    assert_eq!(point.full_spurt_percent, 100.0 / 3.0);
    assert_eq!(point.survival_percent, 200.0 / 3.0);
    assert_eq!(point.avg_min_hp, 50.0);
}

#[test]
fn options_reach_engine_and_all_skills_pass_wit_only() {
    let e = engine().unwrap();
    let mut i = input();
    i.build.stats.wiz = 1;
    i.build.skills = vec![
        SelectedSkill {
            id: 200351,
            level: 1,
        },
        SelectedSkill {
            id: 200331,
            level: 1,
        },
    ];
    let c = validate(&i, e).unwrap();
    let mut failures = 0;
    for index in 0..32 {
        for enabled in [true, false] {
            i.assume_skills_activate = enabled;
            i.rushed = enabled;
            i.spot_struggle = !enabled;
            i.dueling = !enabled;
            i.lane_movement = enabled;
            let mut r = race_input(&i, &c);
            assert_eq!(
                r.analysis_options,
                AnalysisOptions {
                    skill_wiz_check: if enabled {
                        SkillWizCheck::AlwaysPass
                    } else {
                        SkillWizCheck::Normal
                    },
                    rushed: enabled,
                    spot_struggle: !enabled,
                    dueling: !enabled,
                    lane_movement: enabled
                }
            );
            r.random_seed = seed(index, 0);
            let mut race = race::init(&r, &e.data);
            tick::start(&mut race);
            let all = race.horses[0]
                .skill_manager
                .skills
                .iter()
                .all(|s| s.is_activate_enable);
            if enabled {
                assert!(all);
            } else {
                failures += usize::from(!all);
            }
        }
    }
    assert!(failures > 0);
}

#[test]
fn always_pass_keeps_impossible_position_conditions_in_the_rates() {
    let e = engine().unwrap();
    let mut data = GameData::load(engine_data_dir(), DataEra::current()).unwrap();
    let mut skill = data.skills[&200351].clone();
    skill.id = 999991;
    skill.details[0].condition = "running_style==4".into();
    data.skills.insert(skill.id, skill);
    let mut i = input();
    i.build.stats.stamina = 10;
    i.build.skills = vec![SelectedSkill {
        id: 999991,
        level: 1,
    }];
    let c = validate(&input(), e).unwrap();
    let r = race_input(&i, &c);
    let mut race = race::init(&r, &data);
    tick::start(&mut race);
    assert!(race.horses[0].skill_manager.skills[0].is_activate_enable);
    while !race.horses[0].is_finished {
        tick::step(&mut race);
    }
    assert_eq!(
        race.horses[0]
            .activate_skill_count_by_phase
            .iter()
            .sum::<i32>(),
        0
    );
    let sample = one_race(&r, &data, &AtomicBool::new(false)).unwrap();
    let p = point(10, &[sample]);
    assert_eq!(p.seeds, 1);
    assert_eq!(p.full_spurt_percent, 0.0);
}

#[test]
fn every_seed_counts_with_assumption_on_or_off_and_current_uses_full_bank() {
    let mut i = input();
    i.seeds = Some(64);
    i.build.skills = vec![SelectedSkill {
        id: 200351,
        level: 1,
    }];
    let token = AtomicBool::new(false);
    for enabled in [true, false] {
        i.assume_skills_activate = enabled;
        let r = run(i.clone(), &token, &|_| {}).unwrap();
        let repeat = run(i.clone(), &token, &|_| {}).unwrap();
        assert_eq!(r.current, repeat.current);
        assert_eq!(r.thresholds, repeat.thresholds);
        assert_eq!(r.races, repeat.races);
        assert_eq!(r.current.seeds, 64);
        for counts in [r.threshold_samples.full_spurt, r.threshold_samples.survival]
            .into_iter()
            .flatten()
        {
            assert_eq!(counts.seeds, 64);
        }
        assert!(r.races <= 64 * 35);
    }
}

#[test]
fn effective_needs_use_each_true_threshold_without_a_second_solve() {
    let equivalent = HealEquivalent {
        skill_id: 1,
        fraction: 0.055,
        stamina: 9999.0,
        variable: false,
    };
    let needed = effective_thresholds(
        &Thresholds {
            joint: Some(1200),
            full_spurt: Some(1000),
            survival: Some(1200),
        },
        &[equivalent],
        2000,
        1,
    );
    assert_eq!(needed.full_spurt.unwrap().round(), 1200.0);
    assert_eq!(needed.survival.unwrap().round(), 1411.0);
    let empty = effective_thresholds(
        &Thresholds {
            joint: None,
            full_spurt: None,
            survival: Some(1000),
        },
        &[],
        3000,
        4,
    );
    assert_eq!(
        empty,
        EffectiveThresholds {
            joint: None,
            full_spurt: None,
            survival: Some(1000.0)
        }
    );
}

#[test]
fn seed_banks_remain_disjoint() {
    let a: HashSet<_> = (0..1000).map(|i| seed(i, 0)).collect();
    assert_eq!(a.len(), 1000);
    assert!((0..1000).all(|i| !a.contains(&seed(i, 1))));
}

#[test]
fn joint_counts_the_intersection_not_two_marginal_passes() {
    let samples: Vec<_> = (0..100)
        .map(|n| Sample {
            survival: n >= 10,
            full_spurt: n < 90,
            entry_full: true,
            min_hp: 0.0,
        })
        .collect();
    let p = point(800, &samples);
    assert_eq!(p.full_spurt_percent, 90.0);
    assert_eq!(p.survival_percent, 90.0);
    assert_eq!(p.joint_percent, 80.0);
}

#[test]
fn mirror_is_fixed_to_submitted_stats_and_has_no_opponent_skills() {
    let mut i = input();
    i.field = Field::Mirror;
    i.build.distance = [8; 4];
    i.build.motivation = 2;
    i.build.skills = vec![SelectedSkill {
        id: 200351,
        level: 1,
    }];
    let c = validate(&i, engine().unwrap()).unwrap();
    let mut race = race_input(&i, &c);
    race.horses[0].stamina = 1500;
    assert_eq!(race.horses.len(), 9);
    assert_eq!(
        race.horses[1..]
            .iter()
            .map(|h| h.running_style)
            .collect::<Vec<_>>(),
        [1, 1, 2, 2, 2, 3, 3, 4]
    );
    for h in &race.horses[1..] {
        assert_eq!(
            (h.speed, h.stamina, h.pow, h.guts, h.wiz),
            (1200, 800, 1000, 600, 1000)
        );
        assert_eq!(h.motivation, 5);
        assert_eq!(h.proper_distance, [7; 4]);
        assert_eq!(h.proper_running_style, [7; 4]);
        assert_eq!(h.proper_ground, [7; 2]);
        assert!(h.skills.is_empty());
    }
    i.field = Field::WeakLobby;
    let weak = race_input(&i, &c);
    let h = &weak.horses[1];
    assert_eq!(
        (h.speed, h.stamina, h.pow, h.guts, h.wiz),
        (1200, 900, 900, 500, 900)
    );
}

#[test]
fn progress_reports_stages_and_bounded_work_without_a_growing_denominator() {
    let events = Mutex::new(Vec::new());
    let result = run(input(), &AtomicBool::new(false), &|p| {
        events.lock().unwrap().push(p)
    })
    .unwrap();
    let events = events.lock().unwrap();
    assert_eq!(events.first().unwrap().stage, "mapping");
    assert!(events.iter().any(|p| p.stage == "refining"));
    assert!(events.iter().all(|p| (0.0..=100.0).contains(&p.percent)));
    assert_eq!(events.last().unwrap().stage, "done");
    assert_eq!(events.last().unwrap().percent, 100.0);
    assert_eq!(events.last().unwrap().completed, result.races);
    assert!(result.thresholds.joint >= result.thresholds.full_spurt);
    assert!(result.thresholds.joint >= result.thresholds.survival);
}

#[test]
#[ignore = "local field-strength measurement; seven round-1 fixtures"]
fn measure_field_strength() {
    for (map, style, heal) in [
        ("tokyo-1600-turf", 1, false),
        ("morioka-2000-dirt", 2, false),
        ("tokyo-2000-turf", 2, false),
        ("nakayama-2500-turf-inner", 2, false),
        ("kyoto-3000-turf-outer", 4, true),
        ("hanshin-3200-turf-outer-to-inner", 1, false),
        ("fukushima-1150-dirt", 3, false),
    ] {
        for field in [Field::AverageLobby, Field::Mirror, Field::WeakLobby] {
            let mut i = input();
            i.seeds = None;
            i.race.map_id = map.into();
            i.build.running_style = style;
            i.build.stats.speed = 1600;
            i.build.stats.pow = 1200;
            i.build.stats.wiz = 1200;
            i.field = field;
            if heal {
                i.build.skills.push(SelectedSkill {
                    id: 200351,
                    level: 1,
                });
            }
            let r = run(i, &AtomicBool::new(false), &|_| {}).unwrap();
            println!(
                "FIELD_MEASUREMENT {}",
                serde_json::json!({"map":map,"style":style,"field":field,"thresholds":r.thresholds,
                "effective":r.needed_effective_stamina,"seeds":r.seeds,"samples":r.threshold_samples,"races":r.races,"ms":r.elapsed_ms})
            );
        }
    }
}

#[test]
fn real_lobby_allows_order_five_conditions_while_two_runners_cannot() {
    let e = engine().unwrap();
    let mut data = GameData::load(engine_data_dir(), DataEra::current()).unwrap();
    let mut skill = data.skills[&200351].clone();
    skill.id = 999992;
    skill.activate_lot = 0;
    skill.details[0].precondition.clear();
    skill.details[0].condition = "order>=5".into();
    data.skills.insert(skill.id, skill);
    let mut i = input();
    i.build.running_style = 4;
    i.build.skills = vec![SelectedSkill {
        id: 999992,
        level: 1,
    }];
    let c = validate(&input(), e).unwrap();
    for (field, should_activate) in [(Field::AverageLobby, true), (Field::Pacemaker, false)] {
        i.field = field;
        let r = race_input(&i, &c);
        let mut race = race::init(&r, &data);
        tick::start(&mut race);
        while !race.horses[0].is_finished {
            tick::step(&mut race);
        }
        assert_eq!(
            race.horses[0]
                .activate_skill_count_by_phase
                .iter()
                .sum::<i32>()
                > 0,
            should_activate
        );
    }
}

use super::*;
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
        assume_heals_activate: true,
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
        if c.unavailable_reason.is_some() {
            assert_eq!(c.id, "morioka-2000-dirt");
            assert!(validate(&i, e).unwrap_err().contains("geometry missing"));
            continue;
        }
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
        1
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
    v.as_object_mut().unwrap().remove("assume_heals_activate");
    let decoded: Input = serde_json::from_value(v).unwrap();
    assert_eq!(decoded.seeds, None);
    assert_eq!(seed_count(&decoded, e), 256);
    let mut healing = decoded.clone();
    healing.build.skills.push(SelectedSkill {
        id: 200351,
        level: 1,
    });
    assert_eq!(seed_count(&healing, e), 512);
    assert!(decoded.assume_heals_activate);
    assert_eq!(decoded.field, Field::Pacemaker);
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
    assert_eq!(r.current.conditional_samples, r.seeds);
    assert!(r.current.seeds >= r.seeds);
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
                stamina: s,
                seeds: 8,
                conditional_samples: 8,
                unconditional: Rates::default(),
                conditional: None,
                survival_percent: rate,
                full_spurt_percent: rate,
                full_spurt_at_entry_percent: rate,
                avg_min_hp: 0.0,
            },
        );
    }
    assert_eq!(stable_crossing(&points, |p| p.survival_percent), Some(750));
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
    for t in [a.thresholds.full_spurt, a.thresholds.survival]
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
    for t in [thresholds.full_spurt, thresholds.survival]
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
        assume_heals_activate: i.assume_heals_activate,
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
            i.field = field;
            i.build.skills = skills;
            i.build.stats.speed = 1600;
            i.build.stats.pow = 1200;
            i.build.stats.wiz = 1200;
            let seeds = seed_count(&i, engine().unwrap());
            let a = run_bank(i.clone(), &AtomicBool::new(false), &|_| {}, 0).unwrap();
            let b = run_bank(i, &AtomicBool::new(false), &|_| {}, 1).unwrap();
            let counts = |r: &CheckResult| {
                serde_json::json!({
                    "current": r.current.conditional_samples,
                    "thresholds": r.threshold_samples,
                    "curve": r.curve.iter().map(|p| serde_json::json!({"stamina": p.stamina, "conditional": p.conditional_samples, "attempts": p.seeds})).collect::<Vec<_>>(),
                })
            };
            println!(
                "FIXTURE {map} {field:?} seeds={seeds} a={:?} b={:?} current={}/{} ms={:.0}/{:.0}",
                a.thresholds,
                b.thresholds,
                a.current.conditional_samples,
                b.current.conditional_samples,
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
fn conditional_rates_keep_lottery_and_condition_failures_distinct() {
    let samples = vec![
        Sample {
            heals_passed: true,
            survival: true,
            full_spurt: true,
            entry_full: true,
            min_hp: 100.0,
        },
        Sample {
            heals_passed: false,
            survival: false,
            full_spurt: false,
            entry_full: false,
            min_hp: 0.0,
        },
        Sample {
            heals_passed: true,
            survival: false,
            full_spurt: false,
            entry_full: false,
            min_hp: 0.0,
        },
    ];
    let on = point(800, &samples, true);
    assert_eq!((on.seeds, on.conditional_samples), (3, 2));
    assert_eq!(on.full_spurt_percent, 50.0);
    assert_eq!(on.unconditional.full_spurt_percent, 100.0 / 3.0);
    let off = point(800, &samples, false);
    assert_eq!(off.full_spurt_percent, off.unconditional.full_spurt_percent);
    assert_eq!(off.conditional, on.conditional);
}

#[test]
fn real_lottery_flags_require_every_heal_and_ignore_non_heals() {
    let e = engine().unwrap();
    let mut i = input();
    i.build.skills = vec![
        SelectedSkill {
            id: 200351,
            level: 1,
        },
        SelectedSkill {
            id: 200381,
            level: 1,
        },
    ];
    let c = validate(&i, e).unwrap();
    let mut saw_pass = false;
    let mut saw_failure = false;
    for index in 0..32 {
        let mut r = race_input(&i, &c);
        r.random_seed = seed(index, 0);
        let mut race = race::init(&r, &e.data);
        tick::start(&mut race);
        let expected = race.horses[0]
            .skill_manager
            .skills
            .iter()
            .all(|s| s.is_activate_enable);
        let sample = one_race(&r, &e.data, &AtomicBool::new(false)).unwrap();
        assert_eq!(sample.heals_passed, expected);
        saw_pass |= expected;
        saw_failure |= !expected;
    }
    assert!(saw_pass && saw_failure);
    i.build.skills = vec![SelectedSkill {
        id: 200331,
        level: 1,
    }];
    let mut saw_non_heal_failure = false;
    for index in 0..64 {
        let mut r = race_input(&i, &c);
        r.random_seed = seed(index, 0);
        let mut race = race::init(&r, &e.data);
        tick::start(&mut race);
        if !race.horses[0].skill_manager.skills[0].is_activate_enable {
            assert!(
                one_race(&r, &e.data, &AtomicBool::new(false))
                    .unwrap()
                    .heals_passed
            );
            saw_non_heal_failure = true;
            break;
        }
    }
    assert!(saw_non_heal_failure);
}

#[test]
fn lottery_success_does_not_force_a_condition_to_activate() {
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
    let c = e
        .catalog
        .courses
        .iter()
        .find(|c| c.id == i.race.map_id)
        .unwrap();
    for index in 0..32 {
        let mut r = race_input(&i, c);
        r.random_seed = seed(index, 0);
        let mut race = race::init(&r, &data);
        tick::start(&mut race);
        if !race.horses[0].skill_manager.skills[0].is_activate_enable {
            continue;
        }
        let sample = one_race(&r, &data, &AtomicBool::new(false)).unwrap();
        while !race.horses[0].is_finished {
            tick::step(&mut race);
        }
        assert!(sample.heals_passed);
        assert_eq!(
            race.horses[0]
                .activate_skill_count_by_phase
                .iter()
                .sum::<i32>(),
            0
        );
        assert!(!sample.full_spurt);
        return;
    }
    panic!("fixture needs a passing lottery");
}

#[test]
fn topups_fill_the_conditional_bank_and_current_uses_it() {
    let mut i = input();
    i.seeds = Some(64);
    i.build.skills = vec![SelectedSkill {
        id: 200351,
        level: 1,
    }];
    let e = engine().unwrap();
    let c = validate(&i, e).unwrap();
    let token = AtomicBool::new(false);
    let mut solver = Solver {
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
    solver.evaluate([800, 900], 64).unwrap();
    for p in solver.cache.values() {
        assert_eq!(p.conditional_samples, 64);
        assert!(p.seeds > 64);
    }
    assert_eq!(
        solver.samples[&800]
            .iter()
            .map(|s| s.heals_passed)
            .collect::<Vec<_>>(),
        solver.samples[&900]
            .iter()
            .map(|s| s.heals_passed)
            .collect::<Vec<_>>()
    );
    i.build.stats.stamina = 825;
    let r = run(i.clone(), &token, &|_| {}).unwrap();
    let repeat = run(i.clone(), &token, &|_| {}).unwrap();
    assert_eq!(r.thresholds, repeat.thresholds);
    assert_eq!(r.curve, repeat.curve);
    assert_eq!(r.current, repeat.current);
    assert_eq!(r.races, repeat.races);
    assert_eq!(r.current.conditional_samples, 64);
    assert!(r.current.seeds > 64);
    assert_eq!(
        r.threshold_samples.full_spurt.as_ref().unwrap().conditional,
        64
    );
    assert_eq!(
        r.threshold_samples.survival.as_ref().unwrap().conditional,
        64
    );
    assert_eq!(
        r.current.full_spurt_percent,
        r.current.conditional.as_ref().unwrap().full_spurt_percent
    );
    assert!(r.races < 64 * 35);
    i.assume_heals_activate = false;
    let off = run(i, &token, &|_| {}).unwrap();
    assert_eq!(off.current.seeds, 64);
    assert_eq!(
        off.current.full_spurt_percent,
        off.current.unconditional.full_spurt_percent
    );
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
            full_spurt: None,
            survival: Some(1000.0)
        }
    );
}

#[test]
fn topups_are_bounded_and_seed_banks_remain_disjoint() {
    let i = input();
    let e = engine().unwrap();
    let c = validate(&i, e).unwrap();
    let token = AtomicBool::new(false);
    let mut solver = Solver {
        input: &i,
        engine: e,
        token: &token,
        progress: &|_| {},
        base: race_input(&i, &c),
        cache: BTreeMap::new(),
        samples: BTreeMap::new(),
        races: 0,
        bank: 0,
        seeds: 8,
    };
    solver.samples.insert(
        800,
        vec![
            Sample {
                heals_passed: false,
                survival: false,
                full_spurt: false,
                entry_full: false,
                min_hp: 0.0
            };
            MAX_POINT_SEEDS
        ],
    );
    assert!(solver
        .evaluate([800], 8)
        .unwrap_err()
        .contains("Could not collect"));
    let a: HashSet<_> = (0..MAX_POINT_SEEDS).map(|i| seed(i, 0)).collect();
    assert_eq!(a.len(), MAX_POINT_SEEDS);
    assert!((0..MAX_POINT_SEEDS).all(|i| !a.contains(&seed(i, 1))));
}

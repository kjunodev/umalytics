use super::image::{Image, Rect, Rgb, Word};
use serde::{Deserialize, Serialize};
use std::ops::Range;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Screen {
    AttributesNumbers,
    AttributesChart,
    CareerSkills,
    DetailsSkills,
    FinishedDetails,
    Learn,
    Unsupported,
}

#[derive(Debug)]
pub(super) struct Layout {
    pub screen: Screen,
    pub panel: Rect,
    pub header: Option<Rect>,
    pub rows: Vec<Rect>,
}

pub(super) fn label<'a>(words: &'a [Word], name: &str) -> impl Iterator<Item = Rect> + 'a {
    let name = name.to_owned();
    words
        .iter()
        .filter_map(move |word| word.text.eq_ignore_ascii_case(&name).then_some(word.bounds))
}

pub(super) fn runs(range: Range<i32>, mut present: impl FnMut(i32) -> bool) -> Vec<Range<i32>> {
    let mut spans = Vec::new();
    let mut start = None;
    let end = range.end;
    for position in range {
        if present(position) {
            start.get_or_insert(position);
        } else if let Some(start) = start.take() {
            spans.push(start..position);
        }
    }
    if let Some(start) = start {
        spans.push(start..end);
    }
    spans
}

fn length(span: &Range<i32>) -> i32 {
    span.end - span.start
}

fn join_gaps(spans: Vec<Range<i32>>, gap: i32) -> Vec<Range<i32>> {
    let mut joined: Vec<Range<i32>> = Vec::new();
    for span in spans {
        if let Some(last) = joined
            .last_mut()
            .filter(|last| span.start - last.end <= gap)
        {
            last.end = span.end;
        } else {
            joined.push(span);
        }
    }
    joined
}

fn green([r, g, b]: Rgb) -> bool {
    r >= 65 && g >= 150 && g.saturating_sub(r) >= 32 && b < 70
}

// The Career Profile banner scales with the game UI, even when the OS title bar
// and capture margins do not. Its rounded, wide green band is visible behind popups.
pub(super) fn profile_banner(image: &Image) -> Option<Rect> {
    let is_banner = |[r, g, b]: Rgb| g >= 146 && g.saturating_sub(r) >= 23 && b < 135;
    let (band, y) = (0..image.height / 6)
        .flat_map(|y| {
            // White lettering can interrupt the green span inside the banner.
            join_gaps(
                runs(image.width / 3..image.width, |x| is_banner(image.at(x, y))),
                image.width / 34,
            )
            .into_iter()
            .map(move |band| (band, y))
        })
        .filter(|(band, _)| length(band) >= image.width / 5 && length(band) <= image.width / 2)
        .max_by_key(|(band, _)| length(band))?;
    let width = length(&band);
    let probe = band.start + width / 7;
    let vertical = runs(y - width / 7..y + width / 7, |y| {
        is_banner(image.at(probe, y))
    })
    .into_iter()
    .find(|span| span.contains(&y))?;
    (width / 18..width / 8)
        .contains(&length(&vertical))
        .then(|| Rect::new(band.start, vertical.start, band.end, vertical.end))
}

fn button_green([r, g, b]: Rgb) -> bool {
    r >= 30 && g >= 68 && g.saturating_sub(r) >= 10 && b < 65
}

pub(super) fn brown_ink([r, g, b]: Rgb) -> u8 {
    let opacity = (r.saturating_sub(g).saturating_sub(9) as u16 * 9)
        .min(g.saturating_sub(b).saturating_sub(3) as u16 * 14)
        .min(230_u8.saturating_sub(r) as u16 * 3);
    255 - opacity.min(255) as u8
}

pub(super) fn faint_brown_ink([r, g, b]: Rgb) -> u8 {
    let opacity = (r.saturating_sub(g).saturating_sub(5) as u16 * 15)
        .min(g.saturating_sub(b).saturating_sub(2) as u16 * 20)
        .min(240_u8.saturating_sub(r) as u16 * 6);
    255 - opacity.min(255) as u8
}

pub(super) fn blue_channel_ink([_, _, b]: Rgb) -> u8 {
    b.saturating_sub(65).saturating_mul(3)
}

pub(super) fn white_ink([r, g, b]: Rgb) -> u8 {
    (255 - r.min(g).min(b)).saturating_mul(3)
}

fn scrollbar(
    image: &Image,
    x: Range<i32>,
    y: Range<i32>,
    min_height: i32,
) -> Option<(i32, Range<i32>)> {
    x.flat_map(|x| {
        runs(y.clone(), |y| {
            let [r, g, b] = image.at(x, y);
            (113..=227).contains(&r)
                && r.abs_diff(g) <= 5
                && (5..=22).contains(&b.saturating_sub(r))
        })
        .into_iter()
        .map(move |span| (x, span))
    })
    .filter(|(_, span)| length(span) >= min_height)
    .max_by_key(|(_, span)| length(span))
}

fn tab(
    image: &Image,
    split: i32,
    y: Range<i32>,
    tolerance: i32,
    min_width: i32,
) -> Option<(Rect, bool)> {
    let (span, y, right_active) = y
        .flat_map(|y| {
            runs(split - min_width * 3..split + min_width * 3, |x| {
                green(image.at(x, y))
            })
            .into_iter()
            .filter_map(move |span| {
                let left = (span.end - split).abs() <= tolerance;
                let right = (span.start - split).abs() <= tolerance;
                (length(&span) >= min_width && (left || right)).then_some((span, y, right))
            })
        })
        .max_by_key(|(span, _, _)| length(span))?;
    let half = length(&span);
    let middle = if right_active { span.start } else { span.end };
    let x = if right_active {
        middle + half / 5
    } else {
        middle - half / 5
    };
    let height = half / 3;
    let band = runs(y - height..y + height, |y| green(image.at(x, y)))
        .into_iter()
        .find(|band| band.contains(&y))?;
    Some((
        Rect::new(middle - half, band.start, middle + half, band.end),
        right_active,
    ))
}

fn active_career_tab(image: &Image, words: &[Word]) -> Option<(Rect, bool)> {
    for (word, is_left) in label(words, "Attributes")
        .map(|w| (w, true))
        .chain(label(words, "Skills").map(|w| (w, false)))
    {
        let offset = if is_left {
            word.width()
        } else {
            word.width() * 19 / 10
        };
        let split = if is_left {
            word.x() + offset
        } else {
            word.x() - offset
        };
        let y = word.top - word.height() / 2..word.bottom + word.height() / 2;
        if let Some((tabs, skills)) = tab(image, split, y, word.height(), offset * 3 / 2) {
            if skills == is_left && (tabs.x() - split).abs() < word.height() {
                return Some((tabs, skills));
            }
        }
    }
    None
}

pub(super) fn is_unique([r, g, b]: Rgb) -> bool {
    b > 125 && r > g.saturating_add(26) && b > g.saturating_add(22) && r.abs_diff(b) < 40
}

pub(super) fn is_event([r, g, b]: Rgb) -> bool {
    r > 225 && g < 150 && b < 135 && r.saturating_sub(g) >= 65
}

fn is_gold([r, g, b]: Rgb) -> bool {
    r >= 230 && (147..=233).contains(&g) && g.saturating_sub(b) >= 51
}

fn row_color(color @ [r, g, b]: Rgb) -> bool {
    ((140..=226).contains(&r) && b.saturating_sub(r) >= 9 && b.saturating_sub(g) >= 9)
        || is_gold(color)
        || is_unique(color)
        || is_event(color)
}

fn skill_icon([r, g, b]: Rgb) -> bool {
    (r > 205 && g >= 108 && b < 152)
        || (g > 135 && g.saturating_sub(r) >= 25 && b < 130)
        || (b >= 175 && g >= 112 && r < 122)
        || (r > 175 && r.saturating_sub(g) > 70 && r.saturating_sub(b) > 50)
}

fn chips(image: &Image, panel: Rect, columns: i32, clipped_top: bool) -> Vec<Rect> {
    let mut rows = Vec::new();
    let width = panel.width() / columns;
    for col in 0..columns {
        let left = panel.left + col * width;
        let bands = runs(panel.top..panel.bottom, |y| {
            let right_edge = [88, 91, 94]
                .iter()
                .filter(|&&pct| row_color(image.at(left + width * pct / 100, y)))
                .count()
                >= 2;
            if columns == 2 {
                let probe = left + width * 83 / 100..left + width * 96 / 100;
                let needed = length(&probe) as usize / 2;
                let event_body = [62, 65, 68]
                    .iter()
                    .all(|&pct| is_event(image.at(left + width * pct / 100, y)));
                right_edge
                    || event_body
                    || probe.filter(|&x| row_color(image.at(x, y))).count() >= needed
            } else {
                right_edge
            }
        });
        let bands = if columns == 2 {
            let min_height = width * 12 / 100;
            let mut joined: Vec<Range<i32>> = Vec::new();
            for band in join_gaps(bands, width / 33) {
                if let Some(previous) = joined.last_mut().filter(|previous| {
                    length(previous) < min_height
                        && length(&band) < min_height
                        && band.start - previous.end <= width / 27
                        && band.end - previous.start <= width / 5
                }) {
                    // The printed level can interrupt the color at the right of a compact chip.
                    previous.end = band.end;
                } else {
                    joined.push(band);
                }
            }
            joined
        } else {
            bands
        };
        for band in bands {
            if clipped_top && band.start <= panel.top + width / 150 {
                continue;
            }
            if !(width * 12 / 100..=width / 5).contains(&length(&band)) {
                continue;
            }
            let center = (band.start + band.end) / 2;
            let icon_area = Rect::new(
                left + width / 24,
                center - width / 30,
                left + width / 8,
                center + width / 30,
            );
            let colored = (icon_area.top..icon_area.bottom)
                .flat_map(|y| (icon_area.left..icon_area.right).map(move |x| image.at(x, y)))
                .filter(|&pixel| skill_icon(pixel))
                .count();
            if colored * 3 < (icon_area.width() * icon_area.height()) as usize {
                continue;
            }
            rows.push(Rect::new(left, band.start, left + width, band.end));
        }
    }
    // Small border/antialiasing differences between the columns must not change reading order.
    rows.sort_by_key(|row| row.y());
    let mut start = 0;
    while start < rows.len() {
        let end =
            start + rows[start..].partition_point(|row| row.y() - rows[start].y() <= width / 30);
        rows[start..end].sort_by_key(|row| row.left);
        start = end;
    }
    rows
}

fn learn(image: &Image, words: &[Word], profile: Option<Rect>) -> Option<Layout> {
    let near_confirm = words.iter().filter_map(|word| {
        let banner = profile?;
        let w = banner.width();
        let text = &word.text;
        let mismatches = text
            .bytes()
            .zip(b"Confirm")
            .filter(|(a, b)| !a.eq_ignore_ascii_case(b))
            .count();
        (text.len() == 7
            && mismatches == 1
            && (banner.left - w * 83 / 100..banner.left - w * 70 / 100).contains(&word.bounds.x())
            && (banner.top + w * 13 / 10..banner.top + w * 15 / 10).contains(&word.bounds.y()))
        .then_some(word.bounds)
    });
    let fallback = profile.and_then(|banner| {
        let width = banner.width();
        let reset = label(words, "Reset").find(|word| {
            (banner.top + width * 13 / 10..banner.top + width * 15 / 10).contains(&word.y())
                && (banner.left - width / 2..banner.left - width / 4).contains(&word.x())
        })?;
        let center = reset.x() - width * 34 / 100;
        let half = width / 16;
        Some(Rect::new(
            center - half,
            reset.top,
            center + half,
            reset.bottom,
        ))
    });
    for confirm in label(words, "Confirm").chain(near_confirm).chain(fallback) {
        let center = confirm.x();
        let reach = confirm.width() * 2;
        let Some(band) = (confirm.bottom..confirm.bottom + confirm.height())
            .flat_map(|y| {
                runs(center - reach..center + reach, |x| {
                    button_green(image.at(x, y))
                })
            })
            .filter(|span| span.contains(&center))
            .max_by_key(length)
        else {
            continue;
        };
        let button_width = length(&band);
        if !(confirm.width() * 2..=confirm.width() * 4).contains(&button_width) {
            continue;
        }
        let measured = scrollbar(
            image,
            center + button_width * 115 / 100..center + button_width * 130 / 100,
            confirm.top - button_width * 23 / 10..confirm.top - button_width / 8,
            button_width * 3 / 2,
        );
        let (right, top, bottom) = if let Some((bar_x, viewport)) = measured {
            (
                bar_x - button_width / 22,
                viewport.start - button_width / 20,
                viewport.end + button_width / 15,
            )
        } else if profile.is_some_and(|banner| {
            let w = banner.width();
            (w * 34 / 100..w * 41 / 100).contains(&button_width)
                && (banner.left - w * 83 / 100..banner.left - w * 70 / 100).contains(&center)
                && (banner.top + w * 13 / 10..banner.top + w * 15 / 10).contains(&confirm.y())
        }) {
            // At small sizes the narrow scrollbar track can disappear into the background.
            // Confirm and Reset still anchor the list's fixed bounds.
            let top = runs(confirm.y() - button_width / 4..confirm.y(), |y| {
                button_green(image.at(center - button_width / 4, y))
            })
            .into_iter()
            .last()
            .map(|band| band.start)
            .unwrap_or(confirm.top);
            (
                center + button_width * 117 / 100,
                top - button_width * 205 / 100,
                top - button_width / 20,
            )
        } else {
            continue;
        };
        let left = 2 * center - right;
        let panel = Rect::new(left, top, right, bottom);
        let width = panel.width();
        let bands = runs(panel.top..panel.bottom, |y| {
            [97, 98, 99]
                .iter()
                .filter(|&&pct| {
                    let pixel @ [r, g, b] = image.at(left + width * pct / 100, y);
                    row_color(pixel)
                        || button_green(pixel)
                        || ((140..=226).contains(&r) && b.saturating_sub(r.max(g)) >= 6)
                        || ((108..140).contains(&r)
                            && r.abs_diff(g) <= 8
                            && b.saturating_sub(r) >= 8)
                        || ((140..220).contains(&r)
                            && g.saturating_sub(b) >= 43
                            && r.saturating_sub(g) >= 19)
                })
                .count()
                >= 2
        });
        let rows = join_gaps(bands, button_width / 32)
            .into_iter()
            .filter(|band| {
                (button_width * 55 / 100..=button_width * 63 / 100).contains(&length(band))
            })
            .map(|band| Rect::new(left, band.start, right, band.end))
            .collect();
        return Some(Layout {
            screen: Screen::Learn,
            panel,
            header: None,
            rows,
        });
    }
    None
}

fn finished_layout(image: &Image, words: &[Word], close: Rect) -> Option<(Rect, Rect, bool)> {
    let center = close.x();
    let tabs = label(words, "Inspiration")
        .find(|word| word.y() < close.y() && (word.x() - center).abs() < word.width())
        .or_else(|| {
            label(words, "Career").find(|word| {
                word.y() < close.y()
                    && (close.width() * 2..close.width() * 4).contains(&(word.x() - center))
            })
        })?;
    let span = close.y() - tabs.y();
    let (band, y) = (tabs.y() - span * 86 / 100..tabs.y() - span * 65 / 100)
        .flat_map(|y| {
            runs(center - span * 2 / 3..center + span * 2 / 3, |x| {
                green(image.at(x, y))
            })
            .into_iter()
            .map(move |band| (band, y))
        })
        .filter(|(band, _)| {
            band.contains(&center) && (span * 9 / 10..span * 13 / 10).contains(&length(band))
        })
        .max_by_key(|(band, _)| length(band))?;
    let width = length(&band);
    let vertical = runs(y - width / 9..y + width / 9, |y| {
        green(image.at(band.end - width / 12, y))
    })
    .into_iter()
    .find(|span| span.contains(&y))?;
    let active_x = band.start + width / 12;
    let active = green(image.at(active_x, tabs.y()));
    let panel = Rect::new(
        band.start + width / 65,
        tabs.y() + width * 57 / 1000,
        band.end - width / 65,
        close.y() - width / 10,
    );
    Some((
        Rect::new(band.start, vertical.start, band.end, vertical.end),
        panel,
        active,
    ))
}

fn popup_header(image: &Image, profile: Rect) -> Option<Rect> {
    let width = profile.width();
    let center = profile.left - width * 76 / 100;
    let (band, y) = (profile.top..profile.top + width / 7)
        .flat_map(|y| {
            runs(center - width * 55 / 100..center + width * 55 / 100, |x| {
                green(image.at(x, y))
            })
            .into_iter()
            .map(move |band| (band, y))
        })
        .filter(|(band, _)| {
            (width * 87 / 100..width).contains(&length(band))
                && (band.start + length(band) / 2 - center).abs() <= width / 25
        })
        .max_by_key(|(band, _)| length(band))?;
    let probe = band.end - width / 10;
    let ys = runs(y - width / 8..y + width / 8, |y| green(image.at(probe, y)))
        .into_iter()
        .find(|span| span.contains(&y))?;
    (width / 18..width / 9)
        .contains(&length(&ys))
        .then(|| Rect::new(band.start, ys.start, band.end, ys.end))
}

fn popup_skills(image: &Image, header: Rect, close: Option<Rect>) -> Option<Layout> {
    let w = header.width();
    let bottom = close.map_or(header.bottom + w * 145 / 100, |close| close.y() - w / 10);
    // Finished Details has three tabs, with Skills in the left third. In-career
    // Details has two tabs with Skills on the right, below the growth-rate row.
    let split = header.left + w / 3;
    if let Some((tabs, false)) = tab(
        image,
        split,
        header.bottom + w * 62 / 100..header.bottom + w * 70 / 100,
        w / 35,
        w * 28 / 100,
    ) {
        let panel = Rect::new(
            header.left + w / 65,
            tabs.bottom + w / 34,
            header.right - w / 65,
            bottom,
        );
        return Some(Layout {
            screen: Screen::FinishedDetails,
            panel,
            header: Some(header),
            rows: chips(image, panel, 2, true),
        });
    }
    if let Some((tabs, true)) = tab(
        image,
        header.x(),
        header.bottom + w * 74 / 100..header.bottom + w * 82 / 100,
        w / 35,
        w * 43 / 100,
    ) {
        let panel = Rect::new(tabs.left, tabs.bottom, tabs.right, bottom);
        return Some(Layout {
            screen: Screen::DetailsSkills,
            panel,
            header: None,
            rows: chips(image, panel, 2, false),
        });
    }
    None
}

fn is_chart(image: &Image, panel: Rect) -> bool {
    let w = panel.width();
    let x = panel.left + w * 36 / 100..panel.left + w * 67 / 100;
    let y = panel.top + w * 26 / 100..panel.top + w * 56 / 100;
    let area = length(&x) * length(&y);
    let fill = y
        .flat_map(|y| x.clone().map(move |x| image.at(x, y)))
        .filter(|&[r, g, b]| {
            r > 220 && (150..=218).contains(&g) && r.saturating_sub(g) > 24 && b < 155
        })
        .count() as i32;
    fill * 7 > area
}

pub(super) fn detect(image: &Image, words: &[Word], profile: Option<Rect>) -> Layout {
    let unsupported = Layout {
        screen: Screen::Unsupported,
        panel: Rect::new(0, 0, 0, 0),
        header: None,
        rows: Vec::new(),
    };
    let close = label(words, "Close").next();
    if let Some(close) = close {
        if label(words, "Learned").any(|r| r.y() < close.y()) {
            return unsupported;
        }
        if let Some((header, panel, active)) = finished_layout(image, words, close) {
            if active {
                return Layout {
                    screen: Screen::FinishedDetails,
                    panel,
                    header: Some(header),
                    rows: chips(image, panel, 2, true),
                };
            }
            return unsupported;
        }
        if let Some(growth) = label(words, "Growth").find(|r| r.y() < close.y()) {
            let h = growth.height();
            if let Some((tabs, true)) = tab(
                image,
                close.x(),
                growth.bottom + h..growth.bottom + 7 * h,
                h,
                h * 14,
            ) {
                let panel = Rect::new(
                    tabs.left,
                    tabs.bottom,
                    tabs.right,
                    close.y() - tabs.width() / 10,
                );
                return Layout {
                    screen: Screen::DetailsSkills,
                    panel,
                    header: None,
                    rows: chips(image, panel, 2, false),
                };
            }
        }
    }
    if let Some(header) = profile.and_then(|profile| popup_header(image, profile)) {
        return popup_skills(image, header, close).unwrap_or(unsupported);
    }
    if close.is_some() {
        return unsupported;
    }
    if let Some(layout) = learn(image, words, profile) {
        return layout;
    }
    let career_tab = active_career_tab(image, words).or_else(|| {
        profile.and_then(|profile| {
            let w = profile.width();
            tab(
                image,
                profile.left - w * 54 / 100,
                profile.top + w * 35 / 100..profile.top + w * 43 / 100,
                w / 32,
                w / 5,
            )
        })
    });
    if let Some((tabs, skills)) = career_tab {
        let width = tabs.width();
        let panel = if skills {
            let bottom = scrollbar(
                image,
                tabs.right - width / 30..tabs.right + width / 18,
                tabs.bottom..tabs.bottom + width * 3 / 2,
                width * 3 / 4,
            )
            .map_or(tabs.bottom + width * 4 / 3, |(_, span)| span.end);
            Rect::new(tabs.left, tabs.bottom, tabs.right, bottom)
        } else {
            Rect::new(
                tabs.left,
                tabs.bottom,
                tabs.right,
                tabs.bottom + width * 7 / 5,
            )
        };
        let chart = is_chart(image, panel)
            || label(words, "Wit").any(|wit| {
                label(words, "Stamina").any(|stamina| {
                    stamina.x() - wit.x() > width / 3
                        && (stamina.y() - wit.y()).abs() < width / 12
                        && wit.y() > panel.top
                        && stamina.x() < panel.right
                })
            });
        let screen = if skills {
            Screen::CareerSkills
        } else if chart {
            Screen::AttributesChart
        } else {
            Screen::AttributesNumbers
        };
        return Layout {
            screen,
            panel,
            header: None,
            rows: if skills {
                chips(image, panel, 1, false)
            } else {
                Vec::new()
            },
        };
    }
    unsupported
}

pub(super) fn grade_rows(image: &Image, panel: Rect) -> Vec<Range<i32>> {
    let width = panel.width();
    let left = panel.left + width / 50;
    let right = panel.left + width / 30;
    let bands = runs(panel.top + width * 2 / 3..panel.bottom, |y| {
        (left..right).filter(|&x| green(image.at(x, y))).count() * 2 >= (right - left) as usize
    });
    join_gaps(bands, width / 60)
        .into_iter()
        .filter(|band| (width / 18..width / 9).contains(&length(band)))
        .collect()
}

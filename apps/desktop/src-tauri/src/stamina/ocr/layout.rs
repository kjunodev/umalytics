use super::image::{Image, Rect, Rgb, Word};
use serde::Deserialize;
use std::ops::Range;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Screen {
    AttributesNumbers,
    AttributesChart,
    CareerSkills,
    DetailsSkills,
    Learn,
    Unsupported,
}

#[derive(Debug)]
pub(super) struct Layout {
    pub screen: Screen,
    pub panel: Rect,
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

fn button_green([r, g, b]: Rgb) -> bool {
    r >= 30 && g >= 68 && g.saturating_sub(r) >= 10 && b < 65
}

pub(super) fn brown_ink([r, g, b]: Rgb) -> u8 {
    let opacity = (r.saturating_sub(g).saturating_sub(9) as u16 * 9)
        .min(g.saturating_sub(b).saturating_sub(3) as u16 * 14)
        .min(230_u8.saturating_sub(r) as u16 * 3);
    255 - opacity.min(255) as u8
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
}

fn chips(image: &Image, panel: Rect, columns: i32) -> Vec<Rect> {
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
            join_gaps(bands, width / 33)
        } else {
            bands
        };
        for band in bands {
            if !(width * 12 / 100..=width * 20 / 100).contains(&length(&band)) {
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
    rows.sort_by_key(|r| r.top);
    for pair in rows
        .chunks_mut(2)
        .filter(|pair| pair.len() == 2 && columns == 2)
    {
        if (pair[0].top - pair[1].top).abs() < width / 30 {
            pair.sort_by_key(|r| r.left);
        }
    }
    rows
}

fn learn(image: &Image, words: &[Word]) -> Option<Layout> {
    for confirm in label(words, "Confirm") {
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
        let Some((bar_x, viewport)) = scrollbar(
            image,
            center + button_width * 115 / 100..center + button_width * 130 / 100,
            confirm.top - button_width * 23 / 10..confirm.top - button_width / 8,
            button_width * 3 / 2,
        ) else {
            continue;
        };
        let right = bar_x - button_width / 22;
        let left = 2 * center - right;
        let panel = Rect::new(
            left,
            viewport.start - button_width / 20,
            right,
            viewport.end + button_width / 15,
        );
        let width = panel.width();
        let rows = runs(panel.top..panel.bottom, |y| {
            [97, 98, 99]
                .iter()
                .filter(|&&pct| row_color(image.at(left + width * pct / 100, y)))
                .count()
                >= 2
        })
        .into_iter()
        .filter(|band| (button_width * 55 / 100..=button_width * 63 / 100).contains(&length(band)))
        .map(|band| Rect::new(left, band.start, right, band.end))
        .collect();
        return Some(Layout {
            screen: Screen::Learn,
            panel,
            rows,
        });
    }
    None
}

pub(super) fn detect(image: &Image, words: &[Word]) -> Layout {
    let unsupported = Layout {
        screen: Screen::Unsupported,
        panel: Rect::new(0, 0, 0, 0),
        rows: Vec::new(),
    };
    if let Some(close) = label(words, "Close").next() {
        if label(words, "Learned").any(|r| r.y() < close.y()) {
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
                    rows: chips(image, panel, 2),
                };
            }
        }
        return unsupported;
    }
    if let Some(layout) = learn(image, words) {
        return layout;
    }
    if let Some((tabs, skills)) = active_career_tab(image, words) {
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
        let chart = label(words, "Wit").any(|wit| {
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
            rows: if skills {
                chips(image, panel, 1)
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

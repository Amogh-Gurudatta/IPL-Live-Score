// IPL Live Score — COSMIC Desktop Applet
//
// A native System76 COSMIC panel applet that streams live IPL cricket scores.
// Uses ureq for blocking HTTP, regex for XML parsing, and libcosmic for the UI.

use cosmic_applet::CosmicApplet;
use iced::widget::{button, column, container, horizontal_rule, row, scrollable, text};
use iced::{self, Alignment, Application, Command, Element, Length, Subscription, Theme};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RSS_URL: &str = "http://static.cricinfo.com/rss/livescores.xml";
const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// Full team name → abbreviation mapping.
static IPL_TEAMS: Lazy<Vec<(&str, &str)>> = Lazy::new(|| {
    vec![
        ("Chennai Super Kings", "CSK"),
        ("Delhi Capitals", "DC"),
        ("Gujarat Titans", "GT"),
        ("Kolkata Knight Riders", "KKR"),
        ("Lucknow Super Giants", "LSG"),
        ("Mumbai Indians", "MI"),
        ("Punjab Kings", "PBKS"),
        ("Rajasthan Royals", "RR"),
        ("Royal Challengers Bengaluru", "RCB"),
        ("Royal Challengers Bangalore", "RCB"),
        ("Sunrisers Hyderabad", "SRH"),
    ]
});

/// Regex to extract <item> blocks with <title> content.
static ITEM_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?si)<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>[\s\S]*?</item>",
    )
    .unwrap()
});

/// Regex to extract score pairs like 150/4.
static SCORE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(\d+)/(\d+)\b").unwrap());

/// Regex to detect any digit.
static DIGIT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\d").unwrap());

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct MatchInfo {
    title: String,
    is_live: bool,
    has_started: bool,
    is_finished: bool,
}

#[derive(Debug, Clone, Default)]
struct FeedData {
    active_match: String,
    ongoing: Vec<String>,
    completed: Vec<String>,
    scheduled: Vec<String>,
}

// ---------------------------------------------------------------------------
// Core Logic (Pure Functions)
// ---------------------------------------------------------------------------

/// Determine whether a match has finished based on runs/wickets.
fn is_match_finished(title: &str) -> bool {
    let scores: Vec<(u32, u32)> = SCORE_RE
        .captures_iter(title)
        .filter_map(|cap| {
            let runs = cap[1].parse::<u32>().ok()?;
            let wkts = cap[2].parse::<u32>().ok()?;
            Some((runs, wkts))
        })
        .collect();

    if scores.len() < 2 {
        return false;
    }

    let (runs1, wkts1) = scores[0];
    let (runs2, wkts2) = scores[1];

    runs2 > runs1 || wkts1 == 10 || wkts2 == 10
}

/// Replace full team names with abbreviations.
fn shorten_title(title: &str) -> String {
    let mut result = title.to_string();
    for (full_name, abbr) in IPL_TEAMS.iter() {
        result = result.replace(full_name, abbr);
    }
    result
}

/// Fetch the RSS feed and parse it into structured data.
fn fetch_and_parse() -> Option<FeedData> {
    let resp = ureq::get(RSS_URL)
        .set("User-Agent", "IPL-Live-Score/2.0")
        .call()
        .ok()?;

    let xml_text = resp.into_string().ok()?;

    let team_names: Vec<&str> = IPL_TEAMS.iter().map(|(name, _)| *name).collect();

    let mut ipl_matches: Vec<MatchInfo> = Vec::new();

    for cap in ITEM_RE.captures_iter(&xml_text) {
        let title_text = cap.get(1).map_or("", |m| m.as_str()).trim().to_string();

        if title_text.is_empty() || title_text.contains("Cricinfo Live Scores") {
            continue;
        }

        // Filter: must contain an IPL team name
        if !team_names.iter().any(|team| title_text.contains(team)) {
            continue;
        }

        // Shorten team names
        let shortened = shorten_title(&title_text);

        // Smart State Math
        let has_asterisk = shortened.contains('*');
        let has_started = DIGIT_RE.is_match(&shortened);
        let finished = is_match_finished(&shortened);
        let is_live = has_asterisk && !finished;

        // Replace '*' with 🏏 for display
        let display_title = shortened.replace('*', "🏏");

        ipl_matches.push(MatchInfo {
            title: display_title,
            is_live,
            has_started,
            is_finished: finished,
        });
    }

    if ipl_matches.is_empty() {
        return Some(FeedData {
            active_match: "🏏 IPL: No Live Matches".into(),
            ..Default::default()
        });
    }

    // Reverse so newest matches come first
    ipl_matches.reverse();

    // Priority Selector: Live > Started > Scheduled
    let active_idx = ipl_matches
        .iter()
        .position(|m| m.is_live)
        .or_else(|| ipl_matches.iter().position(|m| m.has_started))
        .unwrap_or(0);

    let active_title = ipl_matches[active_idx].title.clone();

    // Categorize remaining matches
    let mut ongoing = Vec::new();
    let mut completed = Vec::new();
    let mut scheduled = Vec::new();

    for (i, m) in ipl_matches.iter().enumerate() {
        if i == active_idx {
            continue;
        }
        if m.is_live {
            ongoing.push(m.title.clone());
        } else if m.is_finished {
            completed.push(m.title.clone());
        } else if !m.has_started {
            scheduled.push(m.title.clone());
        }
    }

    Some(FeedData {
        active_match: active_title,
        ongoing,
        completed,
        scheduled,
    })
}

// ---------------------------------------------------------------------------
// COSMIC Applet
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum Message {
    Tick,
    FeedResult(Option<FeedData>),
    TogglePopup,
    Refresh,
}

struct IplScoreApplet {
    core: cosmic_applet::Core,
    data: FeedData,
    popup_open: bool,
    loading: bool,
}

impl Application for IplScoreApplet {
    type Executor = iced::executor::Default;
    type Flags = ();
    type Message = Message;
    type Theme = Theme;

    fn new(_flags: Self::Flags) -> (Self, Command<Message>) {
        let app = Self {
            core: cosmic_applet::Core::default(),
            data: FeedData {
                active_match: "🏏 Loading IPL...".into(),
                ..Default::default()
            },
            popup_open: false,
            loading: true,
        };

        // Immediately fetch on startup
        let cmd = Command::perform(async { fetch_scores_async().await }, Message::FeedResult);

        (app, cmd)
    }

    fn title(&self) -> String {
        "IPL Live Score".into()
    }

    fn update(&mut self, message: Message) -> Command<Message> {
        match message {
            Message::Tick => {
                self.loading = true;
                Command::perform(async { fetch_scores_async().await }, Message::FeedResult)
            }
            Message::FeedResult(result) => {
                self.loading = false;
                if let Some(feed_data) = result {
                    self.data = feed_data;
                } else {
                    self.data.active_match = "🏏 IPL: Offline".into();
                }
                Command::none()
            }
            Message::TogglePopup => {
                self.popup_open = !self.popup_open;
                Command::none()
            }
            Message::Refresh => {
                self.loading = true;
                Command::perform(async { fetch_scores_async().await }, Message::FeedResult)
            }
        }
    }

    fn subscription(&self) -> Subscription<Message> {
        iced::time::every(POLL_INTERVAL).map(|_| Message::Tick)
    }

    fn view(&self) -> Element<Message> {
        if !self.popup_open {
            // Compact representation — panel bar text
            return button(text(&self.data.active_match).size(14))
                .on_press(Message::TogglePopup)
                .padding([4, 8])
                .into();
        }

        // Full representation — expanded popup
        let mut content = column![].spacing(8).padding(12).width(Length::Fixed(350.0));

        // Active match header
        content = content.push(
            text(&self.data.active_match)
                .size(16)
                .style(iced::theme::Text::Color(iced::Color::from_rgb(1.0, 0.84, 0.0))),
        );
        content = content.push(horizontal_rule(1));

        // Category sections
        if !self.data.ongoing.is_empty() {
            content = content.push(text("🔴 ONGOING").size(13));
            for m in &self.data.ongoing {
                content = content.push(text(format!("  {}", m)).size(13));
            }
            content = content.push(horizontal_rule(1));
        }

        if !self.data.completed.is_empty() {
            content = content.push(text("✅ COMPLETED").size(13));
            for m in &self.data.completed {
                content = content.push(text(format!("  {}", m)).size(13));
            }
            content = content.push(horizontal_rule(1));
        }

        if !self.data.scheduled.is_empty() {
            content = content.push(text("📅 SCHEDULED").size(13));
            for m in &self.data.scheduled {
                content = content.push(text(format!("  {}", m)).size(13));
            }
            content = content.push(horizontal_rule(1));
        }

        // Refresh button
        let refresh_label = if self.loading { "Refreshing..." } else { "Refresh Now" };
        content = content.push(
            button(text(refresh_label).size(13))
                .on_press(Message::Refresh)
                .width(Length::Fill),
        );

        // Wrap in a container for the popup look
        let popup = container(scrollable(content))
            .max_height(400.0)
            .style(iced::theme::Container::Box);

        column![
            button(text(&self.data.active_match).size(14))
                .on_press(Message::TogglePopup)
                .padding([4, 8]),
            popup,
        ]
        .into()
    }
}

/// Async wrapper around the blocking fetch_and_parse.
async fn fetch_scores_async() -> Option<FeedData> {
    tokio::task::spawn_blocking(fetch_and_parse)
        .await
        .ok()
        .flatten()
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

fn main() -> iced::Result {
    IplScoreApplet::run(iced::Settings {
        id: Some("com.github.amogh.ipl-live-score".into()),
        window: iced::window::Settings {
            size: iced::Size::new(200.0, 32.0),
            ..Default::default()
        },
        ..Default::default()
    })
}

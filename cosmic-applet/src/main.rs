// IPL Live Score — COSMIC Desktop Applet (v3.0.0)
//
// Data source: ESPN Core API (unprotected, no WAF).
// Uses ureq for blocking HTTP, serde_json for JSON parsing,
// and libcosmic for the UI with rich Scorecard layout.

use chrono::Timelike;
use cosmic_applet::CosmicApplet;
use iced::widget::{button, column, container, horizontal_rule, row, scrollable, text, Column};
use iced::{self, Alignment, Application, Command, Element, Font, Length, Subscription, Theme};
use once_cell::sync::Lazy;
use rand::Rng;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL: &str =
    "https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket";
const CRICINFO_LIVE: &str = "https://www.espncricinfo.com/live-cricket-scores";

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

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct MatchCard {
    venue_line: String,
    score_line: String,
    context_line: String,
    panel_text: String,
    is_live: bool,
    has_started: bool,
    is_finished: bool,
    link: String,
}

#[derive(Debug, Clone, Default)]
struct FeedData {
    active_panel_text: String,
    cards: Vec<MatchCard>,
    is_match_in_progress: bool,
}

// ---------------------------------------------------------------------------
// Core Logic — ESPN Core API
// ---------------------------------------------------------------------------

fn get_team_abbr(display_name: &str, api_abbr: &str) -> String {
    for (full_name, abbr) in IPL_TEAMS.iter() {
        if *full_name == display_name {
            return abbr.to_string();
        }
    }
    if !api_abbr.is_empty() {
        api_abbr.to_string()
    } else {
        display_name.to_string()
    }
}

fn extract_match_num(description: &str) -> String {
    // Extract "14th Match (N)" or "1st Match" from description like
    // "14th Match (N), Indian Premier League at Delhi, Apr 8 2026"
    if let Some(idx) = description.find("Match") {
        let end = if let Some(paren_end) = description[idx..].find(')') {
            idx + paren_end + 1
        } else {
            idx + 5 // "Match".len()
        };
        let candidate = description[..end].trim();
        // Only return if it starts with a digit or word char
        if !candidate.is_empty() {
            return candidate.to_string();
        }
    }
    String::new()
}

fn build_panel_text(competitors: &[serde_json::Value]) -> Option<String> {
    if competitors.len() < 2 {
        return None;
    }

    let mut parts: Vec<String> = Vec::new();
    for comp in competitors {
        let display_name = comp["displayName"].as_str().unwrap_or("");
        let api_abbr = comp["abbreviation"]
            .as_str()
            .or_else(|| comp["name"].as_str())
            .unwrap_or("");
        let abbr = get_team_abbr(display_name, api_abbr);
        let score = comp["score"].as_str().unwrap_or("");

        if score.is_empty() {
            parts.push(abbr);
        } else {
            parts.push(format!("{} {}", abbr, score));
        }
    }

    Some(parts.join(" v "))
}

fn fetch_and_parse() -> Option<FeedData> {
    let resp = ureq::get(API_URL)
        .set("User-Agent", "Mozilla/5.0")
        .call()
        .ok()?;

    let text = resp.into_string().ok()?;
    let api_data: serde_json::Value = serde_json::from_str(&text).ok()?;

    let leagues = api_data["sports"][0]["leagues"].as_array()?;

    let team_names: Vec<&str> = IPL_TEAMS.iter().map(|(name, _)| *name).collect();

    let mut cards: Vec<MatchCard> = Vec::new();

    for league in leagues {
        let events = match league["events"].as_array() {
            Some(e) => e,
            None => continue,
        };

        for event in events {
            let event_name = event["name"].as_str().unwrap_or("");

            if !team_names.iter().any(|t| event_name.contains(t)) {
                continue;
            }

            let competitors = match event["competitors"].as_array() {
                Some(c) => c,
                None => continue,
            };

            if competitors.len() < 2 {
                continue;
            }

            let state = event["fullStatus"]["type"]["state"]
                .as_str()
                .unwrap_or("");
            let status_detail = event["fullStatus"]["type"]["detail"]
                .as_str()
                .unwrap_or("");
            let context = event["fullStatus"]["summary"]
                .as_str()
                .unwrap_or(status_detail);

            let venue = event["location"].as_str().unwrap_or("");
            let description = event["description"].as_str().unwrap_or("");
            let match_num = extract_match_num(description);
            let link = event["link"]
                .as_str()
                .unwrap_or(CRICINFO_LIVE)
                .replace("www.espn.in", "www.espncricinfo.com");

            let panel_text = match build_panel_text(competitors) {
                Some(t) => t,
                None => continue,
            };

            // Build venue line
            let mut venue_line = String::new();
            if !venue.is_empty() {
                venue_line = format!("🏟️ {}", venue);
            }
            if !match_num.is_empty() {
                if venue_line.is_empty() {
                    venue_line = format!("🏟️ {}", match_num);
                } else {
                    venue_line = format!("{} • {}", venue_line, match_num);
                }
            }

            // Build score line
            let c0_dn = competitors[0]["displayName"].as_str().unwrap_or("");
            let c0_aa = competitors[0]["abbreviation"]
                .as_str()
                .or_else(|| competitors[0]["name"].as_str())
                .unwrap_or("");
            let c0_score = competitors[0]["score"].as_str().unwrap_or("");
            let c1_dn = competitors[1]["displayName"].as_str().unwrap_or("");
            let c1_aa = competitors[1]["abbreviation"]
                .as_str()
                .or_else(|| competitors[1]["name"].as_str())
                .unwrap_or("");
            let c1_score = competitors[1]["score"].as_str().unwrap_or("");

            let t1 = format!("{} {}", get_team_abbr(c0_dn, c0_aa), c0_score)
                .trim()
                .to_string();
            let t2 = format!("{} {}", get_team_abbr(c1_dn, c1_aa), c1_score)
                .trim()
                .to_string();
            let score_line = format!("🏏 {} v {}", t1, t2);

            // Build context line
            let context_line = if !context.is_empty() {
                format!("👉 {}", context)
            } else {
                String::new()
            };

            cards.push(MatchCard {
                venue_line,
                score_line,
                context_line,
                panel_text,
                is_live: state == "in",
                has_started: state == "in" || state == "post",
                is_finished: state == "post",
                link,
            });
        }
    }

    if cards.is_empty() {
        return Some(FeedData {
            active_panel_text: "🏏 IPL: No Live Matches".into(),
            ..Default::default()
        });
    }

    // Priority Selector
    let active_idx = cards
        .iter()
        .position(|c| c.is_live)
        .or_else(|| cards.iter().position(|c| c.has_started))
        .unwrap_or(0);

    let active_panel_text = format!("🏏 {}", cards[active_idx].panel_text);

    let is_match_in_progress = cards.iter().any(|c| c.has_started && !c.is_finished);

    Some(FeedData {
        active_panel_text,
        cards,
        is_match_in_progress,
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
    poll_interval: Duration,
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
                active_panel_text: "🏏 Loading IPL...".into(),
                ..Default::default()
            },
            popup_open: false,
            loading: true,
            poll_interval: Duration::from_secs(3600),
        };

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
                    self.data.active_panel_text = "🏏 IPL: Offline".into();
                    self.data.is_match_in_progress = false;
                    self.data.cards.clear();
                }

                // Smart Polling with Jitter
                let hour = chrono::Local::now().hour();
                let jitter = rand::thread_rng().gen_range(55..=75);
                let active_interval = Duration::from_secs(jitter);
                let idle_interval = Duration::from_secs(3600);

                let next_interval = if self.data.is_match_in_progress {
                    active_interval
                } else if hour == 15 {
                    active_interval
                } else if (19..=23).contains(&hour) {
                    active_interval
                } else {
                    idle_interval
                };

                if self.poll_interval != next_interval {
                    println!(
                        "[IPL Live Score] Polling Engine shifted to {}s interval",
                        next_interval.as_secs()
                    );
                    self.poll_interval = next_interval;
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
        iced::time::every(self.poll_interval).map(|_| Message::Tick)
    }

    fn view(&self) -> Element<Message> {
        if !self.popup_open {
            return button(text(&self.data.active_panel_text).size(14))
                .on_press(Message::TogglePopup)
                .padding([4, 8])
                .into();
        }

        let mut content = column![].spacing(4).padding(12).width(Length::Fixed(380.0));

        // Render each match as a Scorecard
        for (i, card) in self.data.cards.iter().enumerate() {
            let mut card_col = column![].spacing(2);

            // Line 1: Venue + Match Num (small, grey)
            if !card.venue_line.is_empty() {
                card_col = card_col.push(
                    text(&card.venue_line)
                        .size(11)
                        .style(iced::theme::Text::Color(iced::Color::from_rgb(
                            0.53, 0.53, 0.53,
                        ))),
                );
            }

            // Line 2: Score (bold, large)
            card_col = card_col.push(
                text(&card.score_line)
                    .size(15)
                    .style(iced::theme::Text::Color(iced::Color::from_rgb(
                        1.0, 0.84, 0.0,
                    ))),
            );

            // Line 3: Context (red if live, grey otherwise)
            if !card.context_line.is_empty() {
                let context_color = if card.is_live {
                    iced::Color::from_rgb(1.0, 0.27, 0.27) // #FF4444
                } else {
                    iced::Color::from_rgb(0.53, 0.53, 0.53) // grey
                };
                card_col = card_col.push(
                    text(&card.context_line)
                        .size(12)
                        .style(iced::theme::Text::Color(context_color)),
                );
            }

            content = content.push(card_col);

            // Separator between cards
            if i < self.data.cards.len() - 1 {
                content = content.push(horizontal_rule(1));
            }
        }

        // No matches fallback
        if self.data.cards.is_empty() {
            content = content.push(
                text("No IPL matches found")
                    .size(13)
                    .style(iced::theme::Text::Color(iced::Color::from_rgb(
                        0.53, 0.53, 0.53,
                    ))),
            );
        }

        content = content.push(horizontal_rule(1));

        // Refresh button
        let refresh_label = if self.loading {
            "Refreshing..."
        } else {
            "Refresh Now"
        };
        content = content.push(
            button(text(refresh_label).size(13))
                .on_press(Message::Refresh)
                .width(Length::Fill),
        );

        let popup = container(scrollable(content))
            .max_height(450.0)
            .style(iced::theme::Container::Box);

        column![
            button(text(&self.data.active_panel_text).size(14))
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

#!/usr/bin/env python3
"""
IPL Live Score — Universal Bar Script (v3.0.0)
Works with Waybar, Polybar, XFCE Genmon, dwm, macOS xbar/SwiftBar, MATE, and
any status bar that reads stdout.

Data source: ESPN Core API (unprotected, no WAF, no auth tokens).

Usage:
    python3 ipl_score.py --format waybar     # JSON output for Waybar
    python3 ipl_score.py --format text       # Plain text for Polybar / XFCE Genmon
    python3 ipl_score.py --format dwm        # Single line for xsetroot -name
    python3 ipl_score.py --format xbar       # macOS xbar / SwiftBar menu bar plugin
    python3 ipl_score.py --format mate       # MATE Desktop Command Applet

dwm usage (add to .xinitrc):
    while true; do xsetroot -name "$(python3 /path/to/ipl_score.py --format dwm)"; sleep 60; done &
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.request

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

API_URL = "https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket"
CRICINFO_LIVE = "https://www.espncricinfo.com/live-cricket-scores"

IPL_TEAMS = {
    "Chennai Super Kings": "CSK",
    "Delhi Capitals": "DC",
    "Gujarat Titans": "GT",
    "Kolkata Knight Riders": "KKR",
    "Lucknow Super Giants": "LSG",
    "Mumbai Indians": "MI",
    "Punjab Kings": "PBKS",
    "Rajasthan Royals": "RR",
    "Royal Challengers Bengaluru": "RCB",
    "Royal Challengers Bangalore": "RCB",  # Legacy fallback
    "Sunrisers Hyderabad": "SRH",
}

TEAM_NAMES = list(IPL_TEAMS.keys())


# ---------------------------------------------------------------------------
# Core Logic — ESPN Core API
# ---------------------------------------------------------------------------

def _get_team_abbr(display_name, api_abbr):
    """Get team abbreviation: prefer our IPL_TEAMS dict, fallback to API's own abbreviation."""
    if display_name in IPL_TEAMS:
        return IPL_TEAMS[display_name]
    return api_abbr or display_name


def _extract_match_num(description):
    """Extract match number from description like '14th Match (N), Indian Premier League at Delhi, Apr 8 2026'."""
    m = re.match(r"^([\w\d]+(?:st|nd|rd|th)?\s+Match(?:\s*\([A-Z]\))?)", description or "")
    return m.group(1) if m else ""


def _build_panel_text(competitors):
    """Build the short panel bar text: T1 T1Score v T2 T2Score."""
    if len(competitors) < 2:
        return None

    parts = []
    for comp in competitors:
        display_name = comp.get("displayName", "")
        api_abbr = comp.get("abbreviation", comp.get("name", ""))
        abbr = _get_team_abbr(display_name, api_abbr)
        score = comp.get("score", "")

        team_part = abbr
        if score:
            team_part += f" {score}"
        parts.append(team_part)

    return " v ".join(parts)


def fetch_and_parse():
    """
    Fetch live scores from ESPN Core API.
    Returns a list of match dicts with rich scorecard data, or None on failure.
    """
    try:
        req = urllib.request.Request(API_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
    except Exception:
        return None

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None

    try:
        leagues = data["sports"][0]["leagues"]
    except (KeyError, TypeError, IndexError):
        return None

    ipl_matches = []

    for league in leagues:
        events = league.get("events", [])
        for event in events:
            event_name = event.get("name", "")

            if not any(t in event_name for t in TEAM_NAMES):
                continue

            competitors = event.get("competitors", [])
            if len(competitors) < 2:
                continue

            # Extract state
            full_status = event.get("fullStatus", {})
            status_type = full_status.get("type", {})
            state = status_type.get("state", "")
            status_detail = status_type.get("detail", "")

            is_live = state == "in"
            has_started = state in ("in", "post")
            is_finished = state == "post"

            # Scorecard fields
            venue = event.get("location", "")
            description = event.get("description", "")
            match_num = _extract_match_num(description)
            context = full_status.get("summary", status_detail)
            link = event.get("link", CRICINFO_LIVE).replace("www.espn.in", "www.espncricinfo.com")

            # Panel text (short)
            panel_text = _build_panel_text(competitors)
            if not panel_text:
                continue

            # Full display with status
            display_title = panel_text
            if status_detail:
                display_title += f" | {status_detail}"
            display_title = re.sub(r"  +", " ", display_title).strip()

            # Build competitor details for scorecard
            comp_details = []
            for comp in competitors:
                dn = comp.get("displayName", "")
                aa = comp.get("abbreviation", comp.get("name", ""))
                comp_details.append({
                    "abbr": _get_team_abbr(dn, aa),
                    "score": comp.get("score", ""),
                    "winner": comp.get("winner", False),
                })

            ipl_matches.append({
                "title": display_title,
                "panel_text": panel_text,
                "link": link,
                "is_live": is_live,
                "has_started": has_started,
                "is_finished": is_finished,
                # Scorecard fields
                "venue": venue,
                "match_num": match_num,
                "context": context,
                "competitors": comp_details,
            })

    return ipl_matches


# ---------------------------------------------------------------------------
# Scorecard Builders
# ---------------------------------------------------------------------------

def build_pango_scorecard(match):
    """Build a rich multi-line scorecard using Pango markup (for Waybar tooltip)."""
    lines = []

    # Line 1: Venue + Match Num
    venue_line = ""
    if match["venue"]:
        venue_line = f'🏟️ {match["venue"]}'
    if match["match_num"]:
        venue_line += f' • {match["match_num"]}' if venue_line else f'🏟️ {match["match_num"]}'
    if venue_line:
        lines.append(f'<span size="small" color="gray">{venue_line}</span>')

    # Line 2: Score
    comps = match["competitors"]
    score_line = f'🏏 {comps[0]["abbr"]} {comps[0]["score"]} v {comps[1]["abbr"]} {comps[1]["score"]}'
    score_line = re.sub(r"  +", " ", score_line).strip()
    lines.append(f'<b>{score_line}</b>')

    # Line 3: Context
    if match["context"]:
        if match["is_live"]:
            lines.append(f'<span color="#FF4444"><b>👉 {match["context"]}</b></span>')
        else:
            lines.append(f'<span color="gray">👉 {match["context"]}</span>')

    return "\n".join(lines)


def build_plain_scorecard(match):
    """Build a rich multi-line scorecard using plain text (for text/xbar/mate)."""
    lines = []

    # Line 1: Venue + Match Num
    venue_line = ""
    if match["venue"]:
        venue_line = f'🏟️ {match["venue"]}'
    if match["match_num"]:
        venue_line += f' • {match["match_num"]}' if venue_line else f'🏟️ {match["match_num"]}'
    if venue_line:
        lines.append(venue_line)

    # Line 2: Score
    comps = match["competitors"]
    score_line = f'🏏 {comps[0]["abbr"]} {comps[0]["score"]} v {comps[1]["abbr"]} {comps[1]["score"]}'
    score_line = re.sub(r"  +", " ", score_line).strip()
    lines.append(score_line)

    # Line 3: Context
    if match["context"]:
        lines.append(f'👉 {match["context"]}')

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Output Formatters
# ---------------------------------------------------------------------------

def format_waybar(matches, active):
    """Output Waybar-compatible JSON with rich Pango tooltip."""
    if active is None:
        return json.dumps({
            "text": "🏏 IPL: No Live Matches",
            "tooltip": "No IPL matches found",
            "class": "idle",
        })

    # Build rich tooltip with all match scorecards
    cards = []
    for m in matches:
        cards.append(build_pango_scorecard(m))

    tooltip = "\n\n".join(cards) if cards else "No IPL matches"

    panel = f'🏏 {active["panel_text"]}'
    css_class = "live" if any(m["is_live"] for m in matches) else "idle"

    return json.dumps({"text": panel, "tooltip": tooltip, "class": css_class})


def format_text(matches, active):
    """Output plain text with scorecards for Polybar / XFCE Genmon."""
    if active is None:
        return "🏏 IPL: No Live Matches"

    sections = []
    for m in matches:
        sections.append(build_plain_scorecard(m))

    return "\n\n".join(sections)


def format_dwm(matches, active):
    """Output a single line for dwm's xsetroot -name."""
    if active is None:
        return "🏏 IPL: No Live Matches"
    panel = f'🏏 {active["panel_text"]}'
    if active["context"]:
        panel += f' | {active["context"]}'
    return panel


def format_xbar(matches, active):
    """Output xbar/SwiftBar-compatible format with scorecards for macOS."""
    if active is None:
        return "\n".join([
            "🏏 IPL: No Live Matches",
            "---",
            "No IPL matches found | color=gray",
            "---",
            "Refresh | refresh=true",
        ])

    lines = []

    # Line 1 — menu bar text
    lines.append(f'🏏 {active["panel_text"]}')
    lines.append("---")

    # Scorecards
    for m in matches:
        comps = m["competitors"]
        venue_line = ""
        if m["venue"]:
            venue_line = f'🏟️ {m["venue"]}'
        if m["match_num"]:
            venue_line += f' • {m["match_num"]}' if venue_line else f'🏟️ {m["match_num"]}'

        if venue_line:
            lines.append(f'{venue_line} | color=gray size=11')

        score_line = f'🏏 {comps[0]["abbr"]} {comps[0]["score"]} v {comps[1]["abbr"]} {comps[1]["score"]}'
        score_line = re.sub(r"  +", " ", score_line).strip()

        if m["is_live"]:
            lines.append(f'{score_line} | color=#FFD700 size=14 href={CRICINFO_LIVE}')
        elif m["is_finished"]:
            lines.append(f'{score_line} | size=14 href={CRICINFO_LIVE}')
        else:
            lines.append(f'{score_line} | size=14 href={CRICINFO_LIVE}')

        if m["context"]:
            if m["is_live"]:
                lines.append(f'👉 {m["context"]} | color=#FF4444 size=12')
            else:
                lines.append(f'👉 {m["context"]} | color=gray size=12')

        lines.append("---")

    lines.append("Refresh | refresh=true")
    return "\n".join(lines)


def format_mate(matches, active):
    """Output for MATE Desktop's Command Applet."""
    if active is None:
        return "🏏 IPL: No Live Matches"
    return f'🏏 {active["panel_text"]}'


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="IPL Live Score — Universal status bar script"
    )
    parser.add_argument(
        "--format",
        choices=["waybar", "text", "dwm", "xbar", "mate"],
        default="text",
        help="Output format",
    )
    args = parser.parse_args()

    # -----------------------------------------------------------------------
    # Gatekeeper Logic / Smart Caching
    # -----------------------------------------------------------------------
    CACHE_FILE = os.path.expanduser("~/.cache/ipl_score_cache.json")

    current_time = time.time()
    current_hour = datetime.datetime.now().hour

    fetch_live = True

    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r") as f:
                cache = json.load(f)

            cache_age = current_time - cache.get("timestamp", 0)
            is_match = cache.get("isMatchInProgress", False)
            outputs = cache.get("outputs", {})

            if is_match:
                fetch_live = True
            elif current_hour == 15 or 19 <= current_hour <= 23:
                fetch_live = True
            elif cache_age < 3600:
                if args.format in outputs:
                    print(outputs[args.format])
                    sys.exit(0)
            else:
                fetch_live = True
        except Exception:
            fetch_live = True

    # -----------------------------------------------------------------------
    # Core Logic
    # -----------------------------------------------------------------------
    if fetch_live:
        matches = fetch_and_parse()

        if matches is None:
            if args.format == "waybar":
                print(json.dumps({
                    "text": "🏏 IPL: Offline",
                    "tooltip": "Network error — could not reach ESPN API",
                    "class": "offline",
                }))
            elif args.format == "xbar":
                print("🏏 IPL: Offline\n---\nNetwork error | color=red\n---\nRefresh | refresh=true")
            else:
                print("🏏 IPL: Offline")
            sys.exit(0)

        # Priority Selector: Live > Started > Scheduled
        active = (
            next((m for m in matches if m["is_live"]), None)
            or next((m for m in matches if m["has_started"]), None)
            or (matches[0] if matches else None)
        )

        is_match_in_progress = any(
            m["has_started"] and not m["is_finished"] for m in matches
        )

        formatters = {
            "waybar": lambda: format_waybar(matches, active),
            "text": lambda: format_text(matches, active),
            "dwm": lambda: format_dwm(matches, active),
            "xbar": lambda: format_xbar(matches, active),
            "mate": lambda: format_mate(matches, active),
        }

        # Pre-render all formats
        rendered_outputs = {fmt: formatters[fmt]() for fmt in formatters}

        # -------------------------------------------------------------------
        # Save to Cache
        # -------------------------------------------------------------------
        cache_data = {
            "timestamp": current_time,
            "isMatchInProgress": is_match_in_progress,
            "outputs": rendered_outputs,
        }

        try:
            os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
            with open(CACHE_FILE, "w") as f:
                json.dump(cache_data, f)
        except Exception:
            pass

        print(rendered_outputs[args.format])


if __name__ == "__main__":
    main()

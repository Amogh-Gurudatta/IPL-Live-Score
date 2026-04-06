#!/usr/bin/env python3
"""
IPL Live Score — Universal Bar Script
Works with Waybar, Polybar, XFCE Genmon, dwm, and any status bar that reads stdout.

Usage:
    python3 ipl_score.py --format waybar     # JSON output for Waybar
    python3 ipl_score.py --format text       # Plain text for Polybar / XFCE Genmon
    python3 ipl_score.py --format dwm        # Single line for xsetroot -name

dwm usage (add to .xinitrc):
    while true; do xsetroot -name "$(python3 /path/to/ipl_score.py --format dwm)"; sleep 60; done &
"""

import argparse
import json
import re
import sys
import urllib.request
from xml.etree import ElementTree

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RSS_URL = "http://static.cricinfo.com/rss/livescores.xml"

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
# Core Logic
# ---------------------------------------------------------------------------

def is_match_finished(title: str) -> bool:
    """
    Determine whether a match has finished based on the score string.

    Rules:
      - If the chasing team's runs exceed the first team's runs → finished.
      - If either team is all out (wickets == 10) → finished.
    """
    scores = re.findall(r"\b(\d+)/(\d+)\b", title)

    if len(scores) < 2:
        return False

    runs1, wkts1 = int(scores[0][0]), int(scores[0][1])
    runs2, wkts2 = int(scores[1][0]), int(scores[1][1])

    if runs2 > runs1:
        return True
    if wkts1 == 10 or wkts2 == 10:
        return True

    return False


def shorten_title(title: str) -> str:
    """Replace full team names with abbreviations."""
    for full_name, abbr in IPL_TEAMS.items():
        title = title.replace(full_name, abbr)
    return title


def fetch_and_parse():
    """
    Fetch the RSS feed, extract IPL matches, and return a dict with:
        active_match: str | None
        ongoing:      list[str]
        completed:    list[str]
        scheduled:    list[str]
    """
    try:
        req = urllib.request.Request(RSS_URL, headers={
            "User-Agent": "IPL-Live-Score/1.0",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read().decode("utf-8")
    except Exception:
        return None

    try:
        root = ElementTree.fromstring(xml_data)
    except ElementTree.ParseError:
        return None

    ipl_matches = []

    for item in root.iter("item"):
        title_el = item.find("title")
        if title_el is None or not title_el.text:
            continue

        raw_title = title_el.text.strip()

        # Filter: must contain an IPL team name
        if not any(team in raw_title for team in TEAM_NAMES):
            continue

        # Shorten names
        shortened = shorten_title(raw_title)

        # Smart State Math
        has_asterisk = "*" in shortened
        has_started = bool(re.search(r"\d", shortened))
        finished = is_match_finished(shortened)
        is_live = has_asterisk and not finished

        # Replace '*' with 🏏 for display
        display_title = shortened.replace("*", "🏏")

        ipl_matches.append({
            "title": display_title,
            "is_live": is_live,
            "has_started": has_started,
            "is_finished": finished,
        })

    if not ipl_matches:
        return {
            "active_match": None,
            "ongoing": [],
            "completed": [],
            "scheduled": [],
        }

    # Reverse so newest matches come first
    ipl_matches.reverse()

    # Priority Selector: Live > Started > Scheduled
    active = (
        next((m for m in ipl_matches if m["is_live"]), None)
        or next((m for m in ipl_matches if m["has_started"]), None)
        or ipl_matches[0]
    )

    # Categorize the rest (excluding the active match)
    others = [m for m in ipl_matches if m is not active]
    ongoing = [m["title"] for m in others if m["is_live"]]
    completed = [m["title"] for m in others if m["is_finished"]]
    scheduled = [m["title"] for m in others if not m["has_started"]]

    return {
        "active_match": active["title"],
        "ongoing": ongoing,
        "completed": completed,
        "scheduled": scheduled,
    }


# ---------------------------------------------------------------------------
# Output Formatters
# ---------------------------------------------------------------------------

def build_tooltip(data: dict) -> str:
    """Build a categorized multi-line tooltip string."""
    sections = []

    if data["ongoing"]:
        sections.append("🔴 ONGOING\n" + "\n".join(f"  {m}" for m in data["ongoing"]))
    if data["completed"]:
        sections.append("✅ COMPLETED\n" + "\n".join(f"  {m}" for m in data["completed"]))
    if data["scheduled"]:
        sections.append("📅 SCHEDULED\n" + "\n".join(f"  {m}" for m in data["scheduled"]))

    return "\n\n".join(sections) if sections else "No other IPL matches"


def format_waybar(data: dict) -> str:
    """Output Waybar-compatible JSON to stdout."""
    if data["active_match"] is None:
        return json.dumps({
            "text": "🏏 IPL: No Live Matches",
            "tooltip": "No IPL matches found in the RSS feed",
            "class": "idle",
        })

    return json.dumps({
        "text": f"🏏 {data['active_match']}",
        "tooltip": build_tooltip(data),
        "class": "live" if data["ongoing"] else "idle",
    })


def format_text(data: dict) -> str:
    """Output plain text for Polybar / XFCE Genmon."""
    if data["active_match"] is None:
        return "🏏 IPL: No Live Matches"

    lines = [f"🏏 {data['active_match']}"]

    if data["ongoing"]:
        lines.append("")
        lines.append("🔴 ONGOING")
        lines.extend(f"  {m}" for m in data["ongoing"])

    if data["completed"]:
        lines.append("")
        lines.append("✅ COMPLETED")
        lines.extend(f"  {m}" for m in data["completed"])

    if data["scheduled"]:
        lines.append("")
        lines.append("📅 SCHEDULED")
        lines.extend(f"  {m}" for m in data["scheduled"])

    return "\n".join(lines)


def format_dwm(data: dict) -> str:
    """
    Output a single line for dwm's xsetroot -name.
    dwm has no tooltip or multiline support — just the active match.
    """
    if data["active_match"] is None:
        return "🏏 IPL: No Live Matches"
    return f"🏏 {data['active_match']}"


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="IPL Live Score — Universal status bar script"
    )
    parser.add_argument(
        "--format",
        choices=["waybar", "text", "dwm"],
        default="text",
        help="Output format: 'waybar' for JSON, 'text' for Polybar/XFCE, 'dwm' for xsetroot",
    )
    args = parser.parse_args()

    data = fetch_and_parse()

    if data is None:
        if args.format == "waybar":
            print(json.dumps({
                "text": "🏏 IPL: Offline",
                "tooltip": "Network error — could not reach Cricinfo RSS feed",
                "class": "offline",
            }))
        else:
            print("🏏 IPL: Offline")
        sys.exit(0)

    if args.format == "waybar":
        print(format_waybar(data))
    elif args.format == "dwm":
        print(format_dwm(data))
    else:
        print(format_text(data))


if __name__ == "__main__":
    main()

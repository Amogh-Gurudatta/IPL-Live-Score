# 🏏 IPL Live Score — GNOME Shell Extension

**Live IPL scores in your top bar. Zero dependencies. Zero API keys. Pure GNOME.**

A lightweight, native GNOME Shell extension that streams live Indian Premier League scores directly into your desktop panel. Built entirely in GJS with Soup 3 — no Python scrapers, no Node servers, no authentication tokens. Just install and watch.

---

## ✨ Features

### 📡 Live Score Ticker
- Displays the active IPL match score in the GNOME top bar using abbreviated team names (CSK, RCB, MI, etc.)
- The 🏏 emoji marks the currently batting team

### 🧠 Smart Polling Engine
- **Active Mode** — Locks into a configurable refresh rate (default 60s) when matches are live or scheduled
- **Toss Hunting** — Autonomously wakes up at **3 PM** and **7 PM** IST to detect new matches
- **Deep Sleep** — Drops to a 1-hour interval when no matches are active, saving battery and bandwidth
- **Network Resilience** — Automatically backs off to 1-hour polling if the network is down

### 📋 Native Dashboard Menu
Click the top bar score to open a categorized dropdown:
- 🔴 **ONGOING** — Live matches in progress
- ✅ **COMPLETED** — Finished matches with final scores
- 📅 **SCHEDULED** — Upcoming matches yet to start
- 🌐 **Open in Browser** — Jump straight to the match page on Cricinfo
- 📋 **Copy Score** — One-click copy to clipboard
- 🕐 **Last Updated** — Timestamp of the most recent fetch

### 🔔 Match-End Notifications
- Fires a native GNOME desktop notification the instant a match ends
- Notification history is **persisted to disk** via GSettings — no spam on reboot or session restart

### ⚙️ Preferences GUI
- **Refresh Interval** — Adjust the active polling rate (10–300 seconds) via a Libadwaita spin row
- **Favorite Team** — Pick your team from a dropdown. If they're playing:
  - The top bar score turns **gold** ✨
  - Their match is **always prioritized** in the panel, overriding the standard live → started → scheduled fallback

### 🏗️ Double-Header Ready
- On days with multiple IPL matches, the extension uses a 4-tier priority selector:
  1. **Favorite team** match (if set)
  2. **Currently live** match
  3. **Most recently started** match
  4. **Upcoming scheduled** match

---

## 📦 Installation

### From ZIP (Recommended)

```bash
gnome-extensions install ipl-live-score.zip
```

Log out and log back in (or restart GNOME Shell), then enable:

```bash
gnome-extensions enable ipl-live-score@amogh
```

### From Source

```bash
git clone https://github.com/amogh-kalalbandi/ipl-live-score-gnome-extension.git
cd ipl-live-score-gnome-extension

# Compile the GSettings schema
glib-compile-schemas schemas/

# Symlink into your local extensions directory
ln -sf "$(pwd)" ~/.local/share/gnome-shell/extensions/ipl-live-score@amogh
```

Log out and log back in, then enable the extension via GNOME Extensions or:

```bash
gnome-extensions enable ipl-live-score@amogh
```

---

## 🔧 Building from Source

The only build step is compiling the GSettings schema:

```bash
glib-compile-schemas schemas/
```

This generates the binary `gschemas.compiled` file that GNOME reads at runtime. Without this step, the extension will throw a `schema_id undefined` error on launch.

**No `npm install`. No `pip install`. No build toolchain.** The extension is pure GJS and runs directly in the GNOME Shell process.

---

## 🔬 Under the Hood

### Why RSS instead of a JSON REST API?

Most cricket score extensions rely on heavy JSON endpoints that require authentication tokens, rate-limit aggressively, or change their schema without warning. We took a different approach:

| | JSON REST API | RSS Feed |
|---|---|---|
| **Auth** | Tokens expire, get revoked | None required |
| **Rate Limits** | Aggressive (often 60 req/hr) | Effectively unlimited |
| **Payload Size** | 50–200 KB of nested JSON | ~5 KB of flat XML |
| **Schema Stability** | Breaks frequently | Unchanged for 10+ years |
| **Parsing** | Deep object traversal | Single regex extraction |

The extension fetches `http://static.cricinfo.com/rss/livescores.xml` — a tiny, static XML file that Cricinfo has served reliably for over a decade. We parse it with a single regex pass, filter for IPL team names, and abbreviate them for display. The entire fetch-parse-render cycle completes in under 5ms.

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  GNOME Shell                     │
│                                                  │
│  ┌──────────────┐    ┌────────────────────────┐  │
│  │  Top Bar      │    │  Dropdown Menu         │  │
│  │  St.Label     │◄───│  PopupMenu.Button      │  │
│  │  "CSK 182/4🏏"│    │  ├─ Open in Browser    │  │
│  └──────┬───────┘    │  ├─ Copy Score          │  │
│         │            │  ├─ 🔴 ONGOING          │  │
│         │            │  ├─ ✅ COMPLETED        │  │
│         │            │  ├─ 📅 SCHEDULED        │  │
│         │            │  └─ Refresh Now         │  │
│         │            └────────────────────────┘  │
│         │                                        │
│  ┌──────▼────────────────────────────────────┐   │
│  │  Polling Engine                            │   │
│  │  ├─ Active: 60s (match live)              │   │
│  │  ├─ Hunting: 60s (3 PM / 7 PM)           │   │
│  │  └─ Deep Sleep: 3600s (idle)              │   │
│  └──────┬────────────────────────────────────┘   │
│         │                                        │
│  ┌──────▼────────────────────────────────────┐   │
│  │  Soup 3 (HTTP)                             │   │
│  │  GET static.cricinfo.com/rss/livescores.xml│   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 🖥️ Compatibility

| GNOME Shell | Status |
|---|---|
| 45 | ✅ Supported |
| 46 | ✅ Supported |
| 47 | ✅ Supported |
| 48 | ✅ Supported |
| 49 | ✅ Supported |
| 50 | ✅ Supported |

---

## 📄 License

MIT

---

## 🙏 Credits

- **Data Source**: [ESPN Cricinfo](https://www.espncricinfo.com) RSS Feed
- **Platform**: [GNOME Shell Extensions](https://extensions.gnome.org)
- **GJS Guide**: [gjs.guide](https://gjs.guide/extensions/)

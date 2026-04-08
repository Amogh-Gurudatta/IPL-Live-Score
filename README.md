# 🏏 IPL Live Score — Desktop Extension (v3.0.0)

**Live IPL scores on your desktop. Any DE. Any OS. Zero fuss.**

A collection of native widgets and scripts that stream live Indian Premier League scores directly into your desktop panel — whether you use GNOME, KDE Plasma, COSMIC, Cinnamon, Sway/Hyprland, i3, dwm, XFCE, MATE, or macOS.

---

## ✨ Core Features

### 📡 Live Score Ticker
- Displays the active IPL match score in your panel using abbreviated team names (CSK, RCB, MI, etc.)
- Automatically prioritizes the most relevant match (Live > Completed > Scheduled).

### 📋 Rich Scorecards (New in v3.0)
All platforms now feature a multi-line "Scorecard" layout in the dropdown/menu:
- 🏟️ **Venue & Match Context**: See where the match is being played and the match number.
- 🏏 **Rich Scores**: Displaying runs, wickets, and overs inline.
- 👉 **Smart Status**: Live context like "RR won by 10 runs" or "Match delayed by rain" (highlighted in red when live).

### 🧠 Smart Polling & Battery Efficiency
- **WAF-Resistant**: Uses the unprotected ESPN Core API (bypassing the Akamai WAF blocks seen in v2.0).
- **Anti-Ban Jitter**: Randomized polling intervals (55–75s) to mimic human behavior.
- **Deep Sleep**: Automatically enters a 1-hour "Deep Sleep" during off-hours or when no matches are scheduled to save battery.

---

## 🖥️ Supported Platforms

| Platform | Type | Extension / Script Location | Status |
|---|---|---|---|
| **GNOME Shell 45–50** | Native Extension (GJS) | [`gnome-extension/`](gnome-extension/) | ✅ v3.0.0 Supported |
| **KDE Plasma 6** | Native Plasmoid (QML) | [`kde-plasmoid/`](kde-plasmoid/) | ✅ v3.0.0 Supported |
| **COSMIC** (System76) | Native Applet (Rust) | [`cosmic-applet/`](cosmic-applet/) | ✅ v3.0.0 Supported |
| **Cinnamon** (Linux Mint) | Native Applet (CJS) | [`cinnamon-applet/`](cinnamon-applet/) | ✅ v3.0.0 Supported |
| **macOS** (xbar/SwiftBar) | Python Script | [`universal-script/`](universal-script/) | ✅ v3.0.0 Supported |
| **Waybar** (Sway/Hyprland) | Python Script | [`universal-script/`](universal-script/) | ✅ v3.0.0 Supported |
| **Polybar** (i3/bspwm) | Python Script | [`universal-script/`](universal-script/) | ✅ v3.0.0 Supported |
| **dwm** | Python Script | [`universal-script/`](universal-script/) | ✅ v3.0.0 Supported |
| **XFCE Genmon** | Python Script | [`universal-script/`](universal-script/) | ✅ v3.0.0 Supported |
| **MATE Desktop** | Python Script | [`universal-script/`](universal-script/) | ✅ v3.0.0 Supported |

---

## 🚀 Installation & Usage

### Method 1: The Auto-Installer (Recommended)
Use the included `Makefile` to auto-detect your OS and Desktop Environment to install the correct widget.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Amogh-Gurudatta/IPL-Live-Score.git
   cd IPL-Live-Score
   ```

2. **Run the installer:**
   ```bash
   make install
   ```
   *This will evaluate your environment (`$XDG_CURRENT_DESKTOP`, `uname -s`, etc.) and automatically compile/install the correct widget.*

#### Manual Overrides
To force an installation for a specific environment (e.g., if auto-detect fails), run:
```bash
make help
```

---

### Method 2: Manual Install from GitHub Releases
Alternatively, download the pre-packaged files directly from the **[Releases](https://github.com/Amogh-Gurudatta/IPL-Live-Score/releases)** page:

#### 1. GNOME (`ipl-live-score-gnome.zip`)
1. Install via terminal: `gnome-extensions install ipl-live-score-gnome.zip`
2. Restart GNOME Shell and enable in the **Extensions** app.

#### 2. KDE Plasma (`ipl-live-score-kde.plasmoid`)
1. Install: `kpackagetool6 -i ipl-live-score-kde.plasmoid`
2. Add "IPL Live Score" to your panel via the Widgets menu.

#### 3. Cinnamon (`ipl-live-score-cinnamon.zip`)
1. Extract into `~/.local/share/cinnamon/applets/`
2. Enable in the **Applets** settings.

#### 4. Window Managers & macOS (`ipl_score.py`)
1. Copy `universal-script/ipl_score.py` to `~/.local/bin/ipl_score` and make it executable.
2. **Waybar Config**: `"exec": "~/.local/bin/ipl_score --format waybar", "return-type": "json"`
3. **xbar (macOS)**: Move to `~/Library/Application Support/xbar/plugins/ipl_score.1m.py`

---

## 🔬 Under the Hood

### The v3.0 Architecture
Previously, we relied on RSS feeds and HTML scraping, but these sources were often WAF-protected or low-accuracy. v3.0.0 migrates the entire monorepo to the **unprotected ESPN Core API**.

- **Reliability**: No Akamai WAF blocks or TLS fingerprinting requirements.
- **Rich Data**: Direct access to venue, status context, and formatted score strings.
- **Smart Jitter**: Polling randomized between 55–75 seconds to maintain high IP reputation.
- **Caching**: The Python script features a local JSON cache (`~/.cache/ipl_score_cache.json`) to throttle requests when panels like Waybar call the script blindly.

---

## 🙏 Credits

- **Data Source**: [ESPN Cricinfo](https://www.espncricinfo.com) Core API
- **GNOME**: [gjs.guide](https://gjs.guide/extensions/)
- **KDE**: [Plasma Developer Documentation](https://develop.kde.org/docs/plasma/)
- **COSMIC**: [System76 COSMIC](https://github.com/pop-os/cosmic-epoch)
- **Cinnamon**: [Linux Mint Developer Guide](https://projects.linuxmint.com/reference/git/cinnamon-tutorials/write-applet.html)
- **xbar**: [xbar Plugin API](https://github.com/matryer/xbar-plugins)

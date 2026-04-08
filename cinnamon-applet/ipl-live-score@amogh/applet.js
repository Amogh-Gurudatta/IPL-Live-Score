// IPL Live Score — Cinnamon Desktop Applet (v3.0.0)
// Data source: ESPN Core API (unprotected, no WAF).
//
// CRITICAL: Uses CJS-style imports (NOT GJS/ESM).

const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Lang = imports.lang;
const ByteArray = imports.byteArray;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = "https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket";
const CRICINFO_LIVE = "https://www.espncricinfo.com/live-cricket-scores";

const IPL_TEAMS = {
    "Chennai Super Kings": "CSK",
    "Delhi Capitals": "DC",
    "Gujarat Titans": "GT",
    "Kolkata Knight Riders": "KKR",
    "Lucknow Super Giants": "LSG",
    "Mumbai Indians": "MI",
    "Punjab Kings": "PBKS",
    "Rajasthan Royals": "RR",
    "Royal Challengers Bengaluru": "RCB",
    "Royal Challengers Bangalore": "RCB",
    "Sunrisers Hyderabad": "SRH",
};

const TEAM_NAMES = Object.keys(IPL_TEAMS);

// ---------------------------------------------------------------------------
// Data helpers (Pure Functions)
// ---------------------------------------------------------------------------

function getTeamAbbr(displayName, apiAbbr) {
    if (displayName in IPL_TEAMS) return IPL_TEAMS[displayName];
    return apiAbbr || displayName;
}

function extractMatchNum(description) {
    let m = (description || "").match(/^([\w\d]+(?:st|nd|rd|th)?\s+Match(?:\s*\([A-Z]\))?)/);
    return m ? m[1] : "";
}

function buildPanelText(competitors) {
    if (competitors.length < 2) return null;

    let parts = [];
    for (let i = 0; i < competitors.length; i++) {
        let comp = competitors[i];
        let displayName = comp.displayName || "";
        let apiAbbr = comp.abbreviation || comp.name || "";
        let abbr = getTeamAbbr(displayName, apiAbbr);
        let score = comp.score || "";
        parts.push(score ? abbr + " " + score : abbr);
    }

    return parts.join(" v ");
}

// ---------------------------------------------------------------------------
// Custom Scorecard Menu Item
// ---------------------------------------------------------------------------

class MatchMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(matchData) {
        super({ reactive: true, activate: true });

        this._link = matchData.link || CRICINFO_LIVE;

        let card = new St.BoxLayout({
            vertical: true,
            style: "padding: 6px 4px; spacing: 3px;",
        });

        // Line 1: Venue + Match Number (small, grey)
        let venueLine = "";
        if (matchData.venue) venueLine = "🏟️ " + matchData.venue;
        if (matchData.matchNum) {
            venueLine += venueLine ? " • " + matchData.matchNum : "🏟️ " + matchData.matchNum;
        }

        if (venueLine) {
            card.add_child(new St.Label({
                text: venueLine,
                style: "font-size: 0.85em; color: #888888;",
            }));
        }

        // Line 2: Score (bold, large)
        let comps = matchData.competitors || [];
        let scoreLine = "🏏";
        if (comps.length >= 2) {
            let t1 = (comps[0].abbr + " " + (comps[0].score || "")).trim();
            let t2 = (comps[1].abbr + " " + (comps[1].score || "")).trim();
            scoreLine = "🏏 " + t1 + " v " + t2;
        }

        card.add_child(new St.Label({
            text: scoreLine,
            style: "font-weight: bold; font-size: 1.1em;",
        }));

        // Line 3: Context / Status
        if (matchData.context) {
            let contextStyle = matchData.isLive
                ? "font-weight: bold; color: #FF4444; font-size: 0.95em;"
                : "color: #888888; font-size: 0.95em;";
            card.add_child(new St.Label({
                text: "👉 " + matchData.context,
                style: contextStyle,
            }));
        }

        this.addActor(card);
    }

    activate() {
        try {
            Gio.AppInfo.launch_default_for_uri(this._link, null);
        } catch (e) {
            global.logError("[IPL Live Score] Could not open URI: " + e.message);
        }
        super.activate();
    }
}

// ---------------------------------------------------------------------------
// Cinnamon Applet
// ---------------------------------------------------------------------------

class IplLiveScoreApplet extends Applet.TextIconApplet {

    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.metadata = metadata;
        this._orientation = orientation;
        this._instanceId = instanceId;

        // Panel appearance
        this.set_applet_icon_symbolic_name("applications-games-symbolic");
        this.set_applet_label("🏏 Loading IPL...");
        this.set_applet_tooltip("IPL Live Score — Click for details");

        // Build popup menu
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        // Soup session
        this._session = new Soup.Session();

        // Polling
        this._timeoutId = null;
        this._currentInterval = 3600;

        // Initial fetch
        this._fetchScore();
        this._startPolling();
    }

    // -----------------------------------------------------------------------
    // Applet lifecycle
    // -----------------------------------------------------------------------

    on_applet_clicked() {
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        this._stopPolling();
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }

    // -----------------------------------------------------------------------
    // Polling
    // -----------------------------------------------------------------------

    _adjustPollingRate(iplMatches) {
        const activeInterval = Math.floor(Math.random() * 21) + 55;
        const idleInterval = 3600;
        const hour = new Date().getHours();

        const isMatchInProgress = iplMatches.some(m => m.hasStarted && !m.isFinished);

        let nextIsActive = false;

        if (isMatchInProgress) {
            nextIsActive = true;
        } else if (hour === 15) {
            nextIsActive = true;
        } else if (hour >= 19 && hour <= 23) {
            nextIsActive = true;
        }

        const nextInterval = nextIsActive ? activeInterval : idleInterval;
        const wasActive = this._currentInterval < 3600;

        if (nextIsActive || wasActive !== nextIsActive) {
            global.log("[IPL Live Score] Polling Engine shifted to " + nextInterval + "s interval");
            this._currentInterval = nextInterval;
            this._stopPolling();
            this._startPolling();
        }
    }

    _startPolling() {
        this._stopPolling();
        this._timeoutId = Mainloop.timeout_add_seconds(this._currentInterval, () => {
            this._fetchScore();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _manualRefresh() {
        this._stopPolling();
        this._fetchScore();
        this._startPolling();
    }

    // -----------------------------------------------------------------------
    // Fallback menu
    // -----------------------------------------------------------------------

    _buildFallbackMenu(labelText) {
        this.menu.removeAll();
        this.set_applet_label(labelText);

        let infoItem = new PopupMenu.PopupMenuItem(labelText, { reactive: false });
        this.menu.addMenuItem(infoItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let refreshItem = new PopupMenu.PopupMenuItem("🔄 Refresh Now");
        refreshItem.connect("activate", () => this._manualRefresh());
        this.menu.addMenuItem(refreshItem);

        this._adjustPollingRate([]);
    }

    // -----------------------------------------------------------------------
    // Network — ESPN Core API
    // -----------------------------------------------------------------------

    _fetchScore() {
        if (!this._session) return;

        let message;
        try {
            message = Soup.Message.new("GET", API_URL);
        } catch (e) {
            global.logError("[IPL Live Score] Bad URL: " + e.message);
            this._buildFallbackMenu("🏏 IPL: Offline");
            return;
        }

        if (!message) {
            this._buildFallbackMenu("🏏 IPL: Offline");
            return;
        }

        message.get_request_headers().append("User-Agent", "Mozilla/5.0");

        try {
            this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        let bytes = session.send_and_read_finish(result);
                        let statusCode = message.get_status();
                        if (statusCode !== Soup.Status.OK) {
                            this._buildFallbackMenu("🏏 IPL: Offline");
                            return;
                        }

                        let data = bytes.get_data();
                        let text;
                        if (data instanceof Uint8Array) {
                            text = ByteArray.toString(data);
                        } else {
                            text = data.toString();
                        }

                        let apiData;
                        try {
                            apiData = JSON.parse(text);
                        } catch (parseError) {
                            this._buildFallbackMenu("🏏 IPL: Offline");
                            return;
                        }

                        let iplMatches = this._parseApiData(apiData);
                        this._processMatches(iplMatches);

                    } catch (innerError) {
                        global.logError("[IPL Live Score] Response error: " + innerError.message);
                        this._buildFallbackMenu("🏏 IPL: Offline");
                    }
                }
            );
        } catch (outerError) {
            global.logError("[IPL Live Score] Request error: " + outerError.message);
            this._buildFallbackMenu("🏏 IPL: Offline");
        }
    }

    _parseApiData(apiData) {
        let leagues;
        try {
            leagues = apiData.sports[0].leagues;
        } catch (e) {
            return [];
        }

        if (!leagues || !leagues.length) return [];

        let iplMatches = [];

        for (let l = 0; l < leagues.length; l++) {
            let events = leagues[l].events || [];
            for (let e = 0; e < events.length; e++) {
                let event = events[e];
                let eventName = event.name || "";

                let hasIplTeam = TEAM_NAMES.some(function(t) {
                    return eventName.indexOf(t) !== -1;
                });
                if (!hasIplTeam) continue;

                let competitors = event.competitors || [];
                if (competitors.length < 2) continue;

                let fullStatus = event.fullStatus || {};
                let statusType = fullStatus.type || {};
                let state = statusType.state || "";
                let statusDetail = statusType.detail || "";

                let isLive = state === "in";
                let hasStarted = state === "in" || state === "post";
                let isFinished = state === "post";

                let venue = event.location || "";
                let description = event.description || "";
                let matchNum = extractMatchNum(description);
                let context = fullStatus.summary || statusDetail;
                let link = (event.link || CRICINFO_LIVE).replace("www.espn.in", "www.espncricinfo.com");

                let panelText = buildPanelText(competitors);
                if (!panelText) continue;

                let compDetails = [];
                for (let ci = 0; ci < competitors.length; ci++) {
                    let comp = competitors[ci];
                    compDetails.push({
                        abbr: getTeamAbbr(comp.displayName || "", comp.abbreviation || comp.name || ""),
                        score: comp.score || "",
                        winner: comp.winner || false,
                    });
                }

                iplMatches.push({
                    panelText: panelText,
                    link: link,
                    isLive: isLive,
                    hasStarted: hasStarted,
                    isFinished: isFinished,
                    venue: venue,
                    matchNum: matchNum,
                    context: context,
                    competitors: compDetails,
                });
            }
        }

        return iplMatches;
    }

    // -----------------------------------------------------------------------
    // Match processing — builds Scorecard UI
    // -----------------------------------------------------------------------

    _processMatches(iplMatches) {
        if (iplMatches.length === 0) {
            this._buildFallbackMenu("🏏 IPL: No Live Matches");
            return;
        }

        // Priority Selector: Live > Started > Scheduled
        let activeMatch =
            iplMatches.find(function(m) { return m.isLive; }) ||
            iplMatches.find(function(m) { return m.hasStarted; }) ||
            iplMatches[0];

        let panelLabel = "🏏 " + activeMatch.panelText;
        this.set_applet_label(panelLabel);

        // Build the Dynamic Menu with Scorecards
        this.menu.removeAll();

        // Timestamp
        let now = new Date();
        let timeStr = now.toLocaleTimeString("en-GB", {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        let timeItem = new PopupMenu.PopupMenuItem(
            "Last Updated: " + timeStr, { reactive: false }
        );
        this.menu.addMenuItem(timeItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Render each match as a Scorecard
        for (let i = 0; i < iplMatches.length; i++) {
            this.menu.addMenuItem(new MatchMenuItem(iplMatches[i]));
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // Copy Score
        let copyItem = new PopupMenu.PopupMenuItem("📋 Copy Score");
        copyItem.connect("activate", function() {
            let clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, panelLabel);
        });
        this.menu.addMenuItem(copyItem);

        // Refresh Now
        let refreshItem = new PopupMenu.PopupMenuItem("🔄 Refresh Now");
        refreshItem.connect("activate", () => this._manualRefresh());
        this.menu.addMenuItem(refreshItem);

        // Smart Polling
        this._adjustPollingRate(iplMatches);
    }
}

// ---------------------------------------------------------------------------
// Export — Cinnamon entry point
// ---------------------------------------------------------------------------

function main(metadata, orientation, panelHeight, instanceId) {
    return new IplLiveScoreApplet(metadata, orientation, panelHeight, instanceId);
}

// IPL Live Score - GNOME Shell Extension (v3.0.0)
// Data source: ESPN Core API (unprotected, no WAF).
// Requires GNOME Shell 45+ (ESM architecture)

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = 'https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket';
const CRICINFO_LIVE = 'https://www.espncricinfo.com/live-cricket-scores';

// Full team name → short abbreviation
const IPL_TEAMS = {
    'Chennai Super Kings': 'CSK',
    'Delhi Capitals': 'DC',
    'Gujarat Titans': 'GT',
    'Kolkata Knight Riders': 'KKR',
    'Lucknow Super Giants': 'LSG',
    'Mumbai Indians': 'MI',
    'Punjab Kings': 'PBKS',
    'Rajasthan Royals': 'RR',
    'Royal Challengers Bengaluru': 'RCB',
    'Royal Challengers Bangalore': 'RCB',
    'Sunrisers Hyderabad': 'SRH',
};

const TEAM_NAMES = Object.keys(IPL_TEAMS);


// ---------------------------------------------------------------------------
// Custom Scorecard Menu Item
// ---------------------------------------------------------------------------

const MatchMenuItem = GObject.registerClass(
    class MatchMenuItem extends PopupMenu.PopupBaseMenuItem {

        _init(matchData) {
            super._init({ reactive: true, can_focus: true });

            this._link = matchData.link || CRICINFO_LIVE;

            // Vertical card layout
            const card = new St.BoxLayout({
                vertical: true,
                style: 'padding: 6px 4px; spacing: 3px;',
            });

            // Line 1: Venue + Match Number (small, grey)
            let venueLine = '';
            if (matchData.venue) venueLine = `🏟️ ${matchData.venue}`;
            if (matchData.matchNum)
                venueLine += venueLine ? ` • ${matchData.matchNum}` : `🏟️ ${matchData.matchNum}`;

            if (venueLine) {
                card.add_child(new St.Label({
                    text: venueLine,
                    style: 'font-size: 0.85em; color: #888888;',
                }));
            }

            // Line 2: Score (bold, large)
            const comps = matchData.competitors || [];
            let scoreLine = '🏏';
            if (comps.length >= 2) {
                const t1 = `${comps[0].abbr} ${comps[0].score || ''}`.trim();
                const t2 = `${comps[1].abbr} ${comps[1].score || ''}`.trim();
                scoreLine = `🏏 ${t1} v ${t2}`;
            }

            card.add_child(new St.Label({
                text: scoreLine,
                style: 'font-weight: bold; font-size: 1.1em;',
            }));

            // Line 3: Context / Status
            if (matchData.context) {
                const contextStyle = matchData.isLive
                    ? 'font-weight: bold; color: #FF4444; font-size: 0.95em;'
                    : 'color: #888888; font-size: 0.95em;';
                card.add_child(new St.Label({
                    text: `👉 ${matchData.context}`,
                    style: contextStyle,
                }));
            }

            this.add_child(card);

            // Click handler — open in browser
            this.connect('activate', () => {
                try {
                    Gio.AppInfo.launch_default_for_uri(this._link, null);
                } catch (e) {
                    console.error('[IPL Live Score] Could not open URI:', e.message);
                }
            });
        }
    }
);


// ---------------------------------------------------------------------------
// IPL Indicator — the panel widget
// ---------------------------------------------------------------------------

const IplIndicator = GObject.registerClass(
    class IplIndicator extends PanelMenu.Button {

        _init() {
            super._init(0.0, 'IPL Live Score', false);

            this._label = new St.Label({
                text: '🏏 Loading IPL...',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._label);
        }

        setLabel(text) {
            this._label.set_text(text);
        }

        setHighlight(highlight) {
            if (highlight) {
                this._label.set_style('color: #FFD700;');
            } else {
                this._label.set_style(null);
            }
        }

        destroy() {
            super.destroy();
        }
    }
);


// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default class IplLiveScoreExtension extends Extension {

    enable() {
        this._session = new Soup.Session();
        this._settings = this.getSettings();

        this._indicator = new IplIndicator();

        Main.panel.addToStatusArea(
            this.uuid,
            this._indicator,
            0,
            'center'
        );

        this._fetchScore();
        this._startPolling();

        this._settingsChangedId = this._settings.connect('changed::refresh-interval', () => {
            this._stopPolling();
            this._startPolling();
        });
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        this._stopPolling();

        if (this._session) {
            this._session.abort();
            this._session = null;
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    // -----------------------------------------------------------------------
    // Polling helpers
    // -----------------------------------------------------------------------

    _startPolling(interval = null) {
        this._currentInterval = interval || (this._settings?.get_int('refresh-interval') ?? 60);

        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this._currentInterval,
            () => {
                this._fetchScore();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopPolling() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

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
            console.log(`[IPL Live Score] Polling Engine shifted to ${nextInterval}s interval`);
            this._stopPolling();
            this._startPolling(nextInterval);
        }
    }

    _manualRefresh() {
        this._stopPolling();
        this._fetchScore();
        this._startPolling();
    }

    // -----------------------------------------------------------------------
    // Data helpers
    // -----------------------------------------------------------------------

    _getTeamAbbr(displayName, apiAbbr) {
        if (displayName in IPL_TEAMS) return IPL_TEAMS[displayName];
        return apiAbbr || displayName;
    }

    _extractMatchNum(description) {
        const m = (description || '').match(/^([\w\d]+(?:st|nd|rd|th)?\s+Match(?:\s*\([A-Z]\))?)/);
        return m ? m[1] : '';
    }

    _buildPanelText(competitors) {
        if (competitors.length < 2) return null;

        const parts = competitors.map(comp => {
            const displayName = comp?.displayName || '';
            const apiAbbr = comp?.abbreviation || comp?.name || '';
            const abbr = this._getTeamAbbr(displayName, apiAbbr);
            const score = comp?.score || '';
            return score ? `${abbr} ${score}` : abbr;
        });

        return parts.join(' v ');
    }

    // -----------------------------------------------------------------------
    // Fallback menu (offline / no matches)
    // -----------------------------------------------------------------------

    _buildFallbackMenu(labelText) {
        const menu = this._indicator.menu;
        menu.removeAll();

        this._indicator.setLabel(labelText);
        this._indicator.setHighlight(false);

        menu.addMenuItem(new PopupMenu.PopupMenuItem(labelText, {
            reactive: false,
        }));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Now');
        refreshItem.connect('activate', () => this._manualRefresh());
        menu.addMenuItem(refreshItem);
    }

    // -----------------------------------------------------------------------
    // Network — ESPN Core API
    // -----------------------------------------------------------------------

    _fetchScore() {
        if (!this._session || !this._indicator)
            return;

        let message;
        try {
            message = Soup.Message.new('GET', API_URL);
        } catch (e) {
            console.error('[IPL Live Score] Bad URL:', e.message);
            this._buildFallbackMenu('🏏 IPL: Offline');
            this._adjustPollingRate([]);
            return;
        }

        if (!message) {
            this._buildFallbackMenu('🏏 IPL: Offline');
            this._adjustPollingRate([]);
            return;
        }

        message.get_request_headers().append('User-Agent', 'Mozilla/5.0');

        try {
            this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const statusCode = message.get_status();
                        if (statusCode !== Soup.Status.OK) {
                            this._buildFallbackMenu('🏏 IPL: Offline');
                            this._adjustPollingRate([]);
                            return;
                        }

                        const decoder = new TextDecoder('utf-8');
                        const text = decoder.decode(bytes.get_data());

                        let apiData;
                        try {
                            apiData = JSON.parse(text);
                        } catch (parseError) {
                            this._buildFallbackMenu('🏏 IPL: Offline');
                            this._adjustPollingRate([]);
                            return;
                        }

                        const iplMatches = this._parseApiData(apiData);
                        this._processMatches(iplMatches);

                    } catch (innerError) {
                        console.error('[IPL Live Score] Response error:', innerError.message);
                        this._buildFallbackMenu('🏏 IPL: Offline');
                        this._adjustPollingRate([]);
                    }
                }
            );
        } catch (outerError) {
            console.error('[IPL Live Score] Request error:', outerError.message);
            this._buildFallbackMenu('🏏 IPL: Offline');
            this._adjustPollingRate([]);
        }
    }

    _parseApiData(apiData) {
        let leagues;
        try {
            leagues = apiData.sports[0].leagues;
        } catch (e) {
            return [];
        }

        if (!Array.isArray(leagues)) return [];

        const iplMatches = [];

        for (const league of leagues) {
            const events = league?.events || [];
            for (const event of events) {
                const eventName = event?.name || '';

                if (!TEAM_NAMES.some(t => eventName.includes(t)))
                    continue;

                const competitors = event?.competitors || [];
                if (competitors.length < 2) continue;

                const fullStatus = event?.fullStatus || {};
                const statusType = fullStatus?.type || {};
                const state = statusType?.state || '';
                const statusDetail = statusType?.detail || '';

                const isLive = state === 'in';
                const hasStarted = state === 'in' || state === 'post';
                const isFinished = state === 'post';

                const venue = event?.location || '';
                const description = event?.description || '';
                const matchNum = this._extractMatchNum(description);
                const context = fullStatus?.summary || statusDetail;
                const link = (event?.link || CRICINFO_LIVE).replace('www.espn.in', 'www.espncricinfo.com');

                const panelText = this._buildPanelText(competitors);
                if (!panelText) continue;

                const compDetails = competitors.map(comp => ({
                    abbr: this._getTeamAbbr(comp?.displayName || '', comp?.abbreviation || comp?.name || ''),
                    score: comp?.score || '',
                    winner: comp?.winner || false,
                }));

                iplMatches.push({
                    panelText,
                    link,
                    isLive,
                    hasStarted,
                    isFinished,
                    venue,
                    matchNum,
                    context,
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
            this._buildFallbackMenu('🏏 IPL: No Live Matches');
            this._adjustPollingRate([]);
            return;
        }

        // Priority Selector
        const favTeam = this._settings?.get_string('favorite-team') ?? 'None';

        let activeMatch =
            (favTeam !== 'None'
                ? iplMatches.find(m => m.panelText.includes(favTeam))
                : null) ??
            iplMatches.find(m => m.isLive) ??
            iplMatches.find(m => m.hasStarted) ??
            iplMatches[0];

        // Set panel bar text
        const panelLabel = `🏏 ${activeMatch.panelText}`;
        this._indicator.setLabel(panelLabel);
        this._indicator.setHighlight(
            favTeam !== 'None' && activeMatch.panelText.includes(favTeam)
        );

        // Match-End Notifications
        for (const m of iplMatches) {
            if (m.isFinished) {
                const matchTeamsId = m.competitors.map(c => c.abbr).sort().join('-');
                let notified = this._settings.get_strv('notified-matches');

                if (!notified.includes(matchTeamsId)) {
                    const comps = m.competitors;
                    const notifText = `${comps[0].abbr} ${comps[0].score} v ${comps[1].abbr} ${comps[1].score}`;
                    Main.notify('IPL Match Finished!', `${notifText}\n${m.context || ''}`);
                    notified.push(matchTeamsId);
                    if (notified.length > 5) notified.shift();
                    this._settings.set_strv('notified-matches', notified);
                }
            }
        }

        // Build Dynamic Menu with Scorecards
        const menu = this._indicator.menu;
        menu.removeAll();

        // Timestamp
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        menu.addMenuItem(new PopupMenu.PopupMenuItem(
            `Last Updated: ${timeStr}`, { reactive: false }
        ));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Render each match as a Scorecard
        for (const matchData of iplMatches) {
            menu.addMenuItem(new MatchMenuItem(matchData));
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // Copy Score
        const copyItem = new PopupMenu.PopupMenuItem('📋 Copy Score');
        copyItem.connect('activate', () => {
            St.Clipboard.get_default().set_text(
                St.ClipboardType.CLIPBOARD,
                panelLabel
            );
        });
        menu.addMenuItem(copyItem);

        // Refresh Now
        const refreshItem = new PopupMenu.PopupMenuItem('🔄 Refresh Now');
        refreshItem.connect('activate', () => this._manualRefresh());
        menu.addMenuItem(refreshItem);

        this._adjustPollingRate(iplMatches);
    }
}

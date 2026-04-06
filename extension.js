// IPL Live Score - GNOME Shell Extension
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

const API_URL = 'http://static.cricinfo.com/rss/livescores.xml';

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

    _adjustPollingRate(ongoingMatches, scheduledMatches) {
        const activeInterval = this._settings?.get_int('refresh-interval') ?? 60;
        const idleInterval = 3600;
        const hour = new Date().getHours();
        
        let nextInterval;
        
        if (ongoingMatches.length > 0 || scheduledMatches.length > 0) {
            nextInterval = activeInterval;
        } else if (hour === 15 || hour === 19) {
            nextInterval = activeInterval;
        } else {
            nextInterval = idleInterval;
        }
        
        if (this._currentInterval !== nextInterval) {
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
    // Match-end detection
    // -----------------------------------------------------------------------

    /**
     * Determine whether a match has finished based on the abbreviated score.
     *
     * Rules:
     *   - If the chasing team's runs exceed the first team's runs → finished.
     *   - If either team is all out (wickets === 10) → finished.
     *
     * @param {string} title  e.g. "DC 164/4 (20 ov) v MI 166/6 (19.3 ov)"
     * @returns {boolean}
     */
    _isMatchFinished(title) {
        const scoreRegex = /\b(\d+)\/(\d+)\b/g;
        const scores = [...title.matchAll(scoreRegex)];

        if (scores.length < 2)
            return false;

        const runs1 = parseInt(scores[0][1], 10);
        const wkts1 = parseInt(scores[0][2], 10);
        const runs2 = parseInt(scores[1][1], 10);
        const wkts2 = parseInt(scores[1][2], 10);

        if (runs2 > runs1)
            return true;

        if (wkts1 === 10 || wkts2 === 10)
            return true;

        return false;
    }

    // -----------------------------------------------------------------------
    // Smart string processing
    // -----------------------------------------------------------------------

    /**
     * Shorten full team names to abbreviations.
     * Does NOT touch the '*' character — that is evaluated separately
     * for the isLive flag before being replaced with 🏏.
     *
     * @param {string} titleText
     * @returns {string}
     */
    _shortenTitle(titleText) {
        let shortened = titleText;

        for (const [fullName, abbr] of Object.entries(IPL_TEAMS)) {
            shortened = shortened.replaceAll(fullName, abbr);
        }

        return shortened;
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
    // Network — Soup 3 async fetch
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
            this._stopPolling();
            this._startPolling(3600);
            return;
        }

        if (!message) {
            console.error('[IPL Live Score] Could not create Soup.Message');
            this._buildFallbackMenu('🏏 IPL: Offline');
            this._stopPolling();
            this._startPolling(3600);
            return;
        }

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
                            console.warn(`[IPL Live Score] HTTP ${statusCode}`);
                            this._buildFallbackMenu('🏏 IPL: Offline');
                            this._stopPolling();
                            this._startPolling(3600);
                            return;
                        }

                        // Decode to text
                        const decoder = new TextDecoder('utf-8');
                        const text = decoder.decode(bytes.get_data());

                        // Advanced regex — captures both <title> and <link>
                        const matchRegex = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<\/item>/gi;

                        const teamNames = Object.keys(IPL_TEAMS);
                        const iplMatches = [];

                        // ---------------------------------------------------
                        // 1. Extract and Clean Data
                        // ---------------------------------------------------
                        for (const m of text.matchAll(matchRegex)) {
                            const titleText = m[1] || '';
                            const linkText = (m[2] || '').trim();

                            if (titleText.includes('Cricinfo Live Scores') || titleText.trim() === '')
                                continue;

                            const isIplMatch = teamNames.some(team => titleText.includes(team));
                            if (!isIplMatch)
                                continue;

                            // Shorten team names
                            const shortened = this._shortenTitle(titleText);

                            // -----------------------------------------------
                            // 2. Bulletproof State Tracking
                            // -----------------------------------------------
                            const hasAsterisk = shortened.includes('*');
                            const hasStarted = /\d/.test(shortened);
                            const isFinished = this._isMatchFinished(shortened);

                            // A match is live ONLY if it has the batting
                            // indicator AND hasn't already ended
                            const isLive = hasAsterisk && !isFinished;

                            // Replace '*' with 🏏 for display
                            const displayTitle = shortened.replaceAll('*', '🏏');

                            iplMatches.push({
                                title: displayTitle,
                                link: linkText,
                                isLive,
                                hasStarted,
                                isFinished,
                            });
                        }

                        if (iplMatches.length === 0) {
                            this._buildFallbackMenu('🏏 IPL: No Live Matches');
                            this._adjustPollingRate([], []);
                            return;
                        }

                        // ---------------------------------------------------
                        // 3. Reverse so newest matches come first
                        // ---------------------------------------------------
                        iplMatches.reverse();

                        // ---------------------------------------------------
                        // 4. Priority Selector
                        // ---------------------------------------------------
                        const favTeam = this._settings?.get_string('favorite-team') ?? 'None';

                        let activeMatch =
                            (favTeam !== 'None'
                                ? iplMatches.find(m => m.title.includes(favTeam))
                                : null) ??
                            iplMatches.find(m => m.isLive) ??
                            iplMatches.find(m => m.hasStarted) ??
                            iplMatches[0];

                        // ---------------------------------------------------
                        // 5. Match-End Notifications
                        // ---------------------------------------------------
                        for (const m of iplMatches) {
                            if (m.isFinished) {
                                const matchTeamsId = Array.from(new Set(Object.values(IPL_TEAMS)))
                                    .filter(abbr => m.title.includes(abbr))
                                    .sort()
                                    .join('-');

                                let notified = this._settings.get_strv('notified-matches');

                                if (!notified.includes(matchTeamsId)) {
                                    Main.notify('IPL Match Finished!', m.title);

                                    notified.push(matchTeamsId);

                                    // Cap at 5 matches to avoid unbounded growth
                                    if (notified.length > 5) {
                                        notified.shift();
                                    }

                                    this._settings.set_strv('notified-matches', notified);
                                }
                            }
                        }

                        // ---------------------------------------------------
                        // 6. Build the Dynamic Menu
                        // ---------------------------------------------------
                        const menu = this._indicator.menu;
                        menu.removeAll();

                        const scoreText = activeMatch.title;
                        const scoreLink = activeMatch.link;

                        // Top bar label
                        this._indicator.setLabel(scoreText);
                        this._indicator.setHighlight(
                            favTeam !== 'None' && scoreText.includes(favTeam)
                        );

                        // --- Timestamp ---
                        const now = new Date();
                        const timeStr = now.toLocaleTimeString('en-GB', {
                            hour: '2-digit', minute: '2-digit', second: '2-digit',
                        });
                        menu.addMenuItem(new PopupMenu.PopupMenuItem(
                            `Last Updated: ${timeStr}`, { reactive: false }
                        ));
                        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                        // --- Open in Browser ---
                        const openItem = new PopupMenu.PopupMenuItem('🌐 Open Match in Browser');
                        openItem.connect('activate', () => {
                            try {
                                Gio.AppInfo.launch_default_for_uri(scoreLink, null);
                            } catch (e) {
                                console.error('[IPL Live Score] Could not open URI:', e.message);
                            }
                        });
                        menu.addMenuItem(openItem);

                        // --- Copy Score ---
                        const copyItem = new PopupMenu.PopupMenuItem('📋 Copy Score');
                        copyItem.connect('activate', () => {
                            St.Clipboard.get_default().set_text(
                                St.ClipboardType.CLIPBOARD,
                                scoreText
                            );
                        });
                        menu.addMenuItem(copyItem);
                        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                        // --- Categorize remaining matches ---
                        const otherMatches = iplMatches.filter(m => m !== activeMatch);

                        const ongoingMatches = otherMatches.filter(m => m.isLive);
                        const completedMatches = otherMatches.filter(m => m.isFinished);
                        const scheduledMatches = otherMatches.filter(m => !m.hasStarted);

                        const addCategory = (categoryTitle, matchesArray) => {
                            if (matchesArray.length === 0) return;

                            // Non-reactive bold header
                            let header = new PopupMenu.PopupMenuItem(categoryTitle, { reactive: false });
                            header.label.set_style('font-weight: bold; font-size: 0.9em; color: #aaaaaa;');
                            menu.addMenuItem(header);

                            // Clickable match items
                            matchesArray.forEach(match => {
                                let item = new PopupMenu.PopupMenuItem(`  ${match.title}`);
                                item.connect('activate', () => {
                                    try {
                                        Gio.AppInfo.launch_default_for_uri(match.link, null);
                                    } catch (e) {
                                        console.error('[IPL Live Score] Could not open URI:', e.message);
                                    }
                                });
                                menu.addMenuItem(item);
                            });
                            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                        };

                        addCategory('🔴 ONGOING', ongoingMatches);
                        addCategory('✅ COMPLETED', completedMatches);
                        addCategory('📅 SCHEDULED', scheduledMatches);

                        // --- Refresh Now ---
                        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Now');
                        refreshItem.connect('activate', () => this._manualRefresh());
                        menu.addMenuItem(refreshItem);

                        // Use the entire list of matches to evaluate the polling engine state
                        const allOngoing = iplMatches.filter(m => m.isLive);
                        const allScheduled = iplMatches.filter(m => !m.hasStarted);
                        this._adjustPollingRate(allOngoing, allScheduled);

                    } catch (innerError) {
                        console.error('[IPL Live Score] Response error:', innerError.message);
                        this._buildFallbackMenu('🏏 IPL: Offline');
                        this._stopPolling();
                        this._startPolling(3600);
                    }
                }
            );
        } catch (outerError) {
            console.error('[IPL Live Score] Request error:', outerError.message);
            this._buildFallbackMenu('🏏 IPL: Offline');
            this._stopPolling();
            this._startPolling(3600);
        }
    }
}

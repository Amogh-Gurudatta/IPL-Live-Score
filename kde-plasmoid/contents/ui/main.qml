import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    readonly property string apiUrl: "https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket"
    readonly property string cricinfoLive: "https://www.espncricinfo.com/live-cricket-scores"
    property int pollInterval: 3600000

    readonly property var iplTeams: ({
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
        "Sunrisers Hyderabad": "SRH"
    })

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    property string activeMatchText: "🏏 Loading IPL..."
    property var matchCards: []   // Array of {venue, matchNum, scoreLine, context, isLive, link}

    // -----------------------------------------------------------------------
    // Compact Representation (panel bar text)
    // -----------------------------------------------------------------------

    compactRepresentation: PlasmaComponents.Label {
        text: root.activeMatchText
        font.pixelSize: Kirigami.Theme.defaultFont.pixelSize
        Layout.minimumWidth: implicitWidth
        Layout.preferredWidth: implicitWidth

        MouseArea {
            anchors.fill: parent
            onClicked: root.expanded = !root.expanded
        }
    }

    // -----------------------------------------------------------------------
    // Full Representation (expanded popup with Scorecards)
    // -----------------------------------------------------------------------

    fullRepresentation: ColumnLayout {
        spacing: Kirigami.Units.smallSpacing
        Layout.preferredWidth: Kirigami.Units.gridUnit * 24
        Layout.preferredHeight: implicitHeight
        Layout.minimumHeight: Kirigami.Units.gridUnit * 8
        Layout.maximumHeight: Kirigami.Units.gridUnit * 35

        // Active match header
        PlasmaComponents.Label {
            text: root.activeMatchText
            font.bold: true
            font.pixelSize: Kirigami.Theme.defaultFont.pixelSize * 1.1
            Layout.fillWidth: true
            Layout.bottomMargin: Kirigami.Units.smallSpacing
            horizontalAlignment: Text.AlignHCenter
        }

        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: Kirigami.Theme.disabledTextColor
            opacity: 0.3
        }

        // Scrollable scorecard list
        QQC2.ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ColumnLayout {
                width: parent.width
                spacing: 0

                Repeater {
                    model: root.matchCards

                    // Each Scorecard
                    delegate: Item {
                        Layout.fillWidth: true
                        implicitHeight: cardColumn.implicitHeight + separator.height + Kirigami.Units.smallSpacing * 2

                        ColumnLayout {
                            id: cardColumn
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            anchors.margins: Kirigami.Units.smallSpacing
                            spacing: 2

                            // Line 1: Venue + Match Num (small, grey)
                            PlasmaComponents.Label {
                                text: modelData.venueLine || ""
                                visible: modelData.venueLine !== ""
                                font.pixelSize: Kirigami.Theme.defaultFont.pixelSize * 0.85
                                color: Kirigami.Theme.disabledTextColor
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                            }

                            // Line 2: Score (bold, large)
                            PlasmaComponents.Label {
                                text: modelData.scoreLine
                                font.bold: true
                                font.pixelSize: Kirigami.Theme.defaultFont.pixelSize * 1.1
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                            }

                            // Line 3: Context (red+bold if live, grey otherwise)
                            PlasmaComponents.Label {
                                text: modelData.contextLine || ""
                                visible: modelData.contextLine !== ""
                                font.bold: modelData.isLive
                                font.pixelSize: Kirigami.Theme.defaultFont.pixelSize * 0.95
                                color: modelData.isLive ? "#FF4444" : Kirigami.Theme.disabledTextColor
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                            }
                        }

                        // Separator
                        Rectangle {
                            id: separator
                            anchors.bottom: parent.bottom
                            anchors.left: parent.left
                            anchors.right: parent.right
                            height: 1
                            color: Kirigami.Theme.disabledTextColor
                            opacity: 0.2
                        }

                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: Qt.openUrlExternally(modelData.link || root.cricinfoLive)
                        }
                    }
                }

                // No matches fallback
                Repeater {
                    model: root.matchCards.length === 0 ? 1 : 0
                    PlasmaComponents.Label {
                        text: "No IPL matches found"
                        color: Kirigami.Theme.disabledTextColor
                        Layout.fillWidth: true
                        horizontalAlignment: Text.AlignHCenter
                        Layout.topMargin: Kirigami.Units.gridUnit
                    }
                }
            }
        }

        // Separator
        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: Kirigami.Theme.disabledTextColor
            opacity: 0.3
        }

        // Refresh button
        QQC2.Button {
            text: "Refresh Now"
            icon.name: "view-refresh"
            Layout.fillWidth: true
            onClicked: {
                pollTimer.restart();
                fetchScores();
            }
        }
    }

    // -----------------------------------------------------------------------
    // Data helpers (JS)
    // -----------------------------------------------------------------------

    function getTeamAbbr(displayName, apiAbbr) {
        var keys = Object.keys(root.iplTeams);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] === displayName) return root.iplTeams[keys[i]];
        }
        return apiAbbr || displayName;
    }

    function extractMatchNum(description) {
        var m = (description || "").match(/^([\w\d]+(?:st|nd|rd|th)?\s+Match(?:\s*\([A-Z]\))?)/);
        return m ? m[1] : "";
    }

    function buildPanelText(competitors) {
        if (competitors.length < 2) return null;

        var parts = [];
        for (var i = 0; i < competitors.length; i++) {
            var comp = competitors[i];
            var displayName = comp.displayName || "";
            var apiAbbr = comp.abbreviation || comp.name || "";
            var abbr = getTeamAbbr(displayName, apiAbbr);
            var score = comp.score || "";
            parts.push(score ? abbr + " " + score : abbr);
        }

        return parts.join(" v ");
    }

    // -----------------------------------------------------------------------
    // Network: ESPN Core API
    // -----------------------------------------------------------------------

    function fetchScores() {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;

            if (xhr.status !== 200) {
                root.activeMatchText = "🏏 IPL: Offline";
                root.matchCards = [];
                root.pollInterval = 3600000;
                return;
            }

            var apiData;
            try {
                apiData = JSON.parse(xhr.responseText);
            } catch (e) {
                root.activeMatchText = "🏏 IPL: Offline";
                root.matchCards = [];
                root.pollInterval = 3600000;
                return;
            }

            processApiData(apiData);
        };

        xhr.open("GET", root.apiUrl);
        xhr.setRequestHeader("User-Agent", "Mozilla/5.0");
        xhr.send();
    }

    function processApiData(apiData) {
        var leagues;
        try {
            leagues = apiData.sports[0].leagues;
        } catch (e) {
            root.activeMatchText = "🏏 IPL: No Live Matches";
            root.matchCards = [];
            root.pollInterval = 3600000;
            return;
        }

        if (!leagues || !leagues.length) {
            root.activeMatchText = "🏏 IPL: No Live Matches";
            root.matchCards = [];
            root.pollInterval = 3600000;
            return;
        }

        var teamNames = Object.keys(root.iplTeams);
        var iplMatches = [];

        for (var l = 0; l < leagues.length; l++) {
            var events = leagues[l].events || [];
            for (var e = 0; e < events.length; e++) {
                var event = events[e];
                var eventName = event.name || "";

                var hasIplTeam = false;
                for (var t = 0; t < teamNames.length; t++) {
                    if (eventName.indexOf(teamNames[t]) !== -1) {
                        hasIplTeam = true;
                        break;
                    }
                }
                if (!hasIplTeam) continue;

                var competitors = event.competitors || [];
                if (competitors.length < 2) continue;

                var fullStatus = event.fullStatus || {};
                var statusType = fullStatus.type || {};
                var state = statusType.state || "";
                var statusDetail = statusType.detail || "";

                var isLive = state === "in";
                var hasStarted = state === "in" || state === "post";
                var isFinished = state === "post";

                var venue = event.location || "";
                var description = event.description || "";
                var matchNum = extractMatchNum(description);
                var context = fullStatus.summary || statusDetail;
                var link = (event.link || root.cricinfoLive).replace("www.espn.in", "www.espncricinfo.com");

                var panelText = buildPanelText(competitors);
                if (!panelText) continue;

                // Build scorecard data
                var venueLine = "";
                if (venue) venueLine = "🏟️ " + venue;
                if (matchNum) {
                    venueLine += venueLine ? " • " + matchNum : "🏟️ " + matchNum;
                }

                var comp0Abbr = getTeamAbbr(competitors[0].displayName || "", competitors[0].abbreviation || competitors[0].name || "");
                var comp1Abbr = getTeamAbbr(competitors[1].displayName || "", competitors[1].abbreviation || competitors[1].name || "");
                var comp0Score = competitors[0].score || "";
                var comp1Score = competitors[1].score || "";
                var t1 = (comp0Abbr + " " + comp0Score).trim();
                var t2 = (comp1Abbr + " " + comp1Score).trim();
                var scoreLine = "🏏 " + t1 + " v " + t2;

                var contextLine = context ? "👉 " + context : "";

                iplMatches.push({
                    panelText: panelText,
                    venueLine: venueLine,
                    scoreLine: scoreLine,
                    contextLine: contextLine,
                    isLive: isLive,
                    hasStarted: hasStarted,
                    isFinished: isFinished,
                    link: link
                });
            }
        }

        if (iplMatches.length === 0) {
            root.activeMatchText = "🏏 IPL: No Live Matches";
            root.matchCards = [];
            root.pollInterval = 3600000;
            return;
        }

        // Priority Selector
        var active = null;
        for (var i = 0; i < iplMatches.length; i++) {
            if (iplMatches[i].isLive) { active = iplMatches[i]; break; }
        }
        if (!active) {
            for (var j = 0; j < iplMatches.length; j++) {
                if (iplMatches[j].hasStarted) { active = iplMatches[j]; break; }
            }
        }
        if (!active) active = iplMatches[0];

        root.activeMatchText = "🏏 " + active.panelText;
        root.matchCards = iplMatches;

        // Smart Polling with Jitter
        var isMatchInProgress = false;
        for (var mIdx = 0; mIdx < iplMatches.length; mIdx++) {
            if (iplMatches[mIdx].hasStarted && !iplMatches[mIdx].isFinished) {
                isMatchInProgress = true;
                break;
            }
        }
        var hour = new Date().getHours();
        if (isMatchInProgress || hour === 15 || (hour >= 19 && hour <= 23)) {
            root.pollInterval = (Math.floor(Math.random() * 21) + 55) * 1000;
        } else {
            root.pollInterval = 3600000;
        }
    }

    // -----------------------------------------------------------------------
    // Timer
    // -----------------------------------------------------------------------

    Timer {
        id: pollTimer
        interval: root.pollInterval
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: fetchScores()
    }
}

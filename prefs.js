// IPL Live Score - Extension Preferences
// Requires GNOME Shell 45+ (ESM architecture)

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class IplLiveScorePreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        // Fetch the GSettings bound to our schema
        const settings = this.getSettings('org.gnome.shell.extensions.iplscore');

        // Create the core layout structure
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'General Configuration',
            description: 'Tweak the behavior of the IPL Live Score indicator',
        });
        page.add(group);

        // -------------------------------------------------------------------
        // 1. Refresh Interval (Adw.SpinRow)
        // -------------------------------------------------------------------
        
        // AdwSpinRow was introduced in Libadwaita 1.4 (GNOME 45+)
        const refreshRow = new Adw.SpinRow({
            title: 'Refresh Interval',
            subtitle: 'How often to fetch the latest scores (seconds)',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 300,
                step_increment: 5,
            }),
        });

        // Automatically bind the integer key to the SpinRow's 'value' property
        settings.bind(
            'refresh-interval',
            refreshRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        group.add(refreshRow);


        // -------------------------------------------------------------------
        // 2. Favorite Team (Adw.ComboRow)
        // -------------------------------------------------------------------
        
        const TEAMS = [
            'None', 'CSK', 'DC', 'GT', 'KKR', 'LSG', 
            'MI', 'PBKS', 'RR', 'RCB', 'SRH'
        ];

        // Create a StringList model for the dropdown
        const model = Gtk.StringList.new(TEAMS);

        const teamRow = new Adw.ComboRow({
            title: 'Favorite Team',
            subtitle: 'Prioritize this team when displaying the top bar score',
            model: model,
        });

        // Sync initial state from GSettings
        const currentFavorite = settings.get_string('favorite-team');
        const selectedIndex = TEAMS.indexOf(currentFavorite);
        if (selectedIndex !== -1) {
            teamRow.set_selected(selectedIndex);
        }

        // Listen for user changes in the UI and write back to GSettings
        teamRow.connect('notify::selected', () => {
            const newIndex = teamRow.get_selected();
            const selectedStr = TEAMS[newIndex];
            settings.set_string('favorite-team', selectedStr);
        });

        // Also listen for external backend changes to keep UI in sync
        settings.connect('changed::favorite-team', () => {
            const externalVal = settings.get_string('favorite-team');
            const idx = TEAMS.indexOf(externalVal);
            if (idx !== -1 && teamRow.get_selected() !== idx) {
                teamRow.set_selected(idx);
            }
        });

        group.add(teamRow);

        // Add the assembled page to the actual Preferences window
        window.add(page);
    }
}

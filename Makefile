.PHONY: help detect install install-gnome install-kde install-cinnamon install-mac install-cosmic install-script

# Colors for terminal output
BOLD := $(shell tput bold 2>/dev/null || echo '')
GREEN := $(shell tput setaf 2 2>/dev/null || echo '')
CYAN := $(shell tput setaf 6 2>/dev/null || echo '')
YELLOW := $(shell tput setaf 3 2>/dev/null || echo '')
RESET := $(shell tput sgr0 2>/dev/null || echo '')

OS := $(shell uname -s)
DESKTOP := $(shell echo "$$XDG_CURRENT_DESKTOP $$DESKTOP_SESSION" | tr '[:upper:]' '[:lower:]')

# Detect Target
TARGET_ENV := script

ifeq ($(OS), Darwin)
	TARGET_ENV = mac
else
	ifneq (,$(findstring gnome,$(DESKTOP)))
		TARGET_ENV = gnome
	else ifneq (,$(findstring kde,$(DESKTOP)))
		TARGET_ENV = kde
	else ifneq (,$(findstring plasma,$(DESKTOP)))
		TARGET_ENV = kde
	else ifneq (,$(findstring cinnamon,$(DESKTOP)))
		TARGET_ENV = cinnamon
	else ifneq (,$(findstring cosmic,$(DESKTOP)))
		TARGET_ENV = cosmic
	else ifneq (,$(findstring xfce,$(DESKTOP)))
		TARGET_ENV = script
	else ifneq (,$(findstring mate,$(DESKTOP)))
		TARGET_ENV = script
	else
		TARGET_ENV = script
	endif
endif

help:
	@echo "$(BOLD)🏏 IPL Live Score — Auto-Detecting Makefile$(RESET)"
	@echo ""
	@echo "Usage:"
	@echo "  $(CYAN)make install$(RESET)           Auto-detect your OS/DE and install the correct version."
	@echo "  $(CYAN)make detect$(RESET)            Check what environment make would auto-detect."
	@echo ""
	@echo "Manual Overrides:"
	@echo "  $(YELLOW)make install-gnome$(RESET)     Install the GNOME Shell extension."
	@echo "  $(YELLOW)make install-kde$(RESET)       Install the KDE Plasma 6 plasmoid."
	@echo "  $(YELLOW)make install-cinnamon$(RESET)  Install the Cinnamon applet."
	@echo "  $(YELLOW)make install-cosmic$(RESET)    Compile and install the COSMIC applet."
	@echo "  $(YELLOW)make install-mac$(RESET)       Install the macOS xbar/SwiftBar script."
	@echo "  $(YELLOW)make install-script$(RESET)    Install the Universal Script (Waybar, Polybar, dwm, etc.)"
	@echo ""

detect:
	@echo "$(BOLD)Detected Environment:$(RESET)"
	@echo "  OS:      $(OS)"
	@echo "  Desktop: $(DESKTOP)"
	@echo "  Target:  $(GREEN)install-$(TARGET_ENV)$(RESET)"
	@echo ""

install: detect
	@echo "$(BOLD)Starting Installation...$(RESET)"
	@$(MAKE) install-$(TARGET_ENV)

install-gnome:
	@echo "$(CYAN)Installing GNOME extension...$(RESET)"
	@cd gnome-extension && zip -qr ../ipl-live-score@amogh.shell-extension.zip *
	@gnome-extensions install --force ipl-live-score@amogh.shell-extension.zip
	@glib-compile-schemas ~/.local/share/gnome-shell/extensions/ipl-live-score@amogh/schemas/
	@rm ipl-live-score@amogh.shell-extension.zip
	@echo "$(GREEN)✅ GNOME Extension installed! Please log out or restart GNOME Shell to apply.$(RESET)"

install-kde:
	@echo "$(CYAN)Installing KDE Plasmoid...$(RESET)"
	@kpackagetool6 -i ./kde-plasmoid || kpackagetool6 -u ./kde-plasmoid
	@echo "$(GREEN)✅ KDE Plasmoid installed! Add it to your panel from the Widgets menu.$(RESET)"

install-cinnamon:
	@echo "$(CYAN)Installing Cinnamon Applet...$(RESET)"
	@mkdir -p ~/.local/share/cinnamon/applets/
	@cp -r cinnamon-applet/ipl-live-score@amogh ~/.local/share/cinnamon/applets/
	@echo "$(GREEN)✅ Cinnamon Applet installed! Add it to your panel from the Applets menu.$(RESET)"

install-cosmic:
	@echo "$(CYAN)Compiling and Installing COSMIC Applet...$(RESET)"
	@cd cosmic-applet && cargo build --release
	@mkdir -p ~/.local/bin/
	@cp cosmic-applet/target/release/cosmic-applet-ipl-score ~/.local/bin/
	@echo "$(GREEN)✅ COSMIC Applet installed to ~/.local/bin/cosmic-applet-ipl-score!$(RESET)"

install-mac:
	@echo "$(CYAN)Installing macOS xbar Script...$(RESET)"
	@mkdir -p ~/Library/Application\ Support/xbar/plugins/
	@cp universal-script/ipl_score.py ~/Library/Application\ Support/xbar/plugins/ipl_score.1m.py
	@chmod +x ~/Library/Application\ Support/xbar/plugins/ipl_score.1m.py
	@echo "$(GREEN)✅ xbar plugin installed! Ensure xbar is running and refresh plugins.$(RESET)"

install-script:
	@echo "$(CYAN)Installing Universal Python Script...$(RESET)"
	@mkdir -p ~/.local/bin/
	@cp universal-script/ipl_score.py ~/.local/bin/ipl_score
	@chmod +x ~/.local/bin/ipl_score
	@echo "$(GREEN)✅ Script installed to ~/.local/bin/ipl_score!$(RESET)"
	@echo ""
	@echo "$(BOLD)How to use it:$(RESET)"
	@echo "  $(YELLOW)Waybar:$(RESET)   Add to config: \"custom/ipl\": { \"exec\": \"~/.local/bin/ipl_score --format waybar\", \"return-type\": \"json\", \"interval\": 60 }"
	@echo "  $(YELLOW)Polybar:$(RESET)  Add to config.ini: exec = ~/.local/bin/ipl_score --format text | head -1"
	@echo "  $(YELLOW)dwm:$(RESET)      Add to .xinitrc: while true; do xsetroot -name \"$$(\~/.local/bin/ipl_score --format dwm)\"; sleep 60; done &"
	@echo "  $(YELLOW)MATE:$(RESET)     Add Command Applet to panel and set command: ~/.local/bin/ipl_score --format mate"
	@echo "  $(YELLOW)XFCE:$(RESET)     Add Generic Monitor and set command: ~/.local/bin/ipl_score --format text | head -1"

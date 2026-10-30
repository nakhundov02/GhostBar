#!/bin/bash
# GhostBar — First Launch Installer
# Removes macOS security restriction and opens the app

APP="/Applications/GhostBar.app"

# Check app is installed
if [ ! -d "$APP" ]; then
  osascript -e 'display dialog "Please drag GhostBar to your Applications folder first, then double-click Install GhostBar again." buttons {"OK"} default button 1 with icon caution with title "GhostBar"'
  exit 1
fi

# Remove quarantine silently
xattr -cr "$APP" 2>/dev/null

# Open the app
open "$APP"

# Close this terminal window
osascript -e 'tell application "Terminal" to close (every window whose name contains "install.command")' 2>/dev/null
exit 0

#!/bin/bash
# Clicks the vertical strip's profile footer button on :97 and screenshots the Aside profile menu.
# usage: profile-menu-shot.sh [out.png]
set -u
OUT="${1:-/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/ui-shots/27-profile-menu.png}"
export DISPLAY=:97
# Footer "Your Chrome" button sits at ~ (105,728) in the 1400x900 layout (ui-shots/25).
W=$(xdotool search --onlyvisible --name 'Chromium' | head -1)
[ -n "$W" ] && xdotool windowactivate --sync "$W" 2>/dev/null
xdotool mousemove 105 728 click 1
sleep 1.5
import -window root "$OUT"
echo "wrote $OUT"
xdotool key Escape

#!/usr/bin/env bash
# Smart Library station setup for Raspberry Pi OS Trixie (Debian 13), 64-bit, Python 3.13.
#
# Differs from setup_pi.sh: it uses the SYSTEM OpenCV, NumPy and picamera2 (already on the
# Pi, with the face detector/recognizer built in) and installs Flask from apt. It does NOT
# pip-install OpenCV and does NOT pin numpy<2, which would clash with Python 3.13 / trixie.
# It never takes the IoT key as an argument (so it stays out of shell history).
#
# Run as your normal user (not root), from the project folder on the Pi:
#   bash face_recognition_iot/raspberry_pi/setup_pi_trixie.sh https://your-server [--no-kiosk]
set -euo pipefail

API_URL="${1:-}"
[ -n "$API_URL" ] || { echo "Usage: bash $0 https://your-server [--no-kiosk]"; exit 1; }
shift || true
KIOSK=1
for arg in "$@"; do
    [ "$arg" = "--no-kiosk" ] && KIOSK=0
done

[ "$(id -u)" -ne 0 ] || { echo "Run as your normal user, not root. The script uses sudo when needed."; exit 1; }
case "$API_URL" in https://*) ;; *) echo "The address must start with https://"; exit 1;; esac
API_URL="${API_URL%/}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATION_DIR="$(cd "$HERE/.." && pwd)"
VENV="$STATION_DIR/.venv"
PI_USER="$(id -un)"

[ -f "$STATION_DIR/app.py" ] || { echo "Cannot find app.py in $STATION_DIR. Run this from the project folder."; exit 1; }

echo "==> 1/7  System packages (uses the system OpenCV, NumPy, picamera2, Flask)"
sudo apt-get update
sudo apt-get install -y python3-venv python3-opencv python3-numpy python3-flask \
    python3-picamera2 curl util-linux
if [ "$KIOSK" -eq 1 ] && ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
    sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
fi

echo "==> 2/7  Checking OpenCV face functions and the camera"
python3 - <<'PY'
import sys
import cv2
ok = hasattr(cv2, "FaceDetectorYN") and hasattr(cv2, "FaceRecognizerSF")
print("    OpenCV", cv2.__version__, "- face detector/recognizer present:", ok)
if not ok:
    sys.exit("    OpenCV on this Pi has no FaceDetectorYN/FaceRecognizerSF. Stop and report this.")
try:
    from picamera2 import Picamera2
    cams = Picamera2.global_camera_info()
    print("    cameras found:", len(cams))
    if not cams:
        print("    WARNING: no camera detected. Power off, reseat the ribbon cable, then re-run.")
except Exception as error:
    print("    WARNING: picamera2 check failed:", error)
PY

echo "==> 3/7  Python environment (no pip downloads)"
# --system-site-packages lets the venv use the apt-installed OpenCV, NumPy, Flask and picamera2.
python3 -m venv --system-site-packages "$VENV"
"$VENV/bin/python" -c "import cv2, numpy, flask, picamera2; print('    venv imports OK: cv2', cv2.__version__, 'numpy', numpy.__version__)"

echo "==> 4/7  Face-recognition models (needs internet, about 40 MB)"
( cd "$STATION_DIR" && "$VENV/bin/python" -c "from models import ensure_models; print('   ', *ensure_models().values(), sep='\n    ')" )

echo "==> 5/7  Connection settings"
read -r -s -p "Paste the IoT key from the server (it will not be shown): " IOT_KEY < /dev/tty
echo
[ -n "$IOT_KEY" ] || { echo "An IoT key is required."; exit 1; }
sudo install -m 600 -o root -g root /dev/null /etc/smart-library-station.env
sudo tee /etc/smart-library-station.env >/dev/null <<ENV
SMART_LIBRARY_API_URL=$API_URL
SMART_LIBRARY_IOT_KEY=$IOT_KEY
SMART_LIBRARY_AUTO_ATTENDANCE=0
SMART_LIBRARY_AUTO_COOLDOWN=60
SMART_LIBRARY_CAMERA=0
SMART_LIBRARY_STATION_HOST=127.0.0.1
SMART_LIBRARY_STATION_PORT=5001
ENV
# The key goes to curl through stdin so it does not appear in the process list.
if printf 'X-IOT-API-Key: %s\n' "$IOT_KEY" | curl -fsS -m 20 -H @- "$API_URL/api/iot/face-templates" -o /dev/null; then
    echo "    Server reachable and key accepted."
else
    echo "    WARNING: the server rejected the key or could not be reached. Check the address and key."
fi
unset IOT_KEY

echo "==> 6/7  Start automatically at boot"
sed -e "s|__USER__|$PI_USER|" -e "s|__STATION_DIR__|$STATION_DIR|" -e "s|__VENV__|$VENV|" \
    "$HERE/smart-library-station.service" | sudo tee /etc/systemd/system/smart-library-station.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now smart-library-station

if [ "$KIOSK" -eq 1 ]; then
    echo "==> 7/7  Full-screen browser at login"
    chmod +x "$HERE/kiosk.sh"
    mkdir -p "$HOME/.config/labwc"
    AUTOSTART="$HOME/.config/labwc/autostart"
    touch "$AUTOSTART"
    grep -qF "$HERE/kiosk.sh" "$AUTOSTART" || echo "\"$HERE/kiosk.sh\" &" >> "$AUTOSTART"
    sudo raspi-config nonint do_boot_behaviour B4 || echo "    Could not set desktop auto-login; set it in: sudo raspi-config > System Options > Boot / Auto Login."
    sudo raspi-config nonint do_blanking 1 || true
else
    echo "==> 7/7  Skipped the full-screen browser (--no-kiosk)"
fi

echo
echo "Done. Check the station:  systemctl status smart-library-station --no-pager"
echo "Live log:                 journalctl -u smart-library-station -f"
[ "$KIOSK" -eq 1 ] && echo "Then reboot to test the full start-up:  sudo reboot"

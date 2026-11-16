#!/usr/bin/env bash
# ArkStore iPhone setup for Mac, Linux and Chromebook: gets this computer ready to install
# SideStore on an iPhone or iPad.
#   Mac:        downloads iloader (github.com/nab138/iloader) into Applications and opens it.
#   Linux:      installs usbmuxd (talks to the iPhone over USB) and iloader with apt, dnf or
#               zypper when there is one (AppImage otherwise), then opens it.
#   Chromebook: same as Linux, inside the Linux development environment.
# What's left is in iloader: plug in the iPhone, sign in with your Apple Account and choose
# Install SideStore. Run:
#   curl -fsSL https://store.arkdevs.xyz/ios-setup/setup.sh | bash
set -euo pipefail

GUIDE='https://store.arkdevs.xyz/download/'
BASE='https://github.com/nab138/iloader/releases/latest/download'

bold() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok() { printf '      \033[32m%s\033[0m\n' "$*"; }
note() { printf '      \033[33m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\nThe full guide: %s\n' "$*" "$GUIDE"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fetch() { curl -fL --retry 3 --progress-bar -o "$2" "$1" || fail "Couldn't download $1. Check your internet connection and run this again."; }

echo 'ArkStore iPhone setup'
echo 'Gets this computer ready to install SideStore. Nothing is changed on your iPhone yet.'

mac() {
  bold '[1/3] Checking macOS'
  local v; v="$(sw_vers -productVersion)"
  local major="${v%%.*}" minor; minor="$(echo "$v" | cut -d. -f2)"
  if [ "$major" -eq 10 ] && [ "$minor" -lt 13 ]; then fail "iloader needs macOS High Sierra (10.13) or later; this Mac has $v."; fi
  ok "macOS $v"

  bold '[2/3] Installing iloader'
  fetch "$BASE/iloader-darwin-universal.dmg" "$TMP/iloader.dmg"
  local mnt; mnt="$(hdiutil attach -nobrowse -readonly "$TMP/iloader.dmg" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')"
  [ -n "$mnt" ] || fail "Couldn't open the iloader disk image."
  local app; app="$(find "$mnt" -maxdepth 1 -name '*.app' | head -n 1)"
  [ -n "$app" ] || { hdiutil detach -quiet "$mnt"; fail 'No app found in the iloader disk image.'; }
  local dest="/Applications/$(basename "$app")"
  if [ -w /Applications ]; then rm -rf "$dest"; ditto "$app" "$dest"; else sudo rm -rf "$dest"; sudo ditto "$app" "$dest"; fi
  hdiutil detach -quiet "$mnt" || true
  ok "Installed $dest"

  bold '[3/3] Opening iloader'
  open "$dest" && ok 'iloader is open' || note 'Open iloader from Applications. If macOS blocks it, right-click it and choose Open.'
}

linux() {
  local arch; arch="$(uname -m)"
  local deb rpm appimage
  case "$arch" in
    x86_64|amd64) deb=amd64; rpm=x86_64; appimage=amd64 ;;
    aarch64|arm64) deb=arm64; rpm=aarch64; appimage=aarch64 ;;
    *) fail "iloader has no build for $arch computers." ;;
  esac
  local sudo=''; [ "$(id -u)" -eq 0 ] || sudo='sudo'

  bold '[1/3] Installing usbmuxd (lets this computer talk to the iPhone)'
  if need apt-get; then
    $sudo apt-get update -qq
    $sudo apt-get install -y usbmuxd curl
  elif need dnf; then
    $sudo dnf install -y usbmuxd curl
  elif need zypper; then
    $sudo zypper --non-interactive install usbmuxd curl
  elif need pacman; then
    $sudo pacman -Sy --noconfirm --needed usbmuxd curl fuse2
  else
    note 'No apt, dnf, zypper or pacman here: install usbmuxd with your package manager.'
  fi
  if need systemctl; then $sudo systemctl enable --now usbmuxd >/dev/null 2>&1 || true; fi
  ok 'usbmuxd ready'

  bold '[2/3] Installing iloader'
  if need apt-get; then
    fetch "$BASE/iloader-linux-$deb.deb" "$TMP/iloader.deb"
    $sudo apt-get install -y "$TMP/iloader.deb"
  elif need dnf; then
    fetch "$BASE/iloader-linux-$rpm.rpm" "$TMP/iloader.rpm"
    $sudo dnf install -y "$TMP/iloader.rpm"
  elif need zypper; then
    fetch "$BASE/iloader-linux-$rpm.rpm" "$TMP/iloader.rpm"
    $sudo zypper --non-interactive --no-gpg-checks install "$TMP/iloader.rpm"
  else
    mkdir -p "$HOME/Applications"
    fetch "$BASE/iloader-linux-$appimage.AppImage" "$HOME/Applications/iloader.AppImage"
    chmod +x "$HOME/Applications/iloader.AppImage"
  fi
  ok 'iloader installed'

  bold '[3/3] Opening iloader'
  local bin=''
  for b in iloader "$HOME/Applications/iloader.AppImage"; do if need "$b" || [ -x "$b" ]; then bin="$b"; break; fi; done
  if [ -n "$bin" ] && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
    nohup "$bin" >/dev/null 2>&1 &
    ok 'iloader is open'
  else
    note 'Open iloader from your apps menu.'
  fi
  if [ -e /dev/.cros_milestone ] || grep -qi 'penguin' /etc/hostname 2>/dev/null; then
    note 'Chromebook: when you plug in the iPhone, choose "Connect to Linux" in the ChromeOS notification.'
  fi
}

case "$(uname -s)" in
  Darwin) mac ;;
  Linux) linux ;;
  *) fail 'This script is for Mac and Linux. On Windows, use ArkStore-iPhone-Setup.bat.' ;;
esac

printf '\n\033[1mNow, in iloader:\033[0m\n'
echo '  1. Plug in your iPhone or iPad. If it asks, tap Trust and enter your passcode.'
echo '  2. Sign in with your Apple Account (the email is case-sensitive).'
echo '  3. Pick your device and choose Install SideStore (Stable).'
echo
echo 'Then on the iPhone: trust your Apple Account (Settings > General > VPN & Device Management),'
echo 'turn on Developer Mode, connect LocalDevVPN and open SideStore. Step by step:'
printf '  \033[36m%s\033[0m\n' "$GUIDE"

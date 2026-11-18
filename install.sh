#!/bin/sh
# Installs (or updates) Basalt on macOS or Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/install.sh | sh
#
# It reads the latest release's update manifest, downloads the right build, checks its SHA-512
# against the manifest, and installs it:
#   macOS          Basalt.app into /Applications (or ~/Applications if that isn't writable)
#   Debian/Ubuntu  the .deb package, with sudo (set BASALT_NO_SUDO=1 to use the AppImage instead)
#   other Linux    the AppImage in ~/.local/share/basalt, a `basalt` command and a menu entry
# On Windows, use PowerShell instead:  irm https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/install.ps1 | iex
#
# Options (environment variables):
#   BASALT_INSTALL_DIR  where Basalt.app goes on macOS
#   BASALT_NO_SUDO=1    on Linux, never use sudo (installs the AppImage for this user)
#   BASALT_RELEASES     releases URL to install from (for testing)
set -eu

RELEASES="${BASALT_RELEASES:-https://github.com/Nabhyaraj-Sonagara/Basalt/releases}"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'Basalt install failed: %s\n' "$*" >&2
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

has curl || fail "curl is needed"
TMP=$(mktemp -d 2>/dev/null || mktemp -d -t basalt)
trap 'rm -rf "$TMP"' EXIT INT TERM

fetch() {
  curl -fSL --retry 3 --proto '=https,http' --progress-bar "$1" -o "$2" || fail "couldn't download $1"
}

# Prints "<file> <sha512>" for the first file in the manifest whose name matches the regex $2.
pick() {
  awk -v pat="$2" '
    $1 == "-" && $2 == "url:" { url = $3; next }
    $1 == "sha512:" && url != "" { if (url ~ pat) { print url, $2; exit } url = "" }
  ' "$1"
}

verify() {
  if ! has openssl; then
    say "  (openssl not found; skipping the checksum check)"
    return
  fi
  got=$(openssl dgst -sha512 -binary "$1" | openssl base64 -A)
  [ "$got" = "$2" ] || fail "the download's checksum doesn't match the release. Nothing was installed; try again."
}

download() { # manifest, file regex -> sets FILE (local path) and VERSION
  manifest="$TMP/manifest.yml"
  curl -fsSL --retry 3 "$RELEASES/latest/download/$1" -o "$manifest" || fail "couldn't reach the latest release at $RELEASES"
  VERSION=$(awk '$1 == "version:" { print $2; exit }' "$manifest")
  [ -n "$VERSION" ] || fail "the release manifest has no version"
  set -- $(pick "$manifest" "$2")
  [ $# -eq 2 ] || fail "the latest release has no build for this computer"
  say "Downloading Basalt $VERSION ($1)…"
  FILE="$TMP/$1"
  fetch "$RELEASES/download/v$VERSION/$1" "$FILE"
  verify "$FILE" "$2"
}

install_mac() {
  arch=$(uname -m)
  # A shell running under Rosetta reports x86_64 on Apple silicon; use the native build anyway.
  if [ "$arch" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
  case "$arch" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) fail "unsupported Mac architecture: $arch" ;;
  esac
  download latest-mac.yml "-mac-$arch[.]zip\$"

  dest="${BASALT_INSTALL_DIR:-/Applications}"
  if [ -z "${BASALT_INSTALL_DIR:-}" ] && [ ! -w "$dest" ]; then dest="$HOME/Applications"; fi
  mkdir -p "$dest"
  ditto -x -k "$FILE" "$TMP/app" || fail "couldn't unpack the app"
  [ -d "$TMP/app/Basalt.app" ] || fail "the download didn't contain Basalt.app"
  # curl doesn't mark files as downloaded from the internet, so macOS opens the app without the
  # "Open Anyway" step. Clear the flag anyway in case something added it.
  xattr -dr com.apple.quarantine "$TMP/app/Basalt.app" 2>/dev/null || true
  rm -rf "$dest/Basalt.app"
  mv "$TMP/app/Basalt.app" "$dest/Basalt.app"
  say ""
  say "Installed Basalt $VERSION in $dest/Basalt.app"
  if pgrep -x Basalt >/dev/null 2>&1; then say "Basalt is running: quit and reopen it to use the new version."; fi
  say "Open it from Launchpad or Spotlight, or run:  open -a \"$dest/Basalt.app\""
}

install_deb() {
  download latest-linux.yml '-linux-amd64[.]deb$'
  say "Installing the package (sudo may ask for your password)…"
  if has apt-get; then
    sudo apt-get install -y "$FILE" || fail "apt-get couldn't install the package"
  else
    sudo dpkg -i "$FILE" || fail "dpkg couldn't install the package"
  fi
  say ""
  say "Installed Basalt $VERSION. Open it from your applications menu, or run:  basalt"
}

install_appimage() {
  download latest-linux.yml '-linux-x86_64[.]AppImage$'
  home="${XDG_DATA_HOME:-$HOME/.local/share}"
  dir="$home/basalt"
  bin="$HOME/.local/bin"
  mkdir -p "$dir" "$bin" "$home/applications"
  chmod +x "$FILE"
  mv -f "$FILE" "$dir/Basalt.AppImage"
  # AppImages need FUSE 2, which newer distributions leave out; extract-and-run works without it.
  cat >"$bin/basalt" <<EOF
#!/bin/sh
if ! { command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep -q 'libfuse\\.so\\.2'; }; then
  export APPIMAGE_EXTRACT_AND_RUN=1
fi
exec "$dir/Basalt.AppImage" "\$@"
EOF
  chmod +x "$bin/basalt"
  # Menu entry and icon (the icon is best effort).
  icon=basalt
  # (basalt.png at the top is a symlink into usr/share/icons, so extract the real files.)
  if (cd "$TMP" && "$dir/Basalt.AppImage" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1); then
    found=$(ls -S "$TMP"/squashfs-root/usr/share/icons/hicolor/*/apps/*.png 2>/dev/null | head -n 1)
    if [ -n "$found" ]; then cp "$found" "$dir/basalt.png" && icon="$dir/basalt.png"; fi
  fi
  cat >"$home/applications/basalt.desktop" <<EOF
[Desktop Entry]
Name=Basalt
Comment=Local-first Markdown notes, built for AI
Exec=$bin/basalt %U
Icon=$icon
Type=Application
Categories=Office;
MimeType=x-scheme-handler/basalt;
StartupWMClass=Basalt
EOF
  if has update-desktop-database; then update-desktop-database "$home/applications" >/dev/null 2>&1 || true; fi
  say ""
  say "Installed Basalt $VERSION in $dir"
  case ":$PATH:" in
    *":$bin:"*) say "Open it from your applications menu, or run:  basalt" ;;
    *) say "Open it from your applications menu, or run:  $bin/basalt   (add $bin to your PATH to type just 'basalt')" ;;
  esac
}

case "$(uname -s)" in
  Darwin) install_mac ;;
  Linux)
    case "$(uname -m)" in
      x86_64 | amd64) ;;
      *) fail "Linux builds are x86_64 only for now" ;;
    esac
    if [ -z "${BASALT_NO_SUDO:-}" ] && has dpkg && has sudo; then install_deb; else install_appimage; fi
    ;;
  *) fail "this script is for macOS and Linux. On Windows, run in PowerShell:  irm https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/install.ps1 | iex" ;;
esac

#!/usr/bin/env bash
# Worktree Kanban installer (macOS / Linux)
#
#   curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | bash
#
# Pin a version:  curl -fsSL ... | WORKTREE_KANBAN_VERSION=0.1.1 bash
# Uninstall:      curl -fsSL ... | bash -s -- --uninstall
set -euo pipefail

REPO="kazuya83/worktree-kanban"
APP_NAME="Worktree Kanban"
BIN_NAME="worktree-kanban"
# Builds installed under previous names are removed on replace
OLD_APP_NAMES=("Agent Kanban" "Claude Agent Kanban")
OLD_BIN_NAMES=("agent-kanban" "claude-agent-kanban")
# AGENT_KANBAN_VERSION is what apps from before the rename pass when they update themselves
VERSION="${WORKTREE_KANBAN_VERSION:-${AGENT_KANBAN_VERSION:-latest}}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

os="$(uname -s)"
arch="$(uname -m)"

mac_app_dir() {
  if [ -w /Applications ]; then echo /Applications; else mkdir -p "${HOME}/Applications"; echo "${HOME}/Applications"; fi
}

if [ "${1:-}" = "--uninstall" ]; then
  case "${os}" in
    Darwin)
      for d in /Applications "${HOME}/Applications"; do
        for n in "${APP_NAME}" "${OLD_APP_NAMES[@]}"; do
          [ -d "${d}/${n}.app" ] && { rm -rf "${d}/${n}.app"; info "Removed ${d}/${n}.app"; }
        done
      done ;;
    Linux)
      for n in "${BIN_NAME}" "${OLD_BIN_NAMES[@]}"; do
        rm -f "${HOME}/.local/bin/${n}" "${HOME}/.local/share/applications/${n}.desktop" "${HOME}/.local/share/icons/${n}.png"
      done
      info "Removed" ;;
  esac
  info "Board data (the userData folder) was left in place. Delete it manually if you no longer need it."
  exit 0
fi

command -v curl >/dev/null || die "curl is required"

# Asset file name for this machine
case "${os}" in
  Darwin)
    case "${arch}" in
      arm64) pattern="mac-arm64.dmg" ;;
      x86_64) pattern="mac-x64.dmg" ;;
      *) die "Unsupported CPU: ${arch}" ;;
    esac ;;
  Linux)
    [ "${arch}" = "x86_64" ] || die "Linux supports x86_64 only (this machine is ${arch})"
    pattern="linux-x86_64.AppImage" ;;
  *) die "Unsupported OS: ${os} (on Windows, use install.ps1)" ;;
esac

# Decide the download URL.
# Do not use the GitHub API (unauthenticated calls can hit the rate limit and return 403).
# The latest release is taken from the redirect target of github.com/.../releases/latest (.../releases/tag/v0.1.2).
info "Fetching release information (${VERSION})"
if [ "${VERSION}" = "latest" ]; then
  final="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest")" || die "Could not look up the latest release"
  tag="${final##*/}"
else
  tag="v${VERSION#v}"
fi
case "${tag}" in
  v[0-9]*) ;;
  *) die "Release not found (${tag})" ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
# Releases from before the rename have files named after the previous names
file=""
for n in "${BIN_NAME}" "${OLD_BIN_NAMES[@]}"; do
  url="https://github.com/${REPO}/releases/download/${tag}/${n}-${tag#v}-${pattern}"
  info "Downloading: $(basename "${url}")"
  if curl -fL --progress-bar -o "${tmp}/$(basename "${url}")" "${url}"; then
    file="${tmp}/$(basename "${url}")"
    break
  fi
done
if [ -z "${file}" ]; then
  if [ "${os}" = "Darwin" ]; then
    # The Mac dmg is added after the release is published (so the release does not wait for the Mac build)
    die "The Mac build for ${tag} is not ready yet. Try again later, or install a previous version (example: WORKTREE_KANBAN_VERSION=0.1.0). https://github.com/${REPO}/releases"
  fi
  die "Download failed: ${tag} (check that this version exists at https://github.com/${REPO}/releases)"
fi

case "${os}" in
  Darwin)
    dest="$(mac_app_dir)"
    mnt="${tmp}/mnt"
    mkdir -p "${mnt}"
    hdiutil attach "${file}" -nobrowse -quiet -mountpoint "${mnt}"
    src="$(find "${mnt}" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "${src}" ] || { hdiutil detach "${mnt}" -quiet || true; die "No app was found inside the dmg"; }
    # App name inside the dmg (a previous name for a release from before the rename)
    app_name="$(basename "${src}" .app)"
    # Replacing the app while it is running breaks the window of the old process, so quit it first (including previous names)
    relaunch=""
    for n in "${APP_NAME}" "${OLD_APP_NAMES[@]}"; do
      pgrep -x "${n}" >/dev/null 2>&1 || continue
      info "${n} is running, so it will quit before the update (if a task is running, the app will ask you to confirm)"
      osascript -e "tell application \"${n}\" to quit" >/dev/null 2>&1 || true
      for _ in $(seq 1 30); do
        pgrep -x "${n}" >/dev/null 2>&1 || break
        sleep 1
      done
      if pgrep -x "${n}" >/dev/null 2>&1; then
        hdiutil detach "${mnt}" -quiet || true
        die "${n} did not quit. Quit the app (⌘Q) and run this again"
      fi
      relaunch=1
    done
    for n in "${OLD_APP_NAMES[@]}"; do
      # An app from before the rename relaunches its old path after updating itself, which no longer exists
      [ -d "${dest}/${n}.app" ] && [ "${n}" != "${app_name}" ] && relaunch=1
      rm -rf "${dest}/${n}.app"
    done
    rm -rf "${dest}/${APP_NAME}.app"
    cp -R "${src}" "${dest}/"
    hdiutil detach "${mnt}" -quiet || true
    # The app is unsigned, so clear the quarantine flag added on download
    xattr -dr com.apple.quarantine "${dest}/${app_name}.app" 2>/dev/null || true
    info "Installed: ${dest}/${app_name}.app (${tag})"
    if [ -n "${relaunch}" ]; then
      info "Relaunching ${app_name}"
      open -a "${dest}/${app_name}.app" || true
    fi
    run_hint="open -a \"${app_name}\""
    ;;
  Linux)
    bin="${HOME}/.local/bin"
    mkdir -p "${bin}" "${HOME}/.local/share/applications" "${HOME}/.local/share/icons"
    for n in "${OLD_BIN_NAMES[@]}"; do
      rm -f "${bin}/${n}" "${HOME}/.local/share/applications/${n}.desktop" "${HOME}/.local/share/icons/${n}.png"
    done
    install -m 755 "${file}" "${bin}/${BIN_NAME}"
    # An app from before the rename relaunches ~/.local/bin/agent-kanban after updating itself
    ln -sf "${BIN_NAME}" "${bin}/agent-kanban"
    curl -fsSL -o "${HOME}/.local/share/icons/${BIN_NAME}.png" "https://raw.githubusercontent.com/${REPO}/main/build/icon.png" || true
    cat > "${HOME}/.local/share/applications/${BIN_NAME}.desktop" <<EOF
[Desktop Entry]
Name=${APP_NAME}
Exec=${bin}/${BIN_NAME} %U
Icon=${HOME}/.local/share/icons/${BIN_NAME}.png
Type=Application
Categories=Development;
EOF
    info "Installed: ${bin}/${BIN_NAME} (${tag})"
    case ":${PATH}:" in *":${bin}:"*) ;; *) warn "${bin} is not on PATH. Add it to your shell configuration." ;; esac
    run_hint="${BIN_NAME}"
    ;;
esac

# What you need in order to run
command -v git >/dev/null || warn "git was not found. Please install it."
if ! command -v claude >/dev/null && ! command -v codex >/dev/null && ! command -v gemini >/dev/null && ! command -v cursor-agent >/dev/null; then
  warn "No agent CLI (claude / codex / gemini / cursor-agent) was found. Install the one you use and sign in (Claude Code, Codex CLI, Gemini CLI, or Cursor CLI)."
fi

echo
info "To launch: ${run_hint}"

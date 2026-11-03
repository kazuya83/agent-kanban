#!/usr/bin/env bash
# Agent Kanban のインストーラー（macOS / Linux）
#
#   curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | bash
#
# バージョンを指定する:  curl -fsSL ... | AGENT_KANBAN_VERSION=0.1.0 bash
# アンインストール:      curl -fsSL ... | bash -s -- --uninstall
set -euo pipefail

REPO="kazuya83/agent-kanban"
APP_NAME="Agent Kanban"
VERSION="${AGENT_KANBAN_VERSION:-latest}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m警告:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mエラー:\033[0m %s\n' "$*" >&2; exit 1; }

os="$(uname -s)"
arch="$(uname -m)"

mac_app_dir() {
  if [ -w /Applications ]; then echo /Applications; else mkdir -p "$HOME/Applications"; echo "$HOME/Applications"; fi
}

if [ "${1:-}" = "--uninstall" ]; then
  case "$os" in
    Darwin)
      for d in /Applications "$HOME/Applications"; do
        [ -d "$d/$APP_NAME.app" ] && { rm -rf "$d/$APP_NAME.app"; info "$d/$APP_NAME.app を削除しました"; }
      done ;;
    Linux)
      rm -f "$HOME/.local/bin/agent-kanban" "$HOME/.local/share/applications/agent-kanban.desktop" "$HOME/.local/share/icons/agent-kanban.png"
      info "削除しました" ;;
  esac
  info "ボードのデータ（userData フォルダ）は残しています。不要なら手動で削除してください。"
  exit 0
fi

command -v curl >/dev/null || die "curl が必要です"

# 対象のファイル名
case "$os" in
  Darwin)
    case "$arch" in
      arm64) pattern="mac-arm64.dmg" ;;
      x86_64) pattern="mac-x64.dmg" ;;
      *) die "対応していない CPU です: $arch" ;;
    esac ;;
  Linux)
    [ "$arch" = "x86_64" ] || die "Linux は x86_64 のみ対応しています（今は $arch）"
    pattern="linux-x86_64.AppImage" ;;
  *) die "対応していない OS です: $os（Windows は install.ps1 を使ってください）" ;;
esac

# リリース情報から、ダウンロードする URL を探す
if [ "$VERSION" = "latest" ]; then
  api="https://api.github.com/repos/$REPO/releases/latest"
else
  api="https://api.github.com/repos/$REPO/releases/tags/v${VERSION#v}"
fi
info "リリース情報を取得しています（$VERSION）"
json="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api")" || die "リリースが見つかりません: $api"
url="$(printf '%s' "$json" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"/\1/' | grep -F -- "$pattern" | head -n1 || true)"
[ -n "$url" ] || die "このリリースに $pattern が見つかりません"
tag="$(printf '%s' "$json" | grep -o '"tag_name": *"[^"]*"' | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
file="$tmp/$(basename "$url")"
info "ダウンロードしています: $(basename "$url")"
curl -fL --progress-bar -o "$file" "$url"

case "$os" in
  Darwin)
    dest="$(mac_app_dir)"
    mnt="$tmp/mnt"
    mkdir -p "$mnt"
    hdiutil attach "$file" -nobrowse -quiet -mountpoint "$mnt"
    src="$(find "$mnt" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "$src" ] || { hdiutil detach "$mnt" -quiet || true; die "dmg の中にアプリが見つかりません"; }
    if pgrep -x "$APP_NAME" >/dev/null 2>&1; then warn "$APP_NAME が起動中です。終了してから使い直してください。"; fi
    rm -rf "$dest/$APP_NAME.app"
    cp -R "$src" "$dest/"
    hdiutil detach "$mnt" -quiet || true
    # 署名していないアプリなので、ダウンロード時に付く「隔離」の印を外す
    xattr -dr com.apple.quarantine "$dest/$APP_NAME.app" 2>/dev/null || true
    info "インストールしました: $dest/$APP_NAME.app（$tag）"
    run_hint="open -a \"$APP_NAME\""
    ;;
  Linux)
    bin="$HOME/.local/bin"
    mkdir -p "$bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons"
    install -m 755 "$file" "$bin/agent-kanban"
    curl -fsSL -o "$HOME/.local/share/icons/agent-kanban.png" "https://raw.githubusercontent.com/$REPO/main/build/icon.png" || true
    cat > "$HOME/.local/share/applications/agent-kanban.desktop" <<EOF
[Desktop Entry]
Name=$APP_NAME
Exec=$bin/agent-kanban %U
Icon=$HOME/.local/share/icons/agent-kanban.png
Type=Application
Categories=Development;
EOF
    info "インストールしました: $bin/agent-kanban（$tag）"
    case ":$PATH:" in *":$bin:"*) ;; *) warn "$bin が PATH に入っていません。シェルの設定に追加してください。" ;; esac
    run_hint="agent-kanban"
    ;;
esac

# 動かすのに必要なもの
command -v git >/dev/null || warn "git が見つかりません。インストールしてください。"
command -v claude >/dev/null || warn "claude が見つかりません。Claude Code をインストールしてログインしてください: https://docs.claude.com/en/docs/claude-code"

echo
info "起動するには: $run_hint"

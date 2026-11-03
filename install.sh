#!/usr/bin/env bash
# Claude Agent Kanban のインストーラー（macOS / Linux）
#
#   curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | bash
#
# バージョンを指定する:  curl -fsSL ... | AGENT_KANBAN_VERSION=0.1.1 bash
# アンインストール:      curl -fsSL ... | bash -s -- --uninstall
set -euo pipefail

REPO="kazuya83/agent-kanban"
APP_NAME="Claude Agent Kanban"
VERSION="${AGENT_KANBAN_VERSION:-latest}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m警告:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mエラー:\033[0m %s\n' "$*" >&2; exit 1; }

os="$(uname -s)"
arch="$(uname -m)"

mac_app_dir() {
  if [ -w /Applications ]; then echo /Applications; else mkdir -p "${HOME}/Applications"; echo "${HOME}/Applications"; fi
}

if [ "${1:-}" = "--uninstall" ]; then
  case "${os}" in
    Darwin)
      for d in /Applications "${HOME}/Applications"; do
        [ -d "${d}/${APP_NAME}.app" ] && { rm -rf "${d}/${APP_NAME}.app"; info "${d}/${APP_NAME}.app を削除しました"; }
      done ;;
    Linux)
      rm -f "${HOME}/.local/bin/claude-agent-kanban" "${HOME}/.local/share/applications/claude-agent-kanban.desktop" "${HOME}/.local/share/icons/claude-agent-kanban.png"
      info "削除しました" ;;
  esac
  info "ボードのデータ（userData フォルダ）は残しています。不要なら手動で削除してください。"
  exit 0
fi

command -v curl >/dev/null || die "curl が必要です"

# 対象のファイル名
case "${os}" in
  Darwin)
    case "${arch}" in
      arm64) pattern="mac-arm64.dmg" ;;
      x86_64) pattern="mac-x64.dmg" ;;
      *) die "対応していない CPU です: ${arch}" ;;
    esac ;;
  Linux)
    [ "${arch}" = "x86_64" ] || die "Linux は x86_64 のみ対応しています（今は ${arch}）"
    pattern="linux-x86_64.AppImage" ;;
  *) die "対応していない OS です: ${os}（Windows は install.ps1 を使ってください）" ;;
esac

# ダウンロードする URL を決める
# GitHub API は使わない（未ログインだと回数制限で 403 になることがあるため）。
# 最新版は github.com/.../releases/latest のリダイレクト先（.../releases/tag/v0.1.2）から調べる
info "リリース情報を取得しています（${VERSION}）"
if [ "${VERSION}" = "latest" ]; then
  final="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest")" || die "最新のリリースを調べられませんでした"
  tag="${final##*/}"
else
  tag="v${VERSION#v}"
fi
case "${tag}" in
  v[0-9]*) ;;
  *) die "リリースが見つかりません（${tag}）" ;;
esac
name="claude-agent-kanban-${tag#v}-${pattern}"
url="https://github.com/${REPO}/releases/download/${tag}/${name}"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
file="${tmp}/$(basename "${url}")"
info "ダウンロードしています: $(basename "${url}")"
curl -fL --progress-bar -o "${file}" "${url}" || die "ダウンロードできませんでした: ${url}（バージョン ${tag} があるか、https://github.com/${REPO}/releases で確認してください）"

case "${os}" in
  Darwin)
    dest="$(mac_app_dir)"
    mnt="${tmp}/mnt"
    mkdir -p "${mnt}"
    hdiutil attach "${file}" -nobrowse -quiet -mountpoint "${mnt}"
    src="$(find "${mnt}" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "${src}" ] || { hdiutil detach "${mnt}" -quiet || true; die "dmg の中にアプリが見つかりません"; }
    if pgrep -x "${APP_NAME}" >/dev/null 2>&1; then warn "${APP_NAME} が起動中です。終了してから使い直してください。"; fi
    rm -rf "${dest}/${APP_NAME}.app"
    cp -R "${src}" "${dest}/"
    hdiutil detach "${mnt}" -quiet || true
    # 署名していないアプリなので、ダウンロード時に付く「隔離」の印を外す
    xattr -dr com.apple.quarantine "${dest}/${APP_NAME}.app" 2>/dev/null || true
    info "インストールしました: ${dest}/${APP_NAME}.app（${tag}）"
    run_hint="open -a \"${APP_NAME}\""
    ;;
  Linux)
    bin="${HOME}/.local/bin"
    mkdir -p "${bin}" "${HOME}/.local/share/applications" "${HOME}/.local/share/icons"
    install -m 755 "${file}" "${bin}/claude-agent-kanban"
    curl -fsSL -o "${HOME}/.local/share/icons/claude-agent-kanban.png" "https://raw.githubusercontent.com/${REPO}/main/build/icon.png" || true
    cat > "${HOME}/.local/share/applications/claude-agent-kanban.desktop" <<EOF
[Desktop Entry]
Name=${APP_NAME}
Exec=${bin}/claude-agent-kanban %U
Icon=${HOME}/.local/share/icons/claude-agent-kanban.png
Type=Application
Categories=Development;
EOF
    info "インストールしました: ${bin}/claude-agent-kanban（${tag}）"
    case ":${PATH}:" in *":${bin}:"*) ;; *) warn "${bin} が PATH に入っていません。シェルの設定に追加してください。" ;; esac
    run_hint="claude-agent-kanban"
    ;;
esac

# 動かすのに必要なもの
command -v git >/dev/null || warn "git が見つかりません。インストールしてください。"
command -v claude >/dev/null || warn "claude が見つかりません。Claude Code をインストールしてログインしてください: https://docs.claude.com/en/docs/claude-code"

echo
info "起動するには: ${run_hint}"

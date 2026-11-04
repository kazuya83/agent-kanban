#!/usr/bin/env bash
# Agent Kanban のインストーラー（macOS / Linux）
#
#   curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | bash
#
# バージョンを指定する:  curl -fsSL ... | AGENT_KANBAN_VERSION=0.1.1 bash
# アンインストール:      curl -fsSL ... | bash -s -- --uninstall
set -euo pipefail

REPO="kazuya83/agent-kanban"
APP_NAME="Agent Kanban"
BIN_NAME="agent-kanban"
# 前の名前（Claude Agent Kanban）で入れたものは、入れ替えるときに片付ける
OLD_APP_NAME="Claude Agent Kanban"
OLD_BIN_NAME="claude-agent-kanban"
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
        for n in "${APP_NAME}" "${OLD_APP_NAME}"; do
          [ -d "${d}/${n}.app" ] && { rm -rf "${d}/${n}.app"; info "${d}/${n}.app を削除しました"; }
        done
      done ;;
    Linux)
      for n in "${BIN_NAME}" "${OLD_BIN_NAME}"; do
        rm -f "${HOME}/.local/bin/${n}" "${HOME}/.local/share/applications/${n}.desktop" "${HOME}/.local/share/icons/${n}.png"
      done
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
name="${BIN_NAME}-${tag#v}-${pattern}"
url="https://github.com/${REPO}/releases/download/${tag}/${name}"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
file="${tmp}/$(basename "${url}")"
info "ダウンロードしています: $(basename "${url}")"
if ! curl -fL --progress-bar -o "${file}" "${url}"; then
  # 前の名前のころのリリース（claude-agent-kanban-…）
  url="https://github.com/${REPO}/releases/download/${tag}/${OLD_BIN_NAME}-${tag#v}-${pattern}"
  file="${tmp}/$(basename "${url}")"
  info "ダウンロードしています: $(basename "${url}")"
  curl -fL --progress-bar -o "${file}" "${url}" || die "ダウンロードできませんでした: ${url}（バージョン ${tag} があるか、https://github.com/${REPO}/releases で確認してください）"
fi

case "${os}" in
  Darwin)
    dest="$(mac_app_dir)"
    mnt="${tmp}/mnt"
    mkdir -p "${mnt}"
    hdiutil attach "${file}" -nobrowse -quiet -mountpoint "${mnt}"
    src="$(find "${mnt}" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "${src}" ] || { hdiutil detach "${mnt}" -quiet || true; die "dmg の中にアプリが見つかりません"; }
    # dmg の中のアプリの名前（前の名前のころのリリースなら Claude Agent Kanban）
    app_name="$(basename "${src}" .app)"
    # 起動したまま入れ替えると、裏で動いている古いアプリの画面が壊れるので、先に終了してもらう（前の名前のアプリも）
    relaunch=""
    for n in "${APP_NAME}" "${OLD_APP_NAME}"; do
      pgrep -x "${n}" >/dev/null 2>&1 || continue
      info "${n} が起動中なので、終了してから入れ替えます（実行中のタスクがあれば、アプリに確認が出ます）"
      osascript -e "tell application \"${n}\" to quit" >/dev/null 2>&1 || true
      for _ in $(seq 1 30); do
        pgrep -x "${n}" >/dev/null 2>&1 || break
        sleep 1
      done
      if pgrep -x "${n}" >/dev/null 2>&1; then
        hdiutil detach "${mnt}" -quiet || true
        die "${n} が終了しませんでした。アプリを終了してから（⌘Q）、もう一度実行してください"
      fi
      relaunch=1
    done
    rm -rf "${dest}/${APP_NAME}.app" "${dest}/${OLD_APP_NAME}.app"
    cp -R "${src}" "${dest}/"
    hdiutil detach "${mnt}" -quiet || true
    # 署名していないアプリなので、ダウンロード時に付く「隔離」の印を外す
    xattr -dr com.apple.quarantine "${dest}/${app_name}.app" 2>/dev/null || true
    info "インストールしました: ${dest}/${app_name}.app（${tag}）"
    if [ -n "${relaunch}" ]; then
      info "${app_name} を起動し直します"
      open -a "${dest}/${app_name}.app" || true
    fi
    run_hint="open -a \"${app_name}\""
    ;;
  Linux)
    bin="${HOME}/.local/bin"
    mkdir -p "${bin}" "${HOME}/.local/share/applications" "${HOME}/.local/share/icons"
    rm -f "${bin}/${OLD_BIN_NAME}" "${HOME}/.local/share/applications/${OLD_BIN_NAME}.desktop" "${HOME}/.local/share/icons/${OLD_BIN_NAME}.png"
    install -m 755 "${file}" "${bin}/${BIN_NAME}"
    curl -fsSL -o "${HOME}/.local/share/icons/${BIN_NAME}.png" "https://raw.githubusercontent.com/${REPO}/main/build/icon.png" || true
    cat > "${HOME}/.local/share/applications/${BIN_NAME}.desktop" <<EOF
[Desktop Entry]
Name=${APP_NAME}
Exec=${bin}/${BIN_NAME} %U
Icon=${HOME}/.local/share/icons/${BIN_NAME}.png
Type=Application
Categories=Development;
EOF
    info "インストールしました: ${bin}/${BIN_NAME}（${tag}）"
    case ":${PATH}:" in *":${bin}:"*) ;; *) warn "${bin} が PATH に入っていません。シェルの設定に追加してください。" ;; esac
    run_hint="${BIN_NAME}"
    ;;
esac

# 動かすのに必要なもの
command -v git >/dev/null || warn "git が見つかりません。インストールしてください。"
if ! command -v claude >/dev/null && ! command -v codex >/dev/null && ! command -v gemini >/dev/null && ! command -v cursor-agent >/dev/null; then
  warn "エージェントの CLI（claude / codex / gemini / cursor-agent）が見つかりません。使うものをインストールしてログインしてください（Claude Code・Codex CLI・Gemini CLI・Cursor CLI）。"
fi

echo
info "起動するには: ${run_hint}"

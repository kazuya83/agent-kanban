#!/usr/bin/env bash
# テストを動かし、Mac（dmg）・Windows（exe / zip）・Linux（AppImage）のアプリを、この Mac でまとめてビルドする
#
#   scripts/build-all.sh                    → 次に出す予定の版の番号でビルドする（レビューのとき。scripts/next-version.js で決める）
#   scripts/build-all.sh --version 0.1.9    → その番号でビルドする（package.json は書き換えない）
#
# - macOS で動かす（Apple Silicon では Rosetta 2 が必要。Windows のインストーラーと AppImage を作る道具が Intel 用のため）
# - 出力は dist/。画面の確認やインストールの確認はしない
set -euo pipefail

cd "$(dirname "$0")/.."

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mエラー:\033[0m %s\n' "$*" >&2; exit 1; }

version=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="${2:-}"; shift 2 ;;
    *) die "知らない引数です: $1" ;;
  esac
done
if [ -z "$version" ]; then
  # 指定がなければ、次に出す予定の版の番号でビルドする（package.json の version は古いままのことがあるため）
  version="$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$(node scripts/next-version.js)")"
fi
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  die "--version は 0.1.9 のような形で指定してください: $version"
fi

[ "$(uname -s)" = "Darwin" ] || die "このスクリプトは macOS で動かしてください（Mac の dmg は macOS でしか作れません）"
if [ "$(uname -m)" = "arm64" ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
  die "Rosetta 2 が入っていません。次のコマンドで入れてから、もう一度実行してください: softwareupdate --install-rosetta --agree-to-license"
fi

if [ ! -d node_modules ]; then
  info "npm ci"
  npm ci
fi

info "テスト"
npm test

info "インストール用スクリプトの書き方を確かめる"
bash -n install.sh
if command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -Command '$e=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "install.ps1"), [ref]$null, [ref]$e) | Out-Null; if ($e) { $e | ForEach-Object { Write-Error $_.ToString() }; exit 1 }'
else
  echo "（pwsh がないので install.ps1 の確認は飛ばします。brew install powershell で入れられます）"
fi

info "ビルド（Mac / Windows / Linux）${version:+ v$version}"
rm -rf dist
args=(--mac --win --linux --publish never)
[ -n "$version" ] && args+=("-c.extraMetadata.version=$version")
# 証明書なしでビルドする（macOS はアドホック署名）
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder "${args[@]}"

v="${version:-$(node -p "require('./package.json').version")}"
missing=0
for f in \
  "agent-kanban-$v-mac-arm64.dmg" \
  "agent-kanban-$v-mac-x64.dmg" \
  "agent-kanban-$v-win-setup.exe" \
  "agent-kanban-$v-win-portable.exe" \
  "agent-kanban-$v-win-x64.zip" \
  "agent-kanban-$v-linux-x86_64.AppImage"; do
  [ -f "dist/$f" ] || { echo "見つかりません: dist/$f" >&2; missing=1; }
done
[ "$missing" = 0 ] || die "できていないファイルがあります"

info "できました（v${v}）"
ls -lh dist/*.dmg dist/*.exe dist/*.zip dist/*.AppImage

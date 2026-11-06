#!/usr/bin/env bash
# main の最新を、この Mac でビルドして GitHub Release として公開する
#
#   scripts/release-local.sh            → 次の版を決めて、ビルドして公開する
#   scripts/release-local.sh --dry-run  → 次の版とリリースするかどうかだけ出す
#
# - バージョンの決め方は scripts/next-version.js（最新のリリースからアプリの中身が変わっていなければ出さない）
# - 0.2.0 のように大きく上げたいときは、package.json の version をその番号にして main に入れておく
set -euo pipefail

cd "$(dirname "$0")/.."

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mエラー:\033[0m %s\n' "$*" >&2; exit 1; }

dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

command -v gh >/dev/null 2>&1 || die "gh（GitHub CLI）が必要です"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "main で実行してください"
[ -z "$(git status --porcelain)" ] || die "コミットしていない変更があります"

info "origin の main とタグを取ってくる"
git fetch origin main --tags --quiet
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "手元の main が origin/main と違います（git pull / git push してから実行してください）"

r="$(node scripts/next-version.js)"
version="$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$r")"
release="$(node -e 'console.log(JSON.parse(process.argv[1]).release)' "$r")"
reason="$(node -e 'console.log(JSON.parse(process.argv[1]).reason)' "$r")"
echo "$reason"
if [ "$release" != "true" ]; then
  info "リリースするものはありません"
  exit 0
fi
[ "$dry" = 1 ] && { info "v$version を出す予定です（--dry-run なので、ここで止めます）"; exit 0; }

gh release view "v$version" >/dev/null 2>&1 && die "v$version はもう公開されています"

scripts/build-all.sh --version "$version"

info "v$version を公開する"
assets=(dist/*.dmg dist/*.exe dist/*.zip dist/*.AppImage)
# 説明は前の版からの変更点を Markdown でまとめる（作れなかったら GitHub の自動の説明にする）
notes="$(mktemp -t worktree-kanban-notes)"
# 改名する前の版が自分を更新できるように、前の名前のファイルも載せる（説明の一覧には出さない）
legacy_dir="$(mktemp -d -t worktree-kanban-legacy)"
trap 'rm -rf "$notes" "$legacy_dir"' EXIT
scripts/legacy-assets.sh "$legacy_dir" "${assets[@]}"
notes_opt=(--generate-notes)
node scripts/release-notes.js --version "$version" "${assets[@]}" >"$notes" && notes_opt=(--notes-file "$notes")
gh release create "v$version" \
  --target "$(git rev-parse HEAD)" \
  --title "Worktree Kanban v$version" \
  "${notes_opt[@]}" \
  "${assets[@]}" "$legacy_dir"/*
git fetch origin --tags --quiet
info "公開しました: $(gh release view "v$version" --json url -q .url)"

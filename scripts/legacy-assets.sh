#!/usr/bin/env bash
# 改名する前の版（Agent Kanban）は、Release に agent-kanban-<版>-… があるときだけ自分を更新できる。
# その人たちが新しい名前の版に上がれるように、更新で使うファイルを前の名前で写す。
#   scripts/legacy-assets.sh <出力先のフォルダ> <worktree-kanban-… のファイル>...
set -euo pipefail

out="$1"
shift
for f in "$@"; do
  base="$(basename "$f")"
  case "$base" in
    worktree-kanban-*-mac-arm64.dmg|worktree-kanban-*-mac-x64.dmg|worktree-kanban-*-win-x64.zip|worktree-kanban-*-linux-x86_64.AppImage)
      cp "$f" "$out/agent-kanban-${base#worktree-kanban-}" ;;
  esac
done
ls "$out"/agent-kanban-* >/dev/null

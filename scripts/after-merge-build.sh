#!/usr/bin/env bash
# main にタスクをマージしたあとに、/build-apps（review）を裏で走らせて、通れば Release まで出す。.githooks/post-merge から呼ばれる
#
#   scripts/after-merge-build.sh                      → 今の main で 1 回動かす（手で動かすとき）
#   scripts/after-merge-build.sh --git-dir <.git>     → フックから呼ぶとき
#   scripts/after-merge-build.sh --status             → 今どこまで進んだかと、これまでの結果を出す
#
# 1. 今の main から一時的な worktree（ブランチ build-apps/<sha>）を作る
# 2. そこで claude -p "/build-apps review" を動かす（テスト・3つの OS のビルド。落ちたら install.sh / install.ps1 などを直す）
# 3. 直したところがあればコミットし、scripts/build-all.sh をもう一度動かして確かめる。なければ dist/ のファイルがそろっているかを確かめる
# 4. 通って、直したところがあれば、main にマージして origin に push する
# 5. ビルドしたコミットが origin/main に入っていて、scripts/next-version.js が「出す」と決めたら、
#    できたファイルで GitHub Release を公開する（もう一度ビルドはしない）
# 失敗したときは自動マージ・公開をせず、macOS の通知で知らせ、ブランチと worktree を残す
#
# 進み具合: 段階ごとに macOS の通知を出し、.git/build-apps/status（今の段階）と
#           .git/build-apps/history.log（1 回の実行を 1 行）に書く。細かいログは .git/build-apps/logs/
#
# 環境変数: AFTER_MERGE_CLAUDE（claude の場所）, AFTER_MERGE_GH（gh の場所）, AFTER_MERGE_BUILD_ALL（確かめに使うビルドのコマンド）,
#           AFTER_MERGE_NO_PUSH=1（push しない）, AFTER_MERGE_NO_RELEASE=1（Release を出さない）,
#           AFTER_MERGE_NO_NOTIFY=1（通知を出さない）
set -uo pipefail

common=""
show_status=0
while [ $# -gt 0 ]; do
  case "$1" in
    --git-dir) common="${2:-}"; shift 2 ;;
    --status) show_status=1; shift ;;
    *) echo "知らない引数です: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$common" ]; then
  common="$(cd "$(git rev-parse --git-common-dir)" && pwd)" || exit 1
fi
G=(git --git-dir="$common")

state="$common/build-apps"
mkdir -p "$state/logs"

if [ "$show_status" = 1 ]; then
  if kill -0 "$(cat "$state/lock/pid" 2>/dev/null)" 2>/dev/null; then
    echo "動いています（pid $(cat "$state/lock/pid")）"
  else
    echo "動いていません"
  fi
  [ -f "$state/pending" ] && echo "このあとにもう 1 回動く予定です（動いている間に main が進みました）"
  echo
  echo "今の段階:"
  sed 's/^/  /' "$state/status" 2>/dev/null || echo "  （まだありません）"
  echo
  echo "これまでの結果（新しい 10 件）:"
  if [ -s "$state/history.log" ]; then tail -10 "$state/history.log" | sed 's/^/  /'; else echo "  （まだありません）"; fi
  last="$(ls -t "$state/logs" 2>/dev/null | head -1)"
  [ -n "$last" ] && { echo; echo "いちばん新しいログ: $state/logs/$last"; }
  exit 0
fi

# GUI のアプリから呼ばれたときは PATH が短いので、ログインシェルの PATH を使う
if [ -x /bin/zsh ]; then
  p="$(/bin/zsh -lc 'printf %s "$PATH"' 2>/dev/null </dev/null || true)"
  [ -n "$p" ] && PATH="$p"
fi
export PATH="$PATH:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"
# Claude Code の中から呼ばれても、別のセッションとして動かす
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SSE_PORT
# この中で行う git merge では、post-merge をもう一度走らせない
export AGENT_KANBAN_AFTER_MERGE=1
export GIT_TERMINAL_PROMPT=0

claude_bin="${AFTER_MERGE_CLAUDE:-claude}"
gh_bin="${AFTER_MERGE_GH:-gh}"
log=""
cur=""          # 今動かしている main の短い sha
release_msg=""  # release_built が結果を入れる

now() { date '+%Y-%m-%d %H:%M:%S'; }
say() { printf '[%s] %s\n' "$(now)" "$*" | tee -a "${log:-/dev/null}"; }
notify() {
  [ -n "${AFTER_MERGE_NO_NOTIFY:-}" ] && return 0
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title (item 1 of argv)' -e 'end run' \
    "Agent Kanban: /build-apps" "$1" >/dev/null 2>&1 || true
}
# 今の段階を書いて、通知で知らせる
step() {
  say "$*"
  printf '%s  main %s  %s\n' "$(now)" "$cur" "$*" >"$state/status"
  notify "${cur:+($cur) }$*"
}
# 1 回の実行の結果を history.log に 1 行で残す
record() {
  printf '%s  main %s  %s\n' "$(now)" "$cur" "$*" >>"$state/history.log"
}
fail() {
  say "失敗: $*"
  printf '%s  main %s  失敗: %s（ログ: %s）\n' "$(now)" "$cur" "$*" "$log" >"$state/status"
  record "失敗: $*"
  notify "${cur:+($cur) }失敗しました: $*（ログ: ${log}）"
  return 1
}

# 一度に 1 つだけ動かす。動いている間に来た分は、終わったあとにもう一度動かす
if ! mkdir "$state/lock" 2>/dev/null; then
  if kill -0 "$(cat "$state/lock/pid" 2>/dev/null)" 2>/dev/null; then
    touch "$state/pending"
    exit 0
  fi
  # 前の実行が途中で落ちて、ロックだけが残っている
  rm -rf "$state/lock" && mkdir "$state/lock" || exit 1
fi
echo $$ >"$state/lock/pid"
trap 'rm -rf "$state/lock"' EXIT

has_origin() { "${G[@]}" remote get-url origin >/dev/null 2>&1; }

# main をチェックアウトしている worktree のフォルダ（なければ空）
main_worktree() {
  "${G[@]}" worktree list --porcelain | awk '
    /^worktree / { dir = substr($0, 10) }
    $0 == "branch refs/heads/main" { print dir; exit }'
}

# 直したブランチを main にマージして push する
merge_back() {
  local branch="$1" short="$2" dir temp="" origin=0
  has_origin && origin=1

  dir="$(main_worktree)"
  if [ -z "$dir" ]; then
    temp="${TMPDIR:-/tmp}/agent-kanban-build-apps/_merge-$short-$$"
    "${G[@]}" worktree add "$temp" main >>"$log" 2>&1 || { fail "main の一時的な worktree を作れませんでした"; return 1; }
    dir="$temp"
  else
    if [ -n "$(git -C "$dir" status --porcelain --untracked-files=no)" ]; then
      fail "main をチェックアウトしている $dir に未コミットの変更があるので、$branch を自動でマージしませんでした"
      return 1
    fi
    if [ -e "$("${G[@]}" rev-parse --git-path MERGE_HEAD)" ] || [ -e "$(git -C "$dir" rev-parse --git-path MERGE_HEAD)" ]; then
      fail "$dir でマージが途中なので、$branch を自動でマージしませんでした"
      return 1
    fi
  fi

  local ok=0
  (
    set -e
    cd "$dir"
    if [ "$origin" = 1 ]; then
      echo "==> origin/main を取ってくる"
      git fetch origin main --quiet
      if git merge-base --is-ancestor HEAD origin/main; then
        git merge --ff-only --quiet origin/main
      elif ! git merge-base --is-ancestor origin/main HEAD; then
        echo "手元の main と origin/main が分かれています" >&2
        exit 3
      fi
    fi
    echo "==> $branch を main にマージする"
    if ! git merge --no-ff -m "Merge build-apps fixes ($short)" "$branch"; then
      git merge --abort || true
      echo "コンフリクトしました" >&2
      exit 4
    fi
    if [ "$origin" = 1 ] && [ -z "${AFTER_MERGE_NO_PUSH:-}" ]; then
      echo "==> origin/main に push する"
      git push origin main
    fi
  ) >>"$log" 2>&1 || ok=$?
  [ -n "$temp" ] && "${G[@]}" worktree remove --force "$temp" >>"$log" 2>&1
  case "$ok" in
    0) return 0 ;;
    3) fail "手元の main と origin/main が分かれているので、$branch を自動でマージしませんでした" ;;
    4) fail "$branch を main にマージしようとしてコンフリクトしたので、中止しました" ;;
    *) fail "$branch のマージか push に失敗しました" ;;
  esac
  return 1
}

# ビルドしたファイルで GitHub Release を出す。出さないときは理由を release_msg に入れて 0 を返す
#   $1: ビルドしたコミット  $2: ビルドした版  $3: worktree  $4: できたファイルのフォルダ
release_built() {
  local target="$1" version="$2" wt="$3" dir="$4" r rel want reason url
  release_msg=""
  if [ -n "${AFTER_MERGE_NO_RELEASE:-}" ]; then
    release_msg="Release は出していません（AFTER_MERGE_NO_RELEASE が付いています）"
    return 0
  fi
  if ! has_origin; then
    release_msg="origin がないので、Release は出していません"
    return 0
  fi
  command -v "$gh_bin" >/dev/null 2>&1 || { fail "gh が見つからないので、Release を出せませんでした（AFTER_MERGE_GH で場所を指定できます）"; return 1; }

  "${G[@]}" fetch origin main --tags --quiet >>"$log" 2>&1 || { fail "origin から main とタグを取ってこられなかったので、Release を出せませんでした"; return 1; }
  if ! "${G[@]}" merge-base --is-ancestor "$target" refs/remotes/origin/main; then
    release_msg="ビルドしたコミット（${target:0:8}）がまだ origin/main にない（push していない）ので、Release は出していません"
    return 0
  fi

  # タグを取り直したあとで、もう一度決める（ほかで先に出されていないか）
  r="$(cd "$wt" && node scripts/next-version.js 2>>"$log")" || { fail "次の版を決められませんでした"; return 1; }
  rel="$(node -e 'console.log(JSON.parse(process.argv[1]).release)' "$r")"
  want="$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$r")"
  reason="$(node -e 'console.log(JSON.parse(process.argv[1]).reason)' "$r")"
  say "$reason"
  if [ "$rel" != "true" ]; then
    release_msg="Release は出していません（${reason}）"
    return 0
  fi
  if [ "$want" != "$version" ]; then
    fail "ビルドした版（v${version}）と、いま出すべき版（v${want}）が違うので、Release を出しませんでした"
    return 1
  fi
  if (cd "$wt" && "$gh_bin" release view "v$version" >/dev/null 2>&1); then
    release_msg="v$version はもう公開されています"
    return 0
  fi

  step "v$version を Release として公開しています"
  (
    cd "$wt" && "$gh_bin" release create "v$version" \
      --target "$target" \
      --title "Agent Kanban v$version" \
      --generate-notes \
      "$dir"/agent-kanban-"$version"-*.dmg "$dir"/agent-kanban-"$version"-*.exe \
      "$dir"/agent-kanban-"$version"-*.zip "$dir"/agent-kanban-"$version"-*.AppImage
  ) >>"$log" 2>&1 || { fail "v$version の Release を出せませんでした"; return 1; }
  "${G[@]}" fetch origin --tags --quiet >>"$log" 2>&1
  url="$(cd "$wt" && "$gh_bin" release view "v$version" --json url -q .url 2>>"$log")"
  release_msg="v$version を公開しました${url:+: $url}"
  return 0
}

run_once() {
  local sha short branch wt version target changed=0
  sha="$("${G[@]}" rev-parse main)" || return 1
  short="${sha:0:8}"
  [ "$(cat "$state/last-done" 2>/dev/null)" = "$sha" ] && return 0
  cur="$short"
  log="$state/logs/$(date '+%Y%m%d-%H%M%S')-$short.log"
  branch="build-apps/$short"
  wt="${TMPDIR:-/tmp}/agent-kanban-build-apps/$short"

  step "1/4 テストとビルドを始めました"
  # 版の番号はタグから決まるので、先に新しいタグを取ってくる
  has_origin && "${G[@]}" fetch origin --tags --quiet >>"$log" 2>&1
  rm -rf "$wt"
  "${G[@]}" worktree prune
  mkdir -p "$(dirname "$wt")"
  "${G[@]}" worktree add -B "$branch" "$wt" "$sha" >>"$log" 2>&1 || { fail "worktree を作れませんでした"; return 1; }

  command -v "$claude_bin" >/dev/null 2>&1 || { fail "claude が見つかりません（AFTER_MERGE_CLAUDE で場所を指定できます）"; return 1; }
  say "claude -p /build-apps review"
  (
    cd "$wt" && "$claude_bin" -p "/build-apps review

これは main にマージしたあとの自動の実行です。ユーザーには質問できないので、最後まで自分で進めてください。
- scripts/build-all.sh が通るまで、落ちたところ（install.sh / install.ps1 など）を直してください
- コミット・マージ・push・リリースはしないでください（このあとスクリプトが行います）
- 直しきれないときは、直さずにそのまま終えて、理由を書いてください" \
      --permission-mode acceptEdits --allowedTools "Bash Read Edit Write Glob Grep"
  ) </dev/null >>"$log" 2>&1 || { fail "/build-apps が失敗しました（worktree: ${wt}）"; return 1; }

  cd "$wt" || return 1
  if [ -n "$(git status --porcelain)" ]; then
    changed=1
    git add -A >>"$log" 2>&1
    git commit -q -m "build-apps: ビルドの修正（main ${short}）" >>"$log" 2>&1 || { fail "直したところをコミットできませんでした"; return 1; }
    step "2/4 直したところがあったので、もう一度ビルドしています（$(git show --stat --format= HEAD | tail -1 | sed 's/^ *//')）"
    ${AFTER_MERGE_BUILD_ALL:-scripts/build-all.sh} >>"$log" 2>&1 || { fail "直したあとのビルドが通りませんでした（ブランチ: ${branch}）"; return 1; }
  fi
  target="$(git rev-parse HEAD)"

  # ビルドしたファイルがそろっているか
  version="$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$(node scripts/next-version.js 2>/dev/null)" 2>/dev/null)"
  [ -n "$version" ] || { fail "次の版の番号が分かりませんでした"; return 1; }
  local f missing=""
  for f in "mac-arm64.dmg" "mac-x64.dmg" "win-setup.exe" "win-portable.exe" "win-x64.zip" "linux-x86_64.AppImage"; do
    [ -f "dist/agent-kanban-$version-$f" ] || missing="$missing agent-kanban-$version-$f"
  done
  [ -z "$missing" ] || { fail "ビルドしたファイルが足りません:$missing"; return 1; }
  # worktree はこのあと消すので、できたファイルは main をチェックアウトしているフォルダの dist/ に写して残す
  local keep
  keep="$(main_worktree)"
  if [ -n "$keep" ] && [ -d "$keep" ]; then
    rm -rf "$keep/dist" && mkdir -p "$keep/dist" && cp -R "$wt/dist/." "$keep/dist/" >>"$log" 2>&1 \
      || { fail "ビルドしたファイルを $keep/dist に写せませんでした（worktree: ${wt}）"; return 1; }
  else
    keep="$wt"
  fi
  local summary="ビルド OK（v${version}、${keep}/dist）"

  if [ "$changed" = 1 ]; then
    step "3/4 ${summary}。直したところを main にマージして push しています"
    merge_back "$branch" "$short" || return 1
    summary="${summary}・直したところを main にマージして push"
  else
    step "3/4 ${summary}。直すところはありませんでした"
    summary="${summary}・直すところなし"
  fi

  step "4/4 Release を出すか確かめています"
  release_built "$target" "$version" "$wt" "$keep/dist" || return 1
  summary="${summary}・${release_msg}"
  step "終わりました: $summary"
  record "OK: $summary"

  echo "$sha" >"$state/last-done"
  if [ "$keep" != "$wt" ]; then
    cd / && "${G[@]}" worktree remove --force "$wt" >>"$log" 2>&1
    "${G[@]}" branch -D "$branch" >>"$log" 2>&1
  fi
  return 0
}

while :; do
  rm -f "$state/pending"
  run_once || true
  [ -f "$state/pending" ] || break
done

# Claude Agent Kanban のインストーラー（Windows）
#
#   irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
#
# バージョンを指定する:  $env:AGENT_KANBAN_VERSION = "0.1.0"; irm ... | iex
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest を速くする

$repo = 'kazuya83/agent-kanban'
$version = if ($env:AGENT_KANBAN_VERSION) { $env:AGENT_KANBAN_VERSION } else { 'latest' }

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "警告: $msg" -ForegroundColor Yellow }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$api = if ($version -eq 'latest') { "https://api.github.com/repos/$repo/releases/latest" } else { "https://api.github.com/repos/$repo/releases/tags/v$($version.TrimStart('v'))" }
Info "リリース情報を取得しています（${version}）"
$release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'agent-kanban-installer'; 'Accept' = 'application/vnd.github+json' }
$asset = $release.assets | Where-Object { $_.name -like '*win-setup.exe' } | Select-Object -First 1
if (-not $asset) { throw "このリリースにインストーラー（*win-setup.exe）が見つかりません" }

$tmp = Join-Path $env:TEMP $asset.name
Info "ダウンロードしています: $($asset.name)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -UseBasicParsing
Unblock-File -Path $tmp

Info "インストールしています…"
# /S で画面を出さずにインストール（ユーザーごと: %LOCALAPPDATA%\Programs\agent-kanban）
$p = Start-Process -FilePath $tmp -ArgumentList '/S' -Wait -PassThru
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { throw "インストーラーが終了コード $($p.ExitCode) で終了しました" }

$exe = @('agent-kanban', 'claude-agent-kanban', 'Claude Agent Kanban') |
  ForEach-Object { Join-Path $env:LOCALAPPDATA "Programs\$_\Claude Agent Kanban.exe" } |
  Where-Object { Test-Path $_ } | Select-Object -First 1
Info "インストールしました（$($release.tag_name)）。スタートメニューの「Claude Agent Kanban」から起動できます。"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn 'git が見つかりません。Git for Windows をインストールしてください: https://git-scm.com/' }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Warn 'claude が見つかりません。Claude Code をインストールしてログインしてください: https://docs.claude.com/en/docs/claude-code' }

if ($exe -and -not $env:AGENT_KANBAN_NO_LAUNCH) {
  Info '起動します'
  Start-Process -FilePath $exe
}

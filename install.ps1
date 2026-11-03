# Claude Agent Kanban のインストーラー（Windows）
#
#   irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
#
# バージョンを指定する:  $env:AGENT_KANBAN_VERSION = "0.1.1"; irm ... | iex
# アンインストール:      $env:AGENT_KANBAN_UNINSTALL = "1"; irm ... | iex
#
# インストーラー（setup.exe）は使わず、zip を %LOCALAPPDATA%\Programs\Claude Agent Kanban に展開して
# スタートメニューとデスクトップにショートカットを作る（管理者権限は不要）。
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest を速くする

$repo = 'kazuya83/agent-kanban'
$appName = 'Claude Agent Kanban'
$version = if ($env:AGENT_KANBAN_VERSION) { $env:AGENT_KANBAN_VERSION } else { 'latest' }
$dest = Join-Path $env:LOCALAPPDATA "Programs\$appName"
$exe = Join-Path $dest "$appName.exe"
$startMenuLnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$appName.lnk"
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "警告: $msg" -ForegroundColor Yellow }

function Stop-App {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$dest\*" } | ForEach-Object {
    Info "起動中の $appName を終了します"
    $_ | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
}

if ($env:AGENT_KANBAN_UNINSTALL) {
  Stop-App
  foreach ($p in @($dest, $startMenuLnk, $desktopLnk)) {
    if (Test-Path $p) { Remove-Item $p -Recurse -Force; Info "削除しました: $p" }
  }
  Info 'ボードのデータ（%APPDATA%\agent-kanban）は残しています。不要なら手動で削除してください。'
  return
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$api = if ($version -eq 'latest') { "https://api.github.com/repos/$repo/releases/latest" } else { "https://api.github.com/repos/$repo/releases/tags/v$($version.TrimStart('v'))" }
Info "リリース情報を取得しています（${version}）"
$release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'claude-agent-kanban-installer'; 'Accept' = 'application/vnd.github+json' }
$asset = $release.assets | Where-Object { $_.name -like '*win-x64.zip' } | Select-Object -First 1
if (-not $asset) { throw "このリリース（$($release.tag_name)）に Windows 用の zip がありません。v0.1.1 以降を指定してください" }

$tmpDir = Join-Path $env:TEMP ("claude-agent-kanban-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
try {
  $zip = Join-Path $tmpDir $asset.name
  Info "ダウンロードしています: $($asset.name)（$([math]::Round($asset.size / 1MB)) MB）"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
  Unblock-File -Path $zip

  Info '展開しています…'
  $unpacked = Join-Path $tmpDir 'app'
  Expand-Archive -Path $zip -DestinationPath $unpacked -Force
  # zip の中身がフォルダ1つに入っている場合にも対応する
  $root = $unpacked
  if (-not (Test-Path (Join-Path $root "$appName.exe"))) {
    $found = Get-ChildItem $unpacked -Recurse -Filter "$appName.exe" | Select-Object -First 1
    if (-not $found) { throw "zip の中に $appName.exe が見つかりません" }
    $root = $found.DirectoryName
  }

  Stop-App
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
  Move-Item -Path $root -Destination $dest
} finally {
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
Get-ChildItem $dest -Recurse -File | Unblock-File

# ショートカット
$shell = New-Object -ComObject WScript.Shell
foreach ($lnkPath in @($startMenuLnk, $desktopLnk)) {
  try {
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = $exe
    $lnk.WorkingDirectory = $dest
    $lnk.IconLocation = "$exe,0"
    $lnk.Save()
  } catch {
    Warn "ショートカットを作れませんでした: $lnkPath"
  }
}

Info "インストールしました: $dest（$($release.tag_name)）"
Info "スタートメニューとデスクトップの「$appName」から起動できます。"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn 'git が見つかりません。Git for Windows をインストールしてください: https://git-scm.com/' }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Warn 'claude が見つかりません。Claude Code をインストールしてログインしてください: https://docs.claude.com/en/docs/claude-code' }

if (-not $env:AGENT_KANBAN_NO_LAUNCH) {
  Info '起動します'
  Start-Process -FilePath $exe -WorkingDirectory $dest
}

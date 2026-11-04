# Agent Kanban のインストーラー（Windows）
#
#   irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
#
# バージョンを指定する:  $env:AGENT_KANBAN_VERSION = "0.1.2"; irm ... | iex
# アンインストール:      $env:AGENT_KANBAN_UNINSTALL = "1"; irm ... | iex
#
# インストーラー（setup.exe）は使わず、zip を %LOCALAPPDATA%\Programs\Agent Kanban に展開して
# スタートメニューとデスクトップにショートカットを作る（管理者権限は不要）。
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest を速くする

$repo = 'kazuya83/agent-kanban'
$appName = 'Agent Kanban'
# 前の名前（Claude Agent Kanban）で入れたものは、入れ替えるときに片付ける
$oldAppName = 'Claude Agent Kanban'
$version = if ($env:AGENT_KANBAN_VERSION) { $env:AGENT_KANBAN_VERSION } else { 'latest' }
$dest = Join-Path $env:LOCALAPPDATA "Programs\$appName"
$exe = Join-Path $dest "$appName.exe"
$startMenuLnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$appName.lnk"
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"
$oldDest = Join-Path $env:LOCALAPPDATA "Programs\$oldAppName"
$oldLinks = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$oldAppName.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$oldAppName.lnk")
)

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "警告: $msg" -ForegroundColor Yellow }

function Stop-App {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like "$dest\*" -or $_.Path -like "$oldDest\*") } | ForEach-Object {
    Info "起動中の $appName を終了します"
    $_ | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
}

# 前の名前で入れたアプリとショートカットを消す
function Remove-OldApp {
  foreach ($p in @($oldDest) + $oldLinks) {
    if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue; Info "前の名前のものを削除しました: $p" }
  }
}

if ($env:AGENT_KANBAN_UNINSTALL) {
  Stop-App
  foreach ($p in @($dest, $startMenuLnk, $desktopLnk)) {
    if (Test-Path $p) { Remove-Item $p -Recurse -Force; Info "削除しました: $p" }
  }
  Remove-OldApp
  Info 'ボードのデータ（%APPDATA%\agent-kanban）は残しています。不要なら手動で削除してください。'
  return
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# GitHub API は使わない（未ログインだと回数制限で 403 になることがあるため）。
# 最新版は github.com/.../releases/latest のリダイレクト先（.../releases/tag/v0.1.2）から調べる
Info "リリース情報を取得しています（${version}）"
if ($version -eq 'latest') {
  $resp = Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest" -Method Head -UseBasicParsing
  # Windows PowerShell 5.1 と PowerShell 7 で、最終的な URL の取り方が違う
  $final = if ($resp.BaseResponse.ResponseUri) { $resp.BaseResponse.ResponseUri.AbsoluteUri } else { $resp.BaseResponse.RequestMessage.RequestUri.AbsoluteUri }
  $tag = ($final.TrimEnd('/') -split '/')[-1]
} else {
  $tag = "v$($version.TrimStart('v'))"
}
if ($tag -notmatch '^v\d') { throw "リリースが見つかりません（$tag）" }
$tagNum = $tag.TrimStart('v')
$assetName = "agent-kanban-$tagNum-win-x64.zip"
$assetUrl = "https://github.com/$repo/releases/download/$tag/$assetName"
# 前の名前のころのリリース（claude-agent-kanban-…）
$oldAssetName = "claude-agent-kanban-$tagNum-win-x64.zip"
$oldAssetUrl = "https://github.com/$repo/releases/download/$tag/$oldAssetName"

$tmpDir = Join-Path $env:TEMP ("agent-kanban-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
try {
  $zip = Join-Path $tmpDir $assetName
  Info "ダウンロードしています: $assetName"
  try {
    Invoke-WebRequest -Uri $assetUrl -OutFile $zip -UseBasicParsing
  } catch {
    try {
      Info "ダウンロードしています: $oldAssetName"
      Invoke-WebRequest -Uri $oldAssetUrl -OutFile $zip -UseBasicParsing
    } catch {
      throw "ダウンロードできませんでした: $assetUrl（バージョン $tag に Windows 用の zip があるか、https://github.com/$repo/releases で確認してください。zip は v0.1.1 以降にあります）"
    }
  }
  Unblock-File -Path $zip

  Info '展開しています…'
  $unpacked = Join-Path $tmpDir 'app'
  Expand-Archive -Path $zip -DestinationPath $unpacked -Force
  # zip の中身がフォルダ1つに入っている場合にも対応する（前の名前のころのリリースなら Claude Agent Kanban.exe）
  $found = Get-ChildItem $unpacked -Recurse -Filter "$appName.exe" | Select-Object -First 1
  if (-not $found) { $found = Get-ChildItem $unpacked -Recurse -Filter "$oldAppName.exe" | Select-Object -First 1 }
  if (-not $found) { throw "zip の中に $appName.exe が見つかりません" }
  $root = $found.DirectoryName
  $exe = Join-Path $dest $found.Name

  Stop-App
  Remove-OldApp
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

Info "インストールしました: $dest（$tag）"
Info "スタートメニューとデスクトップの「$appName」から起動できます。"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn 'git が見つかりません。Git for Windows をインストールしてください: https://git-scm.com/' }
if (-not (Get-Command claude -ErrorAction SilentlyContinue) -and -not (Get-Command codex -ErrorAction SilentlyContinue) -and -not (Get-Command gemini -ErrorAction SilentlyContinue)) {
  Warn 'エージェントの CLI（claude / codex / gemini）が見つかりません。使うものをインストールしてログインしてください（Claude Code・Codex CLI・Gemini CLI）。'
}

if (-not $env:AGENT_KANBAN_NO_LAUNCH) {
  Info '起動します'
  Start-Process -FilePath $exe -WorkingDirectory $dest
}

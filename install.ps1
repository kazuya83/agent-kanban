# Agent Kanban installer (Windows)
#
#   irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
#
# Pin a version:  $env:AGENT_KANBAN_VERSION = "0.1.2"; irm ... | iex
# Uninstall:      $env:AGENT_KANBAN_UNINSTALL = "1"; irm ... | iex
#
# This does not use setup.exe. It extracts the zip into %LOCALAPPDATA%\Programs\Agent Kanban
# and creates Start menu and desktop shortcuts (no administrator privileges required).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # makes Invoke-WebRequest faster

$repo = 'kazuya83/agent-kanban'
$appName = 'Agent Kanban'
# Builds installed under the previous name (Claude Agent Kanban) are removed on replace
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
function Warn($msg) { Write-Host "Warning: $msg" -ForegroundColor Yellow }

function Stop-App {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like "$dest\*" -or $_.Path -like "$oldDest\*") } | ForEach-Object {
    Info "Quitting running $appName"
    $_ | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
}

# Remove the app and shortcuts installed under the previous name
function Remove-OldApp {
  foreach ($p in @($oldDest) + $oldLinks) {
    if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue; Info "Removed the previous app: $p" }
  }
}

if ($env:AGENT_KANBAN_UNINSTALL) {
  Stop-App
  foreach ($p in @($dest, $startMenuLnk, $desktopLnk)) {
    if (Test-Path $p) { Remove-Item $p -Recurse -Force; Info "Removed: $p" }
  }
  Remove-OldApp
  Info 'Board data (%APPDATA%\agent-kanban) was left in place. Delete it manually if you no longer need it.'
  return
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Do not use the GitHub API (unauthenticated calls can hit the rate limit and return 403).
# The latest release is taken from the redirect target of github.com/.../releases/latest (.../releases/tag/v0.1.2).
Info "Fetching release information (${version})"
if ($version -eq 'latest') {
  $resp = Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest" -Method Head -UseBasicParsing
  # Windows PowerShell 5.1 and PowerShell 7 expose the final URL differently
  $final = if ($resp.BaseResponse.ResponseUri) { $resp.BaseResponse.ResponseUri.AbsoluteUri } else { $resp.BaseResponse.RequestMessage.RequestUri.AbsoluteUri }
  $tag = ($final.TrimEnd('/') -split '/')[-1]
} else {
  $tag = "v$($version.TrimStart('v'))"
}
if ($tag -notmatch '^v\d') { throw "Release not found ($tag)" }
$tagNum = $tag.TrimStart('v')
$assetName = "agent-kanban-$tagNum-win-x64.zip"
$assetUrl = "https://github.com/$repo/releases/download/$tag/$assetName"
# Release from when the project used the previous name (claude-agent-kanban-…)
$oldAssetName = "claude-agent-kanban-$tagNum-win-x64.zip"
$oldAssetUrl = "https://github.com/$repo/releases/download/$tag/$oldAssetName"

$tmpDir = Join-Path $env:TEMP ("agent-kanban-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
try {
  $zip = Join-Path $tmpDir $assetName
  Info "Downloading: $assetName"
  try {
    Invoke-WebRequest -Uri $assetUrl -OutFile $zip -UseBasicParsing
  } catch {
    try {
      Info "Downloading: $oldAssetName"
      Invoke-WebRequest -Uri $oldAssetUrl -OutFile $zip -UseBasicParsing
    } catch {
      throw "Download failed: $assetUrl (check that version $tag has a Windows zip at https://github.com/$repo/releases. The zip exists from v0.1.1 onward)"
    }
  }
  Unblock-File -Path $zip

  Info 'Extracting...'
  $unpacked = Join-Path $tmpDir 'app'
  Expand-Archive -Path $zip -DestinationPath $unpacked -Force
  # Also handle a zip whose contents sit in a single folder (Claude Agent Kanban.exe for a release from the previous name)
  $found = Get-ChildItem $unpacked -Recurse -Filter "$appName.exe" | Select-Object -First 1
  if (-not $found) { $found = Get-ChildItem $unpacked -Recurse -Filter "$oldAppName.exe" | Select-Object -First 1 }
  if (-not $found) { throw "Could not find $appName.exe inside the zip" }
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

# Shortcuts
$shell = New-Object -ComObject WScript.Shell
foreach ($lnkPath in @($startMenuLnk, $desktopLnk)) {
  try {
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = $exe
    $lnk.WorkingDirectory = $dest
    $lnk.IconLocation = "$exe,0"
    $lnk.Save()
  } catch {
    Warn "Could not create shortcut: $lnkPath"
  }
}

Info "Installed: $dest ($tag)"
Info "Launch it from `"$appName`" on the Start menu or the desktop."

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn 'git was not found. Install Git for Windows: https://git-scm.com/' }
if (-not (Get-Command claude -ErrorAction SilentlyContinue) -and -not (Get-Command codex -ErrorAction SilentlyContinue) -and -not (Get-Command gemini -ErrorAction SilentlyContinue) -and -not (Get-Command cursor-agent -ErrorAction SilentlyContinue)) {
  Warn 'No agent CLI (claude / codex / gemini / cursor-agent) was found. Install the one you use and sign in (Claude Code, Codex CLI, Gemini CLI, or Cursor CLI).'
}

if (-not $env:AGENT_KANBAN_NO_LAUNCH) {
  Info 'Launching'
  Start-Process -FilePath $exe -WorkingDirectory $dest
}

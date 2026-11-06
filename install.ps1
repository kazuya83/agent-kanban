# Worktree Kanban installer (Windows)
#
#   irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
#
# Pin a version:  $env:WORKTREE_KANBAN_VERSION = "0.1.2"; irm ... | iex
# Uninstall:      $env:WORKTREE_KANBAN_UNINSTALL = "1"; irm ... | iex
#
# This does not use setup.exe. It extracts the zip into %LOCALAPPDATA%\Programs\Worktree Kanban
# and creates Start menu and desktop shortcuts (no administrator privileges required).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # makes Invoke-WebRequest faster

$repo = 'kazuya83/worktree-kanban'
$appName = 'Worktree Kanban'
# Builds installed under previous names are removed on replace
$oldAppNames = @('Agent Kanban', 'Claude Agent Kanban')
# AGENT_KANBAN_VERSION is what apps from before the rename pass when they update themselves
$version = if ($env:WORKTREE_KANBAN_VERSION) { $env:WORKTREE_KANBAN_VERSION } elseif ($env:AGENT_KANBAN_VERSION) { $env:AGENT_KANBAN_VERSION } else { 'latest' }
$dest = Join-Path $env:LOCALAPPDATA "Programs\$appName"
$exe = Join-Path $dest "$appName.exe"
$startMenuLnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$appName.lnk"
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"
$oldDests = @($oldAppNames | ForEach-Object { Join-Path $env:LOCALAPPDATA "Programs\$_" })
$oldLinks = @($oldAppNames | ForEach-Object {
  Join-Path ([Environment]::GetFolderPath('Programs')) "$_.lnk"
  Join-Path ([Environment]::GetFolderPath('Desktop')) "$_.lnk"
})

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "Warning: $msg" -ForegroundColor Yellow }

function Stop-App {
  foreach ($d in @($dest) + $oldDests) {
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$d\*" } | ForEach-Object {
      Info "Quitting running $appName"
      $_ | Stop-Process -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 500
}

# Remove the app and shortcuts installed under previous names
function Remove-OldApp {
  foreach ($p in $oldDests + $oldLinks) {
    if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue; Info "Removed the previous app: $p" }
  }
}

if ($env:WORKTREE_KANBAN_UNINSTALL -or $env:AGENT_KANBAN_UNINSTALL) {
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
# Releases from before the rename have files named after the previous names
$assetNames = @('worktree-kanban', 'agent-kanban', 'claude-agent-kanban') | ForEach-Object { "$_-$tagNum-win-x64.zip" }

$tmpDir = Join-Path $env:TEMP ("worktree-kanban-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
try {
  $zip = Join-Path $tmpDir 'app.zip'
  $downloaded = $false
  foreach ($name in $assetNames) {
    Info "Downloading: $name"
    try {
      Invoke-WebRequest -Uri "https://github.com/$repo/releases/download/$tag/$name" -OutFile $zip -UseBasicParsing
      $downloaded = $true
      break
    } catch { }
  }
  if (-not $downloaded) { throw "Download failed: $($assetNames[0]) (check that version $tag has a Windows zip at https://github.com/$repo/releases. The zip exists from v0.1.1 onward)" }
  Unblock-File -Path $zip

  Info 'Extracting...'
  $unpacked = Join-Path $tmpDir 'app'
  Expand-Archive -Path $zip -DestinationPath $unpacked -Force
  # Also handle a zip whose contents sit in a single folder (a previous name's exe for a release from before the rename)
  $found = $null
  foreach ($n in @($appName) + $oldAppNames) {
    if (-not $found) { $found = Get-ChildItem $unpacked -Recurse -Filter "$n.exe" | Select-Object -First 1 }
  }
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
if (-not (Get-Command claude -ErrorAction SilentlyContinue) -and -not (Get-Command codex -ErrorAction SilentlyContinue) -and -not (Get-Command agy -ErrorAction SilentlyContinue) -and -not (Get-Command gemini -ErrorAction SilentlyContinue) -and -not (Get-Command cursor-agent -ErrorAction SilentlyContinue)) {
  Warn 'No agent CLI (claude / codex / agy / gemini / cursor-agent) was found. Install the one you use and sign in (Claude Code, Codex CLI, Antigravity CLI, Gemini CLI, or Cursor CLI).'
}

if (-not $env:WORKTREE_KANBAN_NO_LAUNCH -and -not $env:AGENT_KANBAN_NO_LAUNCH) {
  Info 'Launching'
  Start-Process -FilePath $exe -WorkingDirectory $dest
}

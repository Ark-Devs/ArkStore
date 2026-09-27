# ArkStore iPhone setup for Windows: gets this PC ready to install SideStore on an iPhone or iPad.
#   1. Checks Windows (64-bit; not Windows 10 on Arm).
#   2. Installs Apple's iPhone drivers (iTunes from Apple, through winget or Apple's own
#      installer) unless iTunes or the Apple Devices app is already there.
#   3. Downloads and installs iloader (github.com/nab138/iloader), then opens it.
# What's left is in iloader: plug in the iPhone, sign in with your Apple Account and choose
# Install SideStore. Run it with ArkStore-iPhone-Setup.bat, or in PowerShell:
#   irm https://ark-devs.github.io/ArkStore/ios-setup/setup-windows.ps1 | iex

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Guide = 'https://ark-devs.github.io/ArkStore/download/'
$Iloader = 'https://github.com/nab138/iloader/releases/latest/download/iloader-windows-x64.msi'

function Step($n, $text) { Write-Host "`n[$n/4] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "      $text" -ForegroundColor Green }
function Note($text) { Write-Host "      $text" -ForegroundColor Yellow }
# Stops the setup without closing the window (the script also runs through `irm | iex`).
function Fail($text) {
  Write-Host "`n$text" -ForegroundColor Red
  Write-Host "The full guide: $Guide"
  throw 'ArkStoreSetupStopped'
}

try {
  Write-Host 'ArkStore iPhone setup' -ForegroundColor White
  Write-Host 'Gets this PC ready to install SideStore. Nothing is changed on your iPhone yet.'

  Step 1 'Checking Windows'
  if (-not [Environment]::Is64BitOperatingSystem) { Fail 'SideStore setup needs 64-bit Windows.' }
  $build = [Environment]::OSVersion.Version.Build
  $arm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'
  if ($arm -and $build -lt 22000) { Fail 'Windows 10 on Arm is not supported by iloader. Use Windows 11, or another computer.' }
  Ok "Windows build $build$(if ($arm) { ' (Arm, runs the x64 version)' })"

  Step 2 "Apple's iPhone drivers"
  $service = Get-Service -Name 'Apple Mobile Device Service' -ErrorAction SilentlyContinue
  $devicesApp = Get-AppxPackage -Name '*AppleDevices*' -ErrorAction SilentlyContinue
  if ($service -or $devicesApp) {
    Ok $(if ($devicesApp) { 'Apple Devices app found' } else { 'iTunes (Apple Mobile Device Service) found' })
  } else {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $installed = $false
    if ($winget) {
      Note 'Installing iTunes from Apple with winget (a few minutes)...'
      & winget install -e --id Apple.iTunes --accept-package-agreements --accept-source-agreements --silent
      $installed = $LASTEXITCODE -eq 0
    }
    if (-not $installed) {
      Note "Downloading iTunes from Apple's website..."
      $itunes = Join-Path $env:TEMP 'iTunes64Setup.exe'
      Invoke-WebRequest -Uri 'https://www.apple.com/itunes/download/win64' -OutFile $itunes -UseBasicParsing
      Note 'Finish the iTunes installer that opens, then come back here.'
      Start-Process -FilePath $itunes -Wait
    }
    if (-not (Get-Service -Name 'Apple Mobile Device Service' -ErrorAction SilentlyContinue)) {
      Note 'iTunes may need a restart of Windows before your iPhone shows up.'
    } else {
      Ok 'iTunes installed'
    }
  }

  Step 3 'Installing iloader'
  $msi = Join-Path $env:TEMP 'iloader-windows-x64.msi'
  try {
    Invoke-WebRequest -Uri $Iloader -OutFile $msi -UseBasicParsing
  } catch {
    Fail "Couldn't download iloader ($($_.Exception.Message)). Check your internet connection and run this again."
  }
  $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/passive', '/norestart') -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { Fail "The iloader installer stopped (code $($p.ExitCode))." }
  Ok 'iloader installed'

  Step 4 'Opening iloader'
  $exe = Get-ChildItem -Path "$env:ProgramFiles", "${env:ProgramFiles(x86)}", "$env:LOCALAPPDATA\Programs" -Filter 'iloader*.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch 'uninstall' } | Select-Object -First 1
  if ($exe) { Start-Process -FilePath $exe.FullName; Ok 'iloader is open' } else { Note 'Open iloader from the Start menu.' }

  Write-Host "`nNow, in iloader:" -ForegroundColor White
  Write-Host '  1. Plug in your iPhone or iPad. If it asks, tap Trust and enter your passcode.'
  Write-Host '  2. Sign in with your Apple Account (the email is case-sensitive).'
  Write-Host '  3. Pick your device and choose Install SideStore (Stable).'
  Write-Host "`nThen on the iPhone: trust your Apple Account (Settings > General > VPN & Device Management),"
  Write-Host 'turn on Developer Mode, connect LocalDevVPN and open SideStore. Step by step:'
  Write-Host "  $Guide" -ForegroundColor Cyan
} catch {
  if ($_.Exception.Message -ne 'ArkStoreSetupStopped') {
    Write-Host "`nThe setup stopped: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "The full guide: $Guide"
  }
}

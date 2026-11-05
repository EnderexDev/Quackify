# One mode of the tray rest (rest.rs), measured: starts the Quackify Dev build with
# QUACKIFY_TRAY_REST=<Mode>, then <Cycles> times closes the window to the tray (WM_CLOSE, the X
# button's path), reads the memory at 10, 30 and 60 s, and brings it back by launching the exe
# again (the single-instance plugin calls show_window, as the tray click does). The time from
# show_window to the page's second frame is in the log ("rest: painted").
# Usage: powershell -File bench/tray-cycle.ps1 -Exe <quackify.exe> -Mode low [-Cycles 5] [-Keep]
param([string]$Exe, [string]$Mode = "off", [int]$Cycles = 5, [string]$At = "10,30,60", [switch]$Keep, [switch]$NoStart)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
$title = "Quackify Dev"
function Ram($label) { & powershell -NoProfile -File "$here\tray-ram.ps1" -Label $label }
# The visible main window of the running build (FindWindow by title finds a hidden helper
# window with the same title first).
function Main {
  $p = Get-Process quackify -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe } | Select-Object -First 1
  $p.Refresh(); $p.MainWindowHandle
}

if (-not $NoStart) {
  Get-Process quackify -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe } | Stop-Process -Force
  Start-Sleep 2
  $env:QUACKIFY_TRAY_REST = $Mode
  Start-Process $Exe
  Start-Sleep 20
}
"mode=$Mode"
Ram "visible"
for ($i = 1; $i -le $Cycles; $i++) {
  $h = Main
  if ($h -eq [IntPtr]::Zero) { throw "no visible main window" }
  [void][W]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  $start = Get-Date
  foreach ($s in ($At -split ",") | ForEach-Object { [int]$_ }) {
    $wait = $s - ((Get-Date) - $start).TotalSeconds
    if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
    Ram "cycle$i hidden+${s}s visible=$([W]::IsWindowVisible($h))"
  }
  Start-Process $Exe
  Start-Sleep 8
  Ram "cycle$i shown+8s"
}
if (-not $Keep) {
  Get-Process quackify -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe } | Stop-Process -Force
}

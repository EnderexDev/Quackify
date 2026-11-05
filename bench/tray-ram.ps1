# Private memory of one Quackify's processes, by WebView2 process type (Win32_Process + --type=).
# Usage: powershell -File bench/tray-ram.ps1 [-Id dev.enderex.quackify.dev] [-Label text]
# The WebView2 processes are the ones whose --user-data-dir is that identifier's EBWebView.
param([string]$Id = "dev.enderex.quackify.dev", [string]$Label = "")
$procs = Get-CimInstance Win32_Process
$dir = "\$Id\EBWebView"
$wv = $procs | Where-Object { $_.Name -eq "msedgewebview2.exe" -and $_.CommandLine -and $_.CommandLine.Contains($dir) }
$browser = $wv | Where-Object { $_.CommandLine -notmatch "--type=" }
$host_ = $procs | Where-Object { $browser -and $_.ProcessId -eq $browser[0].ParentProcessId }
$rows = @{}
function Add($kind, $bytes) { if (-not $rows.ContainsKey($kind)) { $rows[$kind] = 0 }; $rows[$kind] += $bytes }
foreach ($p in $wv) {
  $c = $p.CommandLine
  if ($c -match "--type=([a-z-]+)") { $kind = $Matches[1] } else { $kind = "browser" }
  if ($kind -eq "utility") {
    if ($c -match "--utility-sub-type=([a-zA-Z.]+)") { $kind = "utility:" + ($Matches[1] -replace "\.mojom\..*", "") }
  }
  if ($kind -eq "renderer" -and $c -match "--extension-process") { $kind = "renderer:extension" }
  Add $kind $p.PrivatePageCount
}
foreach ($h in $host_) { Add ("host:" + $h.Name) $h.PrivatePageCount }
$total = ($rows.Values | Measure-Object -Sum).Sum
$line = ($rows.GetEnumerator() | Sort-Object Name | ForEach-Object { "{0}={1:N0}" -f $_.Name, ($_.Value / 1MB) }) -join " "
"{0} total={1:N0} MB n={2} {3}" -f $Label, ($total / 1MB), $wv.Count, $line

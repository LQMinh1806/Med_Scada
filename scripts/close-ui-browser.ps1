param(
  [string]$PidFile = '.runtime/browser.pid',
  [string]$Url = 'http://192.168.1.91:5173/'
)

$ErrorActionPreference = 'SilentlyContinue'
$stoppedAny = $false

if (Test-Path $PidFile) {
  $raw = (Get-Content -Path $PidFile -Raw).Trim()
  $pidValue = 0
  if ([int]::TryParse($raw, [ref]$pidValue) -and $pidValue -gt 0) {
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      $stoppedAny = $true
    }
  }

  Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
}

if (-not $stoppedAny) {
  $urlKey = $Url.ToLowerInvariant()
  $candidates = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($urlKey)
  }

  foreach ($p in $candidates) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $stoppedAny = $true
  }
}

if ($stoppedAny) {
  Write-Output '[OK] Closed browser window for UI.'
} else {
  Write-Output '[INFO] No tracked UI browser process found.'
}

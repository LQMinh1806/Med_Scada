param(
  [string]$Url = 'http://192.168.1.91:5173/',
  [int]$Port = 5173,
  [int]$TimeoutSeconds = 120,
  [string]$PidFile = '.runtime/browser.pid',
  [switch]$WaitForPort
)

$ErrorActionPreference = 'SilentlyContinue'

function Test-TcpPortOpen {
  param(
    [string]$ComputerName,
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($ComputerName, $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(150)) {
      return $false
    }

    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if ($WaitForPort) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-TcpPortOpen -ComputerName '127.0.0.1' -Port $Port) { break }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
}

$pidDir = Split-Path -Parent $PidFile
if ($pidDir) {
  New-Item -Path $pidDir -ItemType Directory -Force | Out-Null
}

$browserCandidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
  "$env:ProgramFiles(x86)\Mozilla Firefox\firefox.exe"
)

$browserPath = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($browserPath) {
  $proc = Start-Process -FilePath $browserPath -ArgumentList $Url -PassThru
  if ($proc) {
    Set-Content -Path $PidFile -Value $proc.Id -Encoding ascii
  }
} else {
  Start-Process $Url | Out-Null
}

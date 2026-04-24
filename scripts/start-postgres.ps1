$ErrorActionPreference = 'Stop'

$services = Get-Service | Where-Object {
  $_.Name -match '^(postgres|postgresql)' -or $_.DisplayName -match '(?i)postgres'
}

if (-not $services -or $services.Count -eq 0) {
  Write-Error "Khong tim thay Windows service PostgreSQL. Cai PostgreSQL local hoac dung 'npm run db:up:docker'."
  exit 1
}

$running = $services | Where-Object { $_.Status -eq 'Running' } | Select-Object -First 1
if ($running) {
  Write-Output ("PostgreSQL da dang chay: " + $running.Name)
  exit 0
}

$target = $services | Select-Object -First 1
Write-Output ("Dang khoi dong PostgreSQL service: " + $target.Name)
Start-Service -Name $target.Name
$status = (Get-Service -Name $target.Name).Status
if ($status -ne 'Running') {
  Write-Error ("Khong the khoi dong service " + $target.Name)
  exit 1
}

Write-Output ("Da khoi dong PostgreSQL: " + $target.Name)

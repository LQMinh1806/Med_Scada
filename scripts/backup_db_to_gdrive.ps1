# ============================================================
# backup_db_to_gdrive.ps1
# Backup PostgreSQL database robot_ui → Google Drive
# Chạy: powershell -ExecutionPolicy Bypass -File backup_db_to_gdrive.ps1
# Hoặc đặt lịch tự động bằng Windows Task Scheduler
# ============================================================

# ── Cấu hình ─────────────────────────────────────────────────
$PG_HOST     = "localhost"
$PG_PORT     = "5432"
$PG_DB       = "robot_ui"
$PG_USER     = "postgres"
$PG_PASSWORD = "postgres"           # Đổi nếu password khác

# Thư mục backup tạm (trong project, tự xóa sau khi upload)
$BACKUP_DIR  = "$PSScriptRoot\backups"
$RCLONE_REMOTE = "gdrive"           # Tên remote đã cấu hình trong rclone
$GDRIVE_FOLDER = "robot-ui-backups" # Thư mục trên Google Drive

# Giữ lại bao nhiêu bản backup local (bản cũ hơn sẽ bị xóa)
$KEEP_LOCAL = 3

# ── Tạo thư mục backup nếu chưa có ───────────────────────────
if (-not (Test-Path $BACKUP_DIR)) {
    New-Item -ItemType Directory -Path $BACKUP_DIR | Out-Null
}

# ── Tên file theo timestamp ───────────────────────────────────
$timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$BACKUP_DIR\medscada_$timestamp.sql"
$zipFile    = "$BACKUP_DIR\medscada_$timestamp.sql.gz"

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  ROBOT-UI DATABASE BACKUP" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')" -ForegroundColor Cyan
Write-Host "================================`n" -ForegroundColor Cyan

# ── Kiểm tra pg_dump có trong PATH không ─────────────────────
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    # Ưu tiên đường dẫn thực tế trên máy của bạn
    $pgDump = "D:\SQL\bin\pg_dump.exe"
    if (-not (Test-Path $pgDump)) {
        $pgDump = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
    }
    if (-not (Test-Path $pgDump)) {
        $pgDump = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
    }
    if (-not (Test-Path $pgDump)) {
        $pgDump = "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
    }
    if (-not (Test-Path $pgDump)) {
        Write-Host "❌ Không tìm thấy pg_dump. Cài PostgreSQL hoặc thêm vào PATH." -ForegroundColor Red
        exit 1
    }
} else {
    $pgDump = $pgDump.Source
}

# ── Chạy pg_dump ──────────────────────────────────────────────
Write-Host "🔄 Đang backup database '$PG_DB'..." -ForegroundColor Yellow
$env:PGPASSWORD = $PG_PASSWORD

& $pgDump `
    --host=$PG_HOST `
    --port=$PG_PORT `
    --username=$PG_USER `
    --format=plain `
    --no-password `
    --file=$backupFile `
    $PG_DB

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ pg_dump thất bại (exit code $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}

$sizeMB = [math]::Round((Get-Item $backupFile).Length / 1MB, 2)
Write-Host "✅ Backup thành công: $backupFile ($sizeMB MB)" -ForegroundColor Green

# ── Nén file bằng gzip (tích hợp sẵn trong PowerShell 5+) ────
Write-Host "🗜  Đang nén file..." -ForegroundColor Yellow
try {
    $inputStream  = [System.IO.File]::OpenRead($backupFile)
    $outputStream = [System.IO.File]::Create($zipFile)
    $gzip         = [System.IO.Compression.GZipStream]::new($outputStream, [System.IO.Compression.CompressionMode]::Compress)

    $inputStream.CopyTo($gzip)

    $gzip.Dispose()
    $outputStream.Dispose()
    $inputStream.Dispose()

    Remove-Item $backupFile -Force  # Xóa file SQL gốc sau khi nén
    $zipSizeMB = [math]::Round((Get-Item $zipFile).Length / 1MB, 2)
    Write-Host "✅ Nén xong: $zipFile ($zipSizeMB MB)" -ForegroundColor Green
} catch {
    Write-Host "⚠  Nén thất bại, sử dụng file .sql gốc. Lỗi: $_" -ForegroundColor Yellow
    $zipFile = $backupFile  # Fallback: upload file SQL không nén
}

# ── Upload lên Google Drive bằng rclone ──────────────────────
$rclone = Get-Command rclone -ErrorAction SilentlyContinue
if ($rclone) {
    $rclonePath = $rclone.Source
} else {
    # Thử đường dẫn tuyệt đối mà winget đã cài đặt
    $rclonePath = "C:\Users\phamk\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.74.4-windows-amd64\rclone.exe"
}

if (-not (Test-Path $rclonePath)) {
    Write-Host "⚠  Không tìm thấy rclone. Bỏ qua upload Google Drive." -ForegroundColor Yellow
    Write-Host "   Cài rclone hoặc restart máy tính để cập nhật biến môi trường PATH." -ForegroundColor Yellow
    Write-Host "   File backup đã lưu tại: $zipFile" -ForegroundColor Cyan
} else {
    $folderId = "1HXPZw42FbDkY7IirRljR1G4kABDNfak2"
    Write-Host "☁  Đang upload lên Google Drive thư mục ID: $folderId..." -ForegroundColor Yellow
    & $rclonePath copy $zipFile "${RCLONE_REMOTE}:" --drive-root-folder-id $folderId

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Upload thành công!" -ForegroundColor Green
    } else {
        Write-Host "❌ Upload thất bại (exit code $LASTEXITCODE). File vẫn còn local." -ForegroundColor Red
    }
}

# ── Dọn dẹp bản backup local cũ ──────────────────────────────
$allBackups = Get-ChildItem "$BACKUP_DIR\medscada_*.sql*" | Sort-Object LastWriteTime -Descending
if ($allBackups.Count -gt $KEEP_LOCAL) {
    $toDelete = $allBackups | Select-Object -Skip $KEEP_LOCAL
    foreach ($file in $toDelete) {
        Remove-Item $file.FullName -Force
        Write-Host "🗑  Đã xóa backup cũ: $($file.Name)" -ForegroundColor DarkGray
    }
}

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "  BACKUP HOÀN THÀNH!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan

// ══════════════════════════════════════════════════════════════════════════════
// backupService.js
// ──────────────────────────────────────────────────────────────────────────────
// Dịch vụ tự động chạy script PowerShell backup PostgreSQL lên Google Drive.
// Tự động chạy khi khởi động server và lập lịch chạy mỗi đêm vào lúc 00:00.
// ══════════════════════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Thực thi file PowerShell để thực hiện backup
 */
export function runBackup() {
  const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'backup_db_to_gdrive.ps1');
  const command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
  
  console.log(`[BackupService] Khởi động tiến trình backup database...`);
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`[BackupService] ❌ Backup thất bại: ${error.message}`);
      return;
    }
    if (stderr && stderr.trim()) {
      console.warn(`[BackupService] ⚠️ Cảnh báo trong lúc backup: ${stderr}`);
    }
    console.log(`[BackupService] ✅ Tiến trình backup hoàn tất:\n${stdout}`);
  });
}

/**
 * Đặt lịch tự động chạy backup mỗi ngày một lần vào lúc 00:00 đêm
 */
export function scheduleDailyBackup() {
  // 1. Chạy thử 1 lần ngay khi khởi động server để đảm bảo kết nối hoạt động tốt
  console.log(`[BackupService] Tiến hành backup khởi động ban đầu...`);
  runBackup();

  // 2. Tính toán thời gian từ bây giờ đến 00:00 đêm tiếp theo
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1, // Ngày mai
    0, 0, 0 // 00:00:00
  );
  
  const msToMidnight = nextMidnight.getTime() - now.getTime();
  const minutesToMidnight = Math.round(msToMidnight / 1000 / 60);
  
  console.log(`[BackupService] Đặt lịch tự động chạy backup mỗi đêm. Lần tiếp theo sau: ${minutesToMidnight} phút (lúc 00:00 sáng mai).`);

  // Thiết lập timeout chờ đến nửa đêm đầu tiên, sau đó đặt Interval lặp lại mỗi 24 tiếng
  setTimeout(() => {
    runBackup();
    
    // Lặp lại mỗi 24 giờ
    setInterval(runBackup, 24 * 60 * 60 * 1000);
  }, msToMidnight);
}

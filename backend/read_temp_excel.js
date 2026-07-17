import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'temp_template.xlsx');
try {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  console.log('--- Original Sheet Name:', sheetName);
  console.log('--- First 5 rows:');
  rows.slice(0, 5).forEach((row, i) => {
    console.log(`Row ${i + 1}:`, row);
  });
} catch (err) {
  console.error('Error reading template:', err);
}

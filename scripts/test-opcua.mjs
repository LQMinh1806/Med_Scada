// ══════════════════════════════════════════════════════════════════════════════
// test-opcua.mjs — Test OPC UA truyền thông với PLC Siemens S7-1200
// ──────────────────────────────────────────────────────────────────────────────
// Chạy: node scripts/test-opcua.mjs
// Yêu cầu: Kepware đang chạy và đã cấu hình Channel + Device + Tags
// ══════════════════════════════════════════════════════════════════════════════

import opcua from 'node-opcua';
import readline from 'readline';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const {
  OPCUAClient,
  MessageSecurityMode,
  SecurityPolicy,
  AttributeIds,
  DataType,
} = opcua;

// ── Cấu hình ────────────────────────────────────────────────────────────────

const OPCUA_ENDPOINT =
  process.env.OPCUA_ENDPOINT || 'opc.tcp://127.0.0.1:49320';

// Tag prefix trong Kepware — phải khớp với Channel.Device.TagGroup bạn đã tạo
// Ví dụ: Channel "PLC1", Device "Cabin", Tag Group để trống
// → Tag "Q0_0" sẽ có NodeId = "ns=2;s=PLC1.Cabin.Q0_0"
const TAG_PREFIX = 'ns=2;s=PLC1.Cabin.';

// Mapping: Trạm → Tag ngõ ra PLC
// Trạm 1 → Q0.0, Trạm 2 → Q0.1, Trạm 3 → Q0.2, Trạm 4 → Q0.3
const STATION_TAGS = {
  1: `${TAG_PREFIX}Q0_0`,   // Ngõ ra Q0.0
  2: `${TAG_PREFIX}Q0_1`,   // Ngõ ra Q0.1
  3: `${TAG_PREFIX}Q0_2`,   // Ngõ ra Q0.2
  4: `${TAG_PREFIX}Q0_3`,   // Ngõ ra Q0.3
};

// Trạng thái hiện tại của các ngõ ra (để toggle)
const outputState = { 1: false, 2: false, 3: false, 4: false };

// ── Kết nối OPC UA ──────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   TEST OPC UA — Gọi Cabin → Bật ngõ ra PLC S7-1200      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Endpoint: ${OPCUA_ENDPOINT}`);
  console.log(`  Tags:`);
  for (const [station, tag] of Object.entries(STATION_TAGS)) {
    console.log(`    Trạm ${station} → ${tag}`);
  }
  console.log();

  // 1. Tạo client
  const client = OPCUAClient.create({
    applicationName: 'SCADA-TestClient',
    connectionStrategy: {
      initialDelay: 1000,
      maxRetry: 3,
      maxDelay: 5000,
    },
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    endpointMustExist: false,
  });

  // 2. Kết nối
  console.log('[1/3] Đang kết nối OPC UA...');
  try {
    await client.connect(OPCUA_ENDPOINT);
    console.log('[OK]  ✓ TCP kết nối thành công!');
  } catch (err) {
    console.error('[LỖI] ✗ Không thể kết nối:', err.message);
    console.error();
    console.error('  Kiểm tra:');
    console.error('    1. Kepware (KepServerEX) đã mở chưa?');
    console.error('    2. OPC UA endpoint đúng chưa? (mặc định: opc.tcp://127.0.0.1:49320)');
    console.error('    3. Firewall có chặn port 49320 không?');
    process.exit(1);
  }

  // 3. Tạo session
  console.log('[2/3] Đang tạo session...');
  let session;
  try {
    session = await client.createSession();
    console.log('[OK]  ✓ Session tạo thành công!');
  } catch (err) {
    console.error('[LỖI] ✗ Không tạo được session:', err.message);
    await client.disconnect();
    process.exit(1);
  }

  // 4. Kiểm tra tag có tồn tại không
  console.log('[3/3] Kiểm tra tags trong Kepware...');
  let allTagsOk = true;
  for (const [station, nodeId] of Object.entries(STATION_TAGS)) {
    try {
      const result = await session.read({
        nodeId,
        attributeId: AttributeIds.Value,
      });
      const statusCode = result.statusCode?.value || result.statusCode;
      if (statusCode === 0) {
        console.log(`  ✓ Trạm ${station}: ${nodeId} — OK (giá trị: ${result.value?.value})`);
      } else {
        console.log(`  ✗ Trạm ${station}: ${nodeId} — LỖI (statusCode: ${statusCode})`);
        allTagsOk = false;
      }
    } catch (err) {
      console.log(`  ✗ Trạm ${station}: ${nodeId} — KHÔNG TÌM THẤY (${err.message})`);
      allTagsOk = false;
    }
  }

  if (!allTagsOk) {
    console.log();
    console.log('  ⚠️  Một số tag chưa được tạo trong Kepware!');
    console.log('  Xem hướng dẫn cấu hình Kepware bên dưới.');
    console.log('  Bạn vẫn có thể thử ghi, nhưng sẽ báo lỗi nếu tag không tồn tại.');
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  HƯỚNG DẪN SỬ DỤNG:');
  console.log('  Nhấn 1–4 rồi Enter → BẬT/TẮT ngõ ra Q0.0–Q0.3');
  console.log('  Nhấn 0   rồi Enter → TẮT TẤT CẢ ngõ ra');
  console.log('  Nhấn r   rồi Enter → ĐỌC trạng thái tất cả tag');
  console.log('  Nhấn q   rồi Enter → THOÁT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log();

  // 5. Interactive loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    const states = Object.entries(outputState)
      .map(([s, v]) => `Q0.${s - 1}=${v ? '🟢ON' : '⚫OFF'}`)
      .join('  ');
    rl.question(`  [${states}] > `, async (answer) => {
      const cmd = answer.trim().toLowerCase();

      if (cmd === 'q') {
        console.log('\n  Đang tắt tất cả ngõ ra trước khi thoát...');
        for (const [station, nodeId] of Object.entries(STATION_TAGS)) {
          try {
            await session.write({
              nodeId,
              attributeId: AttributeIds.Value,
              value: { value: { dataType: DataType.Boolean, value: false } },
            });
            outputState[station] = false;
          } catch { /* ignore */ }
        }
        console.log('  ✓ Đã tắt hết. Đang ngắt kết nối...');
        rl.close();
        await session.close();
        await client.disconnect();
        console.log('  ✓ Đã ngắt kết nối OPC UA. Tạm biệt!\n');
        process.exit(0);
        return;
      }

      if (cmd === '0') {
        console.log('  → Tắt tất cả ngõ ra...');
        for (const [station, nodeId] of Object.entries(STATION_TAGS)) {
          try {
            await session.write({
              nodeId,
              attributeId: AttributeIds.Value,
              value: { value: { dataType: DataType.Boolean, value: false } },
            });
            outputState[station] = false;
            console.log(`    ✓ Q0.${station - 1} → OFF`);
          } catch (err) {
            console.log(`    ✗ Q0.${station - 1} — Lỗi: ${err.message}`);
          }
        }
        prompt();
        return;
      }

      if (cmd === 'r') {
        console.log('  → Đọc trạng thái tags...');
        for (const [station, nodeId] of Object.entries(STATION_TAGS)) {
          try {
            const result = await session.read({
              nodeId,
              attributeId: AttributeIds.Value,
            });
            const val = result.value?.value;
            outputState[station] = Boolean(val);
            console.log(`    Q0.${station - 1} = ${val ? '🟢 ON' : '⚫ OFF'}  (raw: ${val})`);
          } catch (err) {
            console.log(`    Q0.${station - 1} — Lỗi đọc: ${err.message}`);
          }
        }
        prompt();
        return;
      }

      const stationNum = parseInt(cmd);
      if (stationNum >= 1 && stationNum <= 4) {
        const nodeId = STATION_TAGS[stationNum];
        const newValue = !outputState[stationNum];
        console.log(`  → Gọi Cabin Trạm ${stationNum}: Q0.${stationNum - 1} → ${newValue ? 'BẬT' : 'TẮT'}`);

        try {
          const statusCode = await session.write({
            nodeId,
            attributeId: AttributeIds.Value,
            value: {
              value: { dataType: DataType.Boolean, value: newValue },
            },
          });

          if (statusCode.value === 0) {
            outputState[stationNum] = newValue;
            console.log(`    ✓ Ghi thành công! Q0.${stationNum - 1} = ${newValue ? '🟢 ON' : '⚫ OFF'}`);
          } else {
            console.log(`    ✗ Ghi thất bại! StatusCode: ${statusCode.toString()}`);
          }
        } catch (err) {
          console.log(`    ✗ Lỗi ghi: ${err.message}`);
        }

        prompt();
        return;
      }

      console.log('  ⚠️ Lệnh không hợp lệ. Nhấn 1–4, 0, r, hoặc q.');
      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error('Lỗi không xác định:', err);
  process.exit(1);
});

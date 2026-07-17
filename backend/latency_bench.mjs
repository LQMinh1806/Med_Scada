/* global process, performance */
// ════════════════════════════════════════════════════════════════════════════
// backend/latency_bench.mjs  —  Medical SCADA Communication Latency Benchmark
// ════════════════════════════════════════════════════════════════════════════
//
// Đo độ trễ truyền thông của 3 kênh chính trong hệ thống:
//   [1] OPC UA Write  : Backend → Kepware → PLC   (session.write RTT)
//   [2] OPC UA Read   : PLC → Kepware → Node.js   (subscription delay)
//   [3] HTTP API      : Localhost → /api/sensors/cabin (ESP32 proxy test)
//
// Kết quả xuất ra: scripts/latency_report.html  (standalone, Chart.js CDN)
//
// Cách chạy:
//   node backend/latency_bench.mjs
//   node backend/latency_bench.mjs --samples 30 --duration 20 --http 30
//   node backend/latency_bench.mjs --mock        (chế độ demo, không cần PLC)
// ════════════════════════════════════════════════════════════════════════════

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import opcua from 'node-opcua';
const {
  OPCUAClient, MessageSecurityMode, SecurityPolicy,
  AttributeIds, DataType, TimestampsToReturn,
  ClientSubscription, ClientMonitoredItem,
} = opcua;

// ── CLI args ─────────────────────────────────────────────────────────────────
const ARGS          = process.argv.slice(2);
const hasFlag       = (f) => ARGS.includes(f);
const getArg        = (name, def) => {
  const i = ARGS.indexOf(name);
  return (i !== -1 && ARGS[i + 1]) ? Number(ARGS[i + 1]) : def;
};
const MOCK_MODE     = hasFlag('--mock');
const N_WRITE       = getArg('--samples', 50);
const READ_DUR_SEC  = getArg('--duration', 30);
const N_HTTP        = getArg('--http', 50);

// ── Config ────────────────────────────────────────────────────────────────────
const OPCUA_ENDPOINT  = process.env.OPCUA_ENDPOINT || 'opc.tcp://127.0.0.1:49320';
const BACKEND_PORT    = process.env.PORT            || 3000;
const BACKEND_URL     = `http://localhost:${BACKEND_PORT}`;
const SENSOR_API_KEY  = process.env.SENSOR_API_KEY  || 'esp32-sensor-secret-change-me';
const TAG_PREFIX      = 'ns=2;s=PLC1.Cabin.';
const WRITE_NODE      = `${TAG_PREFIX}Maintenance_Mode`;   // safe bool tag
const MONITOR_NODES   = {
  currentStation: `${TAG_PREFIX}Current_Station`,
  cabinReady:     `${TAG_PREFIX}Cabin_Ready`,
};

const OUT_PATH = path.resolve(__dirname, '..', 'scripts', 'latency_report.html');

// ── Utilities ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function calcStats(arr) {
  if (!arr || !arr.length) return null;
  const s  = [...arr].sort((a, b) => a - b);
  const n  = s.length;
  const mu = arr.reduce((acc, v) => acc + v, 0) / n;
  return {
    count:  n,
    min:    +s[0].toFixed(3),
    max:    +s[n - 1].toFixed(3),
    mean:   +(mu).toFixed(3),
    median: n % 2 === 0
              ? +((s[n/2-1] + s[n/2]) / 2).toFixed(3)
              : +s[Math.floor(n/2)].toFixed(3),
    p95:    +s[Math.min(Math.floor(n * 0.95), n - 1)].toFixed(3),
    p99:    +s[Math.min(Math.floor(n * 0.99), n - 1)].toFixed(3),
    stddev: +(Math.sqrt(arr.reduce((acc, v) => acc + (v - mu) ** 2, 0) / n)).toFixed(3),
  };
}

/** Build histogram buckets from an array of numbers */
function buildHistogram(arr, buckets = 20) {
  if (!arr || !arr.length) return { labels: [], counts: [] };
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const width = (max - min) / buckets || 1;
  const counts = new Array(buckets).fill(0);
  arr.forEach(v => {
    const idx = Math.min(Math.floor((v - min) / width), buckets - 1);
    counts[idx]++;
  });
  const labels = counts.map((_, i) => `${(min + i * width).toFixed(1)}`);
  return { labels, counts };
}

// ── Results object ────────────────────────────────────────────────────────────
const results = {
  generatedAt: new Date().toISOString(),
  mockMode:    MOCK_MODE,
  config: {
    opcuaEndpoint:   OPCUA_ENDPOINT,
    backendUrl:      BACKEND_URL,
    nWriteSamples:   N_WRITE,
    readDurationSec: READ_DUR_SEC,
    nHttpSamples:    N_HTTP,
    samplingIntervalMs: 500,
  },
  write: { samples: [], stats: null, error: null },
  read:  { samples: [], stats: null, error: null },
  http:  { samples: [], stats: null, error: null },
};

// ── Mock data generator (--mock mode) ────────────────────────────────────────
function injectMockData() {
  console.log('\n  [MOCK] Generating synthetic latency data for demo...');

  // OPC UA write: typically 3–25ms on localhost LAN, occasional spikes
  results.write.samples = Array.from({ length: N_WRITE }, (_, i) => {
    const base = 6 + Math.random() * 8;
    const spike = Math.random() < 0.08 ? 15 + Math.random() * 20 : 0;
    return +(base + spike + Math.sin(i * 0.3) * 1.5).toFixed(3);
  });

  // OPC UA read: dominated by sampling interval (500ms) ± jitter
  results.read.samples = Array.from({ length: 25 }, (_, i) => {
    const base = 510 + Math.random() * 60;
    const jitter = (Math.random() - 0.5) * 40;
    return Math.max(480, +(base + jitter + Math.cos(i * 0.5) * 15).toFixed(3));
  });

  // HTTP (localhost): very low, typically 2–15ms
  results.http.samples = Array.from({ length: N_HTTP }, (_, i) => {
    const base = 3 + Math.random() * 6;
    const spike = Math.random() < 0.06 ? 10 + Math.random() * 15 : 0;
    return +(base + spike + Math.sin(i * 0.2) * 0.8).toFixed(3);
  });

  results.write.stats = calcStats(results.write.samples);
  results.read.stats  = calcStats(results.read.samples);
  results.http.stats  = calcStats(results.http.samples);

  console.log('  [MOCK] ✓ Write stats:', results.write.stats?.mean.toFixed(1) + 'ms mean');
  console.log('  [MOCK] ✓ Read  stats:', results.read.stats?.mean.toFixed(1)  + 'ms mean');
  console.log('  [MOCK] ✓ HTTP  stats:', results.http.stats?.mean.toFixed(1)  + 'ms mean');
}

// ── [1] OPC UA Write Latency ──────────────────────────────────────────────────
async function measureWrite() {
  console.log(`\n[1/3] OPC UA Write Latency  (endpoint: ${OPCUA_ENDPOINT})`);
  console.log(`      Samples: ${N_WRITE}  •  Tag: ${WRITE_NODE}`);

  let client, session;
  try {
    client  = OPCUAClient.create({
      applicationName: 'SCADA-LatencyBench',
      connectionStrategy: { initialDelay: 1000, maxRetry: 1, maxDelay: 3000 },
      securityMode: MessageSecurityMode.None,
      securityPolicy: SecurityPolicy.None,
      endpointMustExist: false,
      requestedSessionTimeout: 60000,
    });

    await client.connect(OPCUA_ENDPOINT);
    session = await client.createSession();
    console.log('      ✓ Session created');

    const writeOp = (val) => session.write({
      nodeId: WRITE_NODE,
      attributeId: AttributeIds.Value,
      value: { value: { dataType: DataType.Boolean, value: val } },
    });

    // Warmup
    for (let i = 0; i < 5; i++) await writeOp(false);
    console.log('      ✓ Warmup (5 iterations)');

    process.stdout.write('      Sampling: ');
    for (let i = 0; i < N_WRITE; i++) {
      const t0 = performance.now();
      await writeOp(false);
      results.write.samples.push(+(performance.now() - t0).toFixed(3));
      if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1}…`);
      await sleep(100);
    }
    console.log(' done');

    results.write.stats = calcStats(results.write.samples);
    const s = results.write.stats;
    console.log(`      ✓  mean=${s.mean}ms  p95=${s.p95}ms  max=${s.max}ms`);

  } catch (err) {
    results.write.error = err.message;
    console.log(`      ✗ ${err.message}`);
  } finally {
    try { await session?.close();     } catch { /* ignore */ }
    try { await client?.disconnect(); } catch { /* ignore */ }
  }
}

// ── [2] OPC UA Subscription Read Latency ─────────────────────────────────────
async function measureRead() {
  console.log(`\n[2/3] OPC UA Read Subscription Latency  (duration: ${READ_DUR_SEC}s)`);
  console.log('      Measuring: sourceTimestamp → Node.js handler arrival');

  let client, session, subscription;
  let writeClient, writeSession;
  const samples = [];

  try {
    // --- Monitoring client ---
    client  = OPCUAClient.create({
      applicationName: 'SCADA-LatencyBench-Reader',
      connectionStrategy: { initialDelay: 1000, maxRetry: 1, maxDelay: 3000 },
      securityMode: MessageSecurityMode.None,
      securityPolicy: SecurityPolicy.None,
      endpointMustExist: false,
      requestedSessionTimeout: 120000,
    });

    await client.connect(OPCUA_ENDPOINT);
    session = await client.createSession();

    subscription = ClientSubscription.create(session, {
      requestedPublishingInterval: 500,
      requestedLifetimeCount:      120,
      requestedMaxKeepAliveCount:  20,
      maxNotificationsPerPublish:  50,
      publishingEnabled: true,
      priority: 10,
    });

    for (const [, nodeId] of Object.entries(MONITOR_NODES)) {
      const item = ClientMonitoredItem.create(
        subscription,
        { nodeId, attributeId: AttributeIds.Value },
        { samplingInterval: 500, discardOldest: true, queueSize: 10 },
        TimestampsToReturn.Both,
      );
      item.on('changed', (dv) => {
        const src = dv.sourceTimestamp;
        if (src instanceof Date) {
          const delay = Date.now() - src.getTime();
          if (delay >= 0 && delay <= 5000) samples.push(delay);
        }
      });
    }

    console.log('      ✓ Subscription started');

    // --- Write trigger client (to force tag changes) ---
    try {
      writeClient  = OPCUAClient.create({
        applicationName: 'SCADA-LatencyBench-Trigger',
        connectionStrategy: { initialDelay: 1000, maxRetry: 1, maxDelay: 2000 },
        securityMode: MessageSecurityMode.None,
        securityPolicy: SecurityPolicy.None,
        endpointMustExist: false,
      });
      await writeClient.connect(OPCUA_ENDPOINT);
      writeSession = await writeClient.createSession();

      let toggle = false;
      const interval = setInterval(async () => {
        toggle = !toggle;
        try {
          await writeSession.write({
            nodeId: WRITE_NODE,
            attributeId: AttributeIds.Value,
            value: { value: { dataType: DataType.Boolean, value: toggle } },
          });
        } catch { /* ignore */ }
      }, 2000);

      console.log(`      ⏱  Monitoring for ${READ_DUR_SEC}s (triggering writes every 2s)…`);
      await sleep(READ_DUR_SEC * 1000);
      clearInterval(interval);

      // Reset tag to false
      try {
        await writeSession.write({
          nodeId: WRITE_NODE,
          attributeId: AttributeIds.Value,
          value: { value: { dataType: DataType.Boolean, value: false } },
        });
      } catch { /* ignore */ }

    } catch (trigErr) {
      console.log(`      ⚠ Trigger write unavailable (${trigErr.message}) — passive monitor only`);
      await sleep(READ_DUR_SEC * 1000);
    }

    results.read.samples = samples;
    if (samples.length > 0) {
      results.read.stats = calcStats(samples);
      const s = results.read.stats;
      console.log(`      ✓  ${samples.length} samples — mean=${s.mean}ms  p95=${s.p95}ms`);
    } else {
      results.read.error = 'Không có tag change nào được quan sát trong thời gian đo.';
      console.log('      ⚠ No subscription events captured (is the PLC running and changing tags?)');
    }

  } catch (err) {
    results.read.error = err.message;
    console.log(`      ✗ ${err.message}`);
  } finally {
    try { await subscription?.terminate(); } catch { /* ignore */ }
    try { await session?.close();          } catch { /* ignore */ }
    try { await client?.disconnect();      } catch { /* ignore */ }
    try { await writeSession?.close();     } catch { /* ignore */ }
    try { await writeClient?.disconnect(); } catch { /* ignore */ }
  }
}

// ── [3] HTTP API Latency ──────────────────────────────────────────────────────
async function measureHttp() {
  console.log(`\n[3/3] HTTP API Latency  (${BACKEND_URL}/api/sensors/cabin)`);
  console.log(`      Samples: ${N_HTTP}`);

  const url  = `${BACKEND_URL}/api/sensors/cabin`;
  const hdrs = { 'Content-Type': 'application/json', 'X-API-Key': SENSOR_API_KEY };
  const body = JSON.stringify({
    deviceId: 'LATENCY-BENCH-01', temperature: 25.0, humidity: 60.0,
    accelX: 0, accelY: 0, accelZ: 9.81, gyroX: 0, gyroY: 0, gyroZ: 0,
    stabilityScore: 100, positionCm: 184.5, positionPct: 50.0,
    railLengthCm: 369.0, speedCmPerSec: 0.0, encoderPulses: 776,
    direction: 'DUNG', outOfBounds: false, fastUpdate: false, timestamp: Date.now(),
  });

  const doPost = () => fetch(url, {
    method: 'POST', headers: hdrs, body,
    signal: AbortSignal.timeout(8000),
  });

  try {
    // Connectivity check
    const probe = await doPost();
    if (!probe.ok) throw new Error(`HTTP ${probe.status} ${probe.statusText}`);
    await probe.text();
    console.log(`      ✓ Backend reachable (${probe.status})`);

    // Warmup
    for (let i = 0; i < 5; i++) { const r = await doPost(); await r.text(); }
    console.log('      ✓ Warmup (5 requests)');

    process.stdout.write('      Sampling: ');
    for (let i = 0; i < N_HTTP; i++) {
      const t0 = performance.now();
      const r  = await doPost();
      const t1 = performance.now();
      await r.text();
      results.http.samples.push(+(t1 - t0).toFixed(3));
      if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1}…`);
      await sleep(50);
    }
    console.log(' done');

    results.http.stats = calcStats(results.http.samples);
    const s = results.http.stats;
    console.log(`      ✓  mean=${s.mean}ms  p95=${s.p95}ms  max=${s.max}ms`);

  } catch (err) {
    results.http.error = err.message;
    console.log(`      ✗ ${err.message}`);
    console.log('        (Hãy đảm bảo backend đang chạy: npm run dev)');
  }
}

// ── HTML Report Generator ─────────────────────────────────────────────────────
function generateReport() {
  const ts   = new Date(results.generatedAt).toLocaleString('vi-VN');
  const R    = results;
  const fmtN = (v) => v !== null && v !== undefined ? v.toFixed(2) : '—';
  const fmtS = (stats, field) => stats ? fmtN(stats[field]) : '—';
  const err  = (e) => e ? `<span class="err">${e}</span>` : '';

  // Colour constants (matched to the chart palette)
  const CLR_WRITE = '#60a5fa';  // blue
  const CLR_READ  = '#34d399';  // green
  const CLR_HTTP  = '#f472b6';  // pink

  // Prepare inline JSON for Chart.js
  const writeData  = JSON.stringify(R.write.samples);
  const readData   = JSON.stringify(R.read.samples);
  const httpData   = JSON.stringify(R.http.samples);

  const writeHist  = buildHistogram(R.write.samples, 18);
  const readHist   = buildHistogram(R.read.samples,  15);
  const httpHist   = buildHistogram(R.http.samples,  18);

  // Comparison bar chart data
  const categories = ['Min', 'Mean', 'Median', 'P95', 'Max'];
  const writeBar   = R.write.stats
    ? [R.write.stats.min, R.write.stats.mean, R.write.stats.median, R.write.stats.p95, R.write.stats.max]
    : [0, 0, 0, 0, 0];
  const readBar    = R.read.stats
    ? [R.read.stats.min,  R.read.stats.mean,  R.read.stats.median,  R.read.stats.p95,  R.read.stats.max]
    : [0, 0, 0, 0, 0];
  const httpBar    = R.http.stats
    ? [R.http.stats.min,  R.http.stats.mean,  R.http.stats.median,  R.http.stats.p95,  R.http.stats.max]
    : [0, 0, 0, 0, 0];

  const statsRow = (label, clr, stats, error) => `
    <tr>
      <td><span class="badge" style="background:${clr}22;color:${clr};border:1px solid ${clr}44">${label}</span></td>
      <td>${stats ? stats.count  : '—'}</td>
      <td>${fmtS(stats,'min')}   </td>
      <td>${fmtS(stats,'max')}   </td>
      <td class="hi">${fmtS(stats,'mean')}  </td>
      <td>${fmtS(stats,'median')}</td>
      <td class="hi">${fmtS(stats,'p95')}   </td>
      <td>${fmtS(stats,'p99')}   </td>
      <td>${fmtS(stats,'stddev')}</td>
      <td>${error ? `<span class="err-small">${error.slice(0,50)}</span>` : '✓ OK'}</td>
    </tr>`;

  return /* html */`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Báo cáo Độ trễ Truyền thông — Medical SCADA</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg:       #f8fafc;
    --card:     #ffffff;
    --border:   #e2e8f0;
    --text:     #1e293b;
    --muted:    #64748b;
    --accent:   #3b82f6;
    --write:    #3b82f6;
    --read:     #10b981;
    --http:     #ec4899;
    --shadow:   0 1px 4px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06);
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg);
         color: var(--text); line-height: 1.6; font-size: 14px; }

  /* ── Header ── */
  .header { background: linear-gradient(135deg,#1e3a5f 0%,#1e40af 60%,#2563eb 100%);
             color:#fff; padding: 36px 48px 28px; }
  .header h1 { font-size: 1.75rem; font-weight: 700; letter-spacing: -.02em; }
  .header .sub { margin-top: 6px; opacity: .8; font-size: .95rem; }
  .header .meta { display: flex; gap: 32px; margin-top: 20px; flex-wrap: wrap; }
  .header .meta-item { font-size: .82rem; opacity: .75; }
  .header .meta-item strong { display: block; opacity: 1; font-size: .9rem; color:#93c5fd; }
  .mock-badge { display:inline-flex;align-items:center;gap:6px;
                background:#f59e0b22;border:1px solid #f59e0b66;color:#f59e0b;
                padding:3px 10px;border-radius:99px;font-size:.78rem;font-weight:600;margin-top:12px; }

  /* ── Layout ── */
  .container { max-width: 1200px; margin: 0 auto; padding: 32px 24px 64px; }
  .section-title { font-size: 1.05rem; font-weight: 700; color: var(--text);
                   margin: 36px 0 16px; padding-bottom: 8px;
                   border-bottom: 2px solid var(--border); }
  .section-title span { font-size: .8rem; font-weight: 400; color: var(--muted); margin-left: 8px; }

  /* ── Cards ── */
  .card { background: var(--card); border: 1px solid var(--border);
          border-radius: 12px; padding: 24px; box-shadow: var(--shadow); }
  .card + .card { margin-top: 20px; }
  .card-title { font-size: .78rem; font-weight: 600; text-transform: uppercase;
                letter-spacing: .08em; color: var(--muted); margin-bottom: 12px; }

  /* ── Grid ── */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
  @media (max-width: 900px) { .grid-2,.grid-3 { grid-template-columns: 1fr; } }

  /* ── Stat cards ── */
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
  @media (max-width: 700px) { .kpi-grid { grid-template-columns: 1fr; } }
  .kpi { background: var(--card); border: 1px solid var(--border);
         border-radius: 10px; padding: 18px 20px; box-shadow: var(--shadow); }
  .kpi .label { font-size: .75rem; font-weight: 600; text-transform: uppercase;
                letter-spacing: .07em; color: var(--muted); }
  .kpi .value { font-size: 2rem; font-weight: 700; margin: 4px 0 2px; }
  .kpi .sub { font-size: .78rem; color: var(--muted); }
  .kpi.write .value { color: var(--write); }
  .kpi.read  .value { color: var(--read);  }
  .kpi.http  .value { color: var(--http);  }

  /* ── Charts ── */
  .chart-wrap { position: relative; height: 260px; }
  .chart-wrap.tall { height: 310px; }

  /* ── Table ── */
  .tbl-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .82rem; }
  th { background: #f1f5f9; font-weight: 600; text-align: right;
       padding: 9px 12px; color: var(--muted); white-space: nowrap; }
  th:first-child { text-align: left; }
  td { padding: 9px 12px; border-top: 1px solid var(--border); text-align: right; }
  td:first-child { text-align: left; }
  tr:hover td { background: #f8fafc; }
  td.hi { font-weight: 600; color: var(--text); }
  .badge { padding: 2px 10px; border-radius: 99px; font-size: .78rem; font-weight: 600; white-space: nowrap; }
  .err   { color: #ef4444; font-size: .8rem; }
  .err-small { color: #ef4444; font-size: .75rem; }

  /* ── Architecture diagram ── */
  .arch { background: #f1f5f9; border-radius: 10px; padding: 24px;
          font-family: 'Consolas','Courier New',monospace; font-size: .78rem;
          line-height: 1.8; color: #334155; overflow-x: auto; }
  .arch .label { display: inline-block; background:#dbeafe;color:#1d4ed8;
                 border-radius:4px;padding:1px 6px;font-weight:600; }
  .arch .arrow { color: #94a3b8; }

  /* ── Footer ── */
  .footer { text-align: center; margin-top: 60px; font-size: .78rem; color: var(--muted); }
  @media print {
    body { background: #fff; font-size: 12px; }
    .header { background: #1e3a5f !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .card { break-inside: avoid; box-shadow: none; border: 1px solid #ddd; }
    .kpi  { break-inside: avoid; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>📡 Báo Cáo Độ Trễ Truyền Thông — Medical SCADA</h1>
  <p class="sub">Đo và phân tích độ trễ các kênh giao tiếp trong hệ thống điều khiển giám sát cabin y tế</p>
  ${R.mockMode ? '<div class="mock-badge">⚠ CHẾ ĐỘ DEMO — Dữ liệu mô phỏng (--mock)</div>' : ''}
  <div class="meta">
    <div class="meta-item"><strong>Thời gian đo</strong>${ts}</div>
    <div class="meta-item"><strong>OPC UA Endpoint</strong>${R.config.opcuaEndpoint}</div>
    <div class="meta-item"><strong>Backend</strong>${R.config.backendUrl}</div>
    <div class="meta-item"><strong>Sampling Interval</strong>${R.config.samplingIntervalMs} ms</div>
    <div class="meta-item"><strong>Mẫu Write / HTTP</strong>${R.config.nWriteSamples} / ${R.config.nHttpSamples}</div>
    <div class="meta-item"><strong>Thời gian đo Read</strong>${R.config.readDurationSec}s</div>
  </div>
</div>

<div class="container">

  <!-- ── KPI Summary ── -->
  <div class="section-title">Tóm tắt kết quả <span>(giá trị trung bình)</span></div>
  <div class="kpi-grid">
    <div class="kpi write">
      <div class="label">OPC UA Write (Web→PLC)</div>
      <div class="value">${fmtS(R.write.stats,'mean')}<small style="font-size:1rem"> ms</small></div>
      <div class="sub">P95: ${fmtS(R.write.stats,'p95')} ms &nbsp;|&nbsp; ${R.write.stats?.count ?? 0} mẫu</div>
      ${err(R.write.error)}
    </div>
    <div class="kpi read">
      <div class="label">OPC UA Read (PLC→Web)</div>
      <div class="value">${fmtS(R.read.stats,'mean')}<small style="font-size:1rem"> ms</small></div>
      <div class="sub">P95: ${fmtS(R.read.stats,'p95')} ms &nbsp;|&nbsp; ${R.read.stats?.count ?? 0} mẫu</div>
      ${err(R.read.error)}
    </div>
    <div class="kpi http">
      <div class="label">HTTP API (ESP32→Backend)</div>
      <div class="value">${fmtS(R.http.stats,'mean')}<small style="font-size:1rem"> ms</small></div>
      <div class="sub">P95: ${fmtS(R.http.stats,'p95')} ms &nbsp;|&nbsp; ${R.http.stats?.count ?? 0} mẫu</div>
      ${err(R.http.error)}
    </div>
  </div>

  <!-- ── Time series charts ── -->
  <div class="section-title">Đồ thị chuỗi thời gian <span>(từng mẫu đo)</span></div>
  <div class="grid-2">
    <div class="card">
      <div class="card-title">OPC UA Write Latency — Backend → Kepware → PLC</div>
      <div class="chart-wrap"><canvas id="c-write"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">HTTP API Latency — ESP32 → Backend (/api/sensors/cabin)</div>
      <div class="chart-wrap"><canvas id="c-http"></canvas></div>
    </div>
  </div>
  <div class="card" style="margin-top:20px">
    <div class="card-title">OPC UA Subscription Delay — PLC → Kepware → Node.js (sourceTimestamp → arrival)</div>
    <div class="chart-wrap tall"><canvas id="c-read"></canvas></div>
  </div>

  <!-- ── Comparison chart ── -->
  <div class="section-title">So sánh độ trễ theo kênh <span>(ms)</span></div>
  <div class="grid-2">
    <div class="card">
      <div class="card-title">Min / Mean / Median / P95 / Max theo từng kênh</div>
      <div class="chart-wrap tall"><canvas id="c-compare"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">Phân phối độ trễ (Histogram)</div>
      <div class="chart-wrap tall"><canvas id="c-hist"></canvas></div>
    </div>
  </div>

  <!-- ── Statistics table ── -->
  <div class="section-title">Bảng thống kê chi tiết <span>(đơn vị: ms)</span></div>
  <div class="card">
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th style="text-align:left">Kênh truyền thông</th>
            <th>Mẫu</th><th>Min</th><th>Max</th>
            <th>Mean</th><th>Median</th><th>P95</th><th>P99</th><th>Std Dev</th><th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${statsRow('OPC UA Write (Web→PLC)',     CLR_WRITE, R.write.stats, R.write.error)}
          ${statsRow('OPC UA Read (PLC→Web)',      CLR_READ,  R.read.stats,  R.read.error)}
          ${statsRow('HTTP API (ESP32→Backend)',   CLR_HTTP,  R.http.stats,  R.http.error)}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── Architecture ── -->
  <div class="section-title">Sơ đồ luồng truyền thông đã đo</div>
  <div class="card">
    <div class="arch">
<strong>Hướng ĐIỀU KHIỂN (Web → PLC)</strong>
  <span class="label">Frontend React</span> <span class="arrow">──Socket.IO emit──▶</span> <span class="label">Backend Node.js</span> <span class="arrow">──OPC UA Write──▶</span> <span class="label">Kepware 6.x</span> <span class="arrow">──Register Write──▶</span> <span class="label">PLC S7-1200</span>
                           &lt;~1ms LAN&gt;                                           <span style="color:#3b82f6">← Đo ở đây (Write RTT)</span>

<strong>Hướng GIÁM SÁT (PLC → Web)</strong>
  <span class="label">PLC S7-1200</span> <span class="arrow">──Tag change──▶</span> <span class="label">Kepware 6.x</span> <span class="arrow">──OPC UA Notif──▶</span> <span class="label">Backend Node.js</span> <span class="arrow">──Socket.IO push──▶</span> <span class="label">Frontend React</span>
                                              Scan: 500ms         <span style="color:#10b981">← Đo ở đây (sourceTs→arrival)</span>                &lt;~1ms LAN&gt;

<strong>Hướng CẢM BIẾN (ESP32 → Web)</strong>
  <span class="label">ESP32 Cabin</span> <span class="arrow">──HTTP POST──▶</span> <span class="label">Backend /api/sensors/cabin</span> <span class="arrow">──Socket.IO push──▶</span> <span class="label">Frontend React</span>
                          <span style="color:#ec4899">← Đo ở đây (HTTP RTT)</span>                                          &lt;~1ms LAN&gt;
    </div>
  </div>

  <!-- ── Methodology ── -->
  <div class="section-title">Phương pháp đo lường</div>
  <div class="card">
    <p style="color:var(--muted);line-height:1.8;font-size:.85rem">
      <strong>OPC UA Write RTT:</strong> Sử dụng <code>performance.now()</code> trước và sau khi gọi <code>session.write()</code>.
      Thẻ đo: <code>PLC1.Cabin.Maintenance_Mode</code> (Boolean, ghi liên tục <code>false</code> để không ảnh hưởng hoạt động).
      Thực hiện 5 lần warmup trước khi lấy mẫu. Khoảng cách giữa các mẫu: 100ms.<br><br>

      <strong>OPC UA Subscription Delay:</strong> Đo thời gian từ <code>sourceTimestamp</code> (thời điểm Kepware ghi nhận thay đổi tag)
      đến thời điểm Node.js nhận được notification (<code>Date.now()</code>). Bao gồm: Kepware scan interval (500ms),
      OPC UA publish interval (500ms), network RTT. Chủ động kích tag thay đổi bằng cách toggle <code>Maintenance_Mode</code> mỗi 2s.<br><br>

      <strong>HTTP API RTT:</strong> Đo thời gian hoàn thành của <code>fetch() POST</code> đến endpoint <code>/api/sensors/cabin</code>.
      Bao gồm: TCP handshake, HTTPS (nếu có), request processing, response serialization.
      Chạy từ cùng máy tính (localhost), không bao gồm độ trễ WiFi của ESP32 thực tế.<br><br>

      <em style="color:#94a3b8">Lưu ý: Độ trễ WiFi của ESP32 thực tế (~10–50ms tuỳ khoảng cách) không được đo trong benchmark này.
      Độ trễ Socket.IO (Frontend ↔ Backend) thường &lt; 2ms trên LAN và không được đo riêng.</em>
    </p>
  </div>

  <div class="footer">
    Báo cáo tự động sinh bởi <code>backend/latency_bench.mjs</code> —
    Medical SCADA System · ${ts}
  </div>
</div><!-- /container -->

<script>
// ── Chart defaults ────────────────────────────────────────────────────────────
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size   = 12;
Chart.defaults.color       = '#64748b';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;

const CLR_WRITE = '#3b82f6';
const CLR_READ  = '#10b981';
const CLR_HTTP  = '#ec4899';
const GRID      = '#e2e8f080';

// Shared axis config
const xTickCfg = { grid: { color: GRID }, border: { color: GRID } };
const yMsCfg   = (title) => ({
  grid: { color: GRID }, border: { color: GRID },
  title: { display: true, text: title, color: '#94a3b8', font: { size: 11 } },
  ticks: { callback: (v) => v + ' ms' },
});

// ── Data ──────────────────────────────────────────────────────────────────────
const writeData = ${writeData};
const readData  = ${readData};
const httpData  = ${httpData};

// Moving average helper
function movingAvg(arr, w) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - w + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// ── Chart 1: OPC UA Write Latency series ─────────────────────────────────────
if (writeData.length) {
  new Chart(document.getElementById('c-write'), {
    type: 'line',
    data: {
      labels: writeData.map((_, i) => i + 1),
      datasets: [
        {
          label: 'Write RTT (ms)',
          data: writeData,
          borderColor: CLR_WRITE + '88',
          backgroundColor: CLR_WRITE + '15',
          pointRadius: 2, pointHoverRadius: 5,
          borderWidth: 1.5, fill: true, tension: 0.3,
        },
        {
          label: 'Moving Avg (5)',
          data: movingAvg(writeData, 5),
          borderColor: CLR_WRITE,
          pointRadius: 0, borderWidth: 2.5, tension: 0.4, fill: false,
        },
      ],
    },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { x: { ...xTickCfg, title: { display: true, text: 'Số mẫu', color: '#94a3b8', font: { size: 11 } } },
                y: yMsCfg('Độ trễ (ms)') },
    },
  });
}

// ── Chart 2: HTTP Latency series ──────────────────────────────────────────────
if (httpData.length) {
  new Chart(document.getElementById('c-http'), {
    type: 'line',
    data: {
      labels: httpData.map((_, i) => i + 1),
      datasets: [
        {
          label: 'HTTP RTT (ms)',
          data: httpData,
          borderColor: CLR_HTTP + '88',
          backgroundColor: CLR_HTTP + '15',
          pointRadius: 2, pointHoverRadius: 5,
          borderWidth: 1.5, fill: true, tension: 0.3,
        },
        {
          label: 'Moving Avg (5)',
          data: movingAvg(httpData, 5),
          borderColor: CLR_HTTP,
          pointRadius: 0, borderWidth: 2.5, tension: 0.4, fill: false,
        },
      ],
    },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { x: { ...xTickCfg, title: { display: true, text: 'Số mẫu', color: '#94a3b8', font: { size: 11 } } },
                y: yMsCfg('Độ trễ (ms)') },
    },
  });
}

// ── Chart 3: OPC UA Read Delay series ────────────────────────────────────────
if (readData.length) {
  new Chart(document.getElementById('c-read'), {
    type: 'line',
    data: {
      labels: readData.map((_, i) => i + 1),
      datasets: [
        {
          label: 'Subscription Delay (ms)',
          data: readData,
          borderColor: CLR_READ + '88',
          backgroundColor: CLR_READ + '15',
          pointRadius: 3, pointHoverRadius: 6,
          borderWidth: 1.5, fill: true, tension: 0.3,
        },
        {
          label: 'Moving Avg (3)',
          data: movingAvg(readData, 3),
          borderColor: CLR_READ,
          pointRadius: 0, borderWidth: 2.5, tension: 0.4, fill: false,
        },
      ],
    },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { x: { ...xTickCfg, title: { display: true, text: 'Số sự kiện', color: '#94a3b8', font: { size: 11 } } },
                y: yMsCfg('Độ trễ (ms)') },
    },
  });
}

// ── Chart 4: Comparison bar ───────────────────────────────────────────────────
new Chart(document.getElementById('c-compare'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(categories)},
    datasets: [
      { label: 'OPC UA Write', data: ${JSON.stringify(writeBar)}, backgroundColor: CLR_WRITE + 'cc', borderRadius: 4 },
      { label: 'OPC UA Read',  data: ${JSON.stringify(readBar)},  backgroundColor: CLR_READ  + 'cc', borderRadius: 4 },
      { label: 'HTTP API',     data: ${JSON.stringify(httpBar)},  backgroundColor: CLR_HTTP  + 'cc', borderRadius: 4 },
    ],
  },
  options: {
    animation: false, responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      x: { ...xTickCfg, title: { display: true, text: 'Phân vị', color: '#94a3b8', font: { size: 11 } } },
      y: yMsCfg('Độ trễ (ms)'),
    },
  },
});

// ── Chart 5: Histogram ────────────────────────────────────────────────────────
const writeHist = ${JSON.stringify(writeHist)};
const readHist  = ${JSON.stringify(readHist)};
const httpHist  = ${JSON.stringify(httpHist)};

new Chart(document.getElementById('c-hist'), {
  type: 'bar',
  data: {
    labels: writeHist.labels.length ? writeHist.labels : readHist.labels.length ? readHist.labels : httpHist.labels,
    datasets: [
      { label: 'OPC UA Write', data: writeHist.counts, backgroundColor: CLR_WRITE + 'aa', borderRadius: 2 },
      { label: 'HTTP API',     data: httpHist.counts,  backgroundColor: CLR_HTTP  + 'aa', borderRadius: 2 },
    ],
  },
  options: {
    animation: false, responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      x: { ...xTickCfg, title: { display: true, text: 'Độ trễ (ms)', color: '#94a3b8', font: { size: 11 } } },
      y: { ...xTickCfg, title: { display: true, text: 'Số mẫu', color: '#94a3b8', font: { size: 11 } } },
    },
  },
});
</script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Medical SCADA — Communication Latency Benchmark');
  console.log('═══════════════════════════════════════════════════════════════');
  if (MOCK_MODE) {
    console.log('  Mode: MOCK (demo data — no real PLC connection needed)');
    injectMockData();
  } else {
    console.log(`  Mode: LIVE  |  OPC UA: ${OPCUA_ENDPOINT}  |  Backend: ${BACKEND_URL}`);
    await measureWrite();
    await measureRead();
    await measureHttp();
  }

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('  Generating HTML report…');
  const html = generateReport();
  fs.writeFileSync(OUT_PATH, html, 'utf8');
  console.log(`  ✓ Report saved: ${OUT_PATH}`);
  console.log('    → Mở file trong trình duyệt để xem biểu đồ.');
  console.log('    → Dùng Ctrl+P → Save as PDF để xuất báo cáo.');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});

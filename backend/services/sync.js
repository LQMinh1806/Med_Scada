// ══════════════════════════════════════════════════════════════════════════════
// services/sync.js
// ──────────────────────────────────────────────────────────────────────────────
// Server-Sent Events (SSE) and Socket.io sync broadcasting service.
// Debounces rapid mutations into a single sync event.
// ══════════════════════════════════════════════════════════════════════════════

const sseClients = new Set();
let syncDebounceTimer = null;
let pendingSyncReasons = new Set();
const SYNC_DEBOUNCE_MS = 200;

/** @type {import('socket.io').Server | null} */
let ioInstance = null;

/**
 * Bind the Socket.io server instance (called once during startup).
 * @param {import('socket.io').Server} io
 */
export function bindIo(io) {
  ioInstance = io;
}

/**
 * Add an SSE client response.
 * @param {import('express').Response} res
 */
export function addSseClient(res) {
  sseClients.add(res);
}

/**
 * Remove an SSE client response.
 * @param {import('express').Response} res
 */
export function removeSseClient(res) {
  sseClients.delete(res);
}

/**
 * Debounced sync broadcaster — collapses rapid mutations
 * (e.g. 4 system-log writes during a robot move) into a single sync event.
 * Notifies via both SSE (legacy path) and Socket.io.
 * @param {string} reason  Human-readable reason for the sync
 */
export function broadcastSyncRequired(reason) {
  pendingSyncReasons.add(reason);
  if (syncDebounceTimer) return;

  syncDebounceTimer = setTimeout(() => {
    syncDebounceTimer = null;
    const reasons = [...pendingSyncReasons];
    pendingSyncReasons.clear();

    const ts = Date.now();
    const payload = JSON.stringify({
      type: 'sync-required',
      reason: reasons.join(','),
      ts,
    });

    // Notify via SSE (legacy path)
    if (sseClients.size) {
      for (const client of sseClients) {
        try {
          client.write(`data: ${payload}\n\n`);
        } catch {
          sseClients.delete(client);
        }
      }
    }

    // Also notify via Socket.io for instant cross-device sync
    if (ioInstance) {
      ioInstance.emit('scada:dataSync', {
        type: 'sync-required',
        reason: reasons.join(','),
        _ts: ts,
        _sourceSocketId: '__server__',
      });
    }
  }, SYNC_DEBOUNCE_MS);
}

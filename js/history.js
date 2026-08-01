/**
 * Persistent session history in localStorage.
 *
 * Events are stored in a compact tuple form so a take can be re-exported later
 * without blowing past typical 5 MB quotas.
 */

const STORAGE_KEY = "psr-history-v1";
const MAX_SESSIONS = 200;

/**
 * @typedef {object} SavedSession
 * @property {string} id
 * @property {number} savedAt          epoch ms when the record was written
 * @property {number} startedAt        wall-clock start
 * @property {number} endedAt          wall-clock end
 * @property {number} durationMs
 * @property {number} noteCount
 * @property {number} peakNps
 * @property {number} eventCount
 * @property {number} avgNps
 * @property {string} source           "keyboard" | "midi" | "mixed"
 * @property {string} voice
 * @property {string} deviceName
 * @property {boolean} exported        true if this save was triggered by export
 * @property {number} pauseCount
 * @property {Array<{ startMs: number, endMs: number }>} [pauseSpans]
 * @property {Array<[number, number, number, number]>} events
 *   Compact MIDI: [timeMs, statusByte, data1, data2]
 */

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function compactEvents(events) {
  return events.map((event) => {
    const data = event.data;
    return [
      Math.round(event.timeMs),
      data[0] ?? 0,
      data[1] ?? 0,
      data[2] ?? 0,
    ];
  });
}

export function expandEvents(compact) {
  return compact.map(([timeMs, status, d1, d2]) => ({
    timeMs,
    data: new Uint8Array(
      status >= 0xc0 && status < 0xe0 ? [status, d1] : [status, d1, d2]
    ),
  }));
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {object} draft
 * @returns {SavedSession}
 */
export function saveSession(draft) {
  const sessions = readAll();
  const durationMs = Math.max(0, draft.durationMs ?? 0);
  const noteCount = draft.noteCount ?? 0;
  const record = {
    id: makeId(),
    savedAt: Date.now(),
    startedAt: draft.startedAt ?? Date.now(),
    endedAt: draft.endedAt ?? Date.now(),
    durationMs,
    noteCount,
    peakNps: draft.peakNps ?? 0,
    eventCount: draft.events?.length ?? 0,
    avgNps: durationMs > 0 ? noteCount / (durationMs / 1000) : 0,
    source: draft.source ?? "keyboard",
    voice: draft.voice ?? "piano",
    deviceName: draft.deviceName ?? "",
    exported: Boolean(draft.exported),
    pauseCount: draft.pauseCount ?? draft.pauseSpans?.length ?? 0,
    pauseSpans: Array.isArray(draft.pauseSpans) ? draft.pauseSpans : [],
    events: compactEvents(draft.events ?? []),
  };

  sessions.unshift(record);
  while (sessions.length > MAX_SESSIONS) sessions.pop();

  try {
    writeAll(sessions);
  } catch (error) {
    // Quota exceeded — drop oldest MIDI payloads, keep metadata.
    for (let i = sessions.length - 1; i >= 0; i--) {
      sessions[i] = { ...sessions[i], events: [] };
      try {
        writeAll(sessions);
        break;
      } catch {
        sessions.pop();
      }
    }
    if (!sessions.find((s) => s.id === record.id)) {
      throw error;
    }
  }

  return record;
}

export function listSessions() {
  return readAll();
}

export function getSession(id) {
  return readAll().find((session) => session.id === id) ?? null;
}

export function deleteSession(id) {
  writeAll(readAll().filter((session) => session.id !== id));
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Approximate localStorage footprint of the history store.
 * Browsers cap an origin at roughly 5 MB, so this reports both the raw size and
 * how much of that budget the saved MIDI payloads occupy.
 */
export function getStorageUsage() {
  const raw = localStorage.getItem(STORAGE_KEY) ?? "";
  const sessions = readAll();
  const withEvents = sessions.filter((s) => s.events?.length).length;
  const eventCount = sessions.reduce((sum, s) => sum + (s.events?.length ?? 0), 0);
  return {
    bytes: raw.length,
    quotaBytes: 5 * 1024 * 1024,
    sessionCount: sessions.length,
    sessionsWithEvents: withEvents,
    eventCount,
    maxSessions: MAX_SESSIONS,
  };
}

export function getHistoryStats() {
  const sessions = readAll();
  const totalNotes = sessions.reduce((sum, s) => sum + (s.noteCount || 0), 0);
  const totalDurationMs = sessions.reduce(
    (sum, s) => sum + (s.durationMs || 0),
    0
  );
  const peakNps = sessions.reduce(
    (max, s) => Math.max(max, s.peakNps || 0),
    0
  );
  const lastSavedAt = sessions[0]?.savedAt ?? null;
  const exportedCount = sessions.filter((s) => s.exported).length;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const notesToday = sessions
    .filter((s) => s.savedAt >= startOfToday.getTime())
    .reduce((sum, s) => sum + (s.noteCount || 0), 0);

  return {
    sessionCount: sessions.length,
    totalNotes,
    totalDurationMs,
    peakNps,
    lastSavedAt,
    exportedCount,
    notesToday,
    avgNotesPerSession:
      sessions.length > 0 ? totalNotes / sessions.length : 0,
    avgDurationMs:
      sessions.length > 0 ? totalDurationMs / sessions.length : 0,
  };
}

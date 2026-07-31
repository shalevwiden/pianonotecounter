/**
 * Standard MIDI File writer (SMF Format 1).
 *
 * Track 1 holds tempo/time-signature meta events, track 2 holds the performance.
 * Timing is quantised to ticks at a fixed tempo so the result opens cleanly in
 * Synthesia and other piano-roll tools.
 */

export const PPQN = 480;
export const DEFAULT_TEMPO_BPM = 120;

const MICROSECONDS_PER_MINUTE = 60_000_000;
const STATUS_NOTE_OFF = 0x80;
const STATUS_NOTE_ON = 0x90;
const STATUS_CONTROL_CHANGE = 0xb0;
const STATUS_PITCH_BEND = 0xe0;

const EXPORTABLE_STATUSES = new Set([
  STATUS_NOTE_OFF,
  STATUS_NOTE_ON,
  STATUS_CONTROL_CHANGE,
  STATUS_PITCH_BEND,
]);

/** Variable-length quantity, most-significant group first. */
function writeVlq(value) {
  const clamped = Math.max(0, Math.floor(value));
  const groups = [clamped & 0x7f];
  let rest = clamped >>> 7;

  while (rest > 0) {
    groups.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }

  return groups;
}

function metaEvent(type, payload) {
  return [0xff, type, ...writeVlq(payload.length), ...payload];
}

function textBytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

function msToTicks(ms, bpm) {
  return Math.max(0, Math.round((ms * PPQN * bpm) / 60000));
}

function chunk(type, data) {
  const out = new Uint8Array(8 + data.length);
  out[0] = type.charCodeAt(0);
  out[1] = type.charCodeAt(1);
  out[2] = type.charCodeAt(2);
  out[3] = type.charCodeAt(3);
  out[4] = (data.length >>> 24) & 0xff;
  out[5] = (data.length >>> 16) & 0xff;
  out[6] = (data.length >>> 8) & 0xff;
  out[7] = data.length & 0xff;
  out.set(data, 8);
  return out;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Sorts by time while preserving capture order for simultaneous events, so a
 * note-off never gets reordered ahead of the note-on it belongs to.
 */
function sortByTime(events) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.timeMs - b.event.timeMs || a.index - b.index)
    .map((entry) => entry.event);
}

/**
 * Any note still held when recording stopped would sustain forever in a piano
 * roll, so close them one beat after the final event.
 */
function withClosedNotes(events, tailMs) {
  const held = new Map();

  for (const event of events) {
    const status = event.data[0] & 0xf0;
    const note = event.data[1];
    if (status === STATUS_NOTE_ON && event.data[2] > 0) {
      held.set(note, event);
    } else if (status === STATUS_NOTE_OFF || status === STATUS_NOTE_ON) {
      held.delete(note);
    }
  }

  if (held.size === 0) return events;

  const lastTime = events.length ? events[events.length - 1].timeMs : 0;
  const closers = Array.from(held.keys()).map((note) => ({
    timeMs: lastTime + tailMs,
    data: new Uint8Array([STATUS_NOTE_OFF, note, 0]),
  }));

  return [...events, ...closers];
}

/**
 * @param {Array<{ timeMs: number, data: Uint8Array }>} recordedEvents
 * @param {{ bpm?: number, trackName?: string, trimLeadingSilence?: boolean }} [options]
 * @returns {Uint8Array}
 */
export function buildMidiFile(recordedEvents, options = {}) {
  const bpm = options.bpm ?? DEFAULT_TEMPO_BPM;
  const trackName = options.trackName ?? "Piano Session";
  const trimLeadingSilence = options.trimLeadingSilence ?? true;
  const tempoMicros = Math.round(MICROSECONDS_PER_MINUTE / bpm);

  const tempoTrack = chunk(
    "MTrk",
    Uint8Array.from([
      0,
      ...metaEvent(0x51, [
        (tempoMicros >> 16) & 0xff,
        (tempoMicros >> 8) & 0xff,
        tempoMicros & 0xff,
      ]),
      0,
      ...metaEvent(0x58, [0x04, 0x02, 0x18, 0x08]), // 4/4
      0,
      ...metaEvent(0x2f, []),
    ])
  );

  const playable = recordedEvents.filter(
    (event) =>
      event?.data?.length >= 2 && EXPORTABLE_STATUSES.has(event.data[0] & 0xf0)
  );

  const ordered = sortByTime(playable);
  const firstNote = ordered.find(
    (event) => (event.data[0] & 0xf0) === STATUS_NOTE_ON && event.data[2] > 0
  );
  const offset = trimLeadingSilence ? firstNote?.timeMs ?? 0 : 0;
  const shifted = ordered.map((event) => ({
    ...event,
    timeMs: Math.max(0, event.timeMs - offset),
  }));

  const beatMs = 60000 / bpm;
  const complete = withClosedNotes(shifted, beatMs / 2);

  const trackBytes = [
    0,
    ...metaEvent(0x03, textBytes(trackName)),
    0,
    0xc0,
    0x00, // Program change → Acoustic Grand Piano
  ];

  let lastTick = 0;
  for (const event of complete) {
    const tick = msToTicks(event.timeMs, bpm);
    const delta = Math.max(0, tick - lastTick);
    lastTick = tick;

    const message = Array.from(event.data);
    message[0] = message[0] & 0xf0; // collapse everything onto channel 0
    trackBytes.push(...writeVlq(delta), ...message);
  }

  trackBytes.push(...writeVlq(msToTicks(beatMs, bpm)), ...metaEvent(0x2f, []));

  const performanceTrack = chunk("MTrk", Uint8Array.from(trackBytes));

  // MThd payload is three 16-bit fields: format, track count, division.
  const header = chunk(
    "MThd",
    Uint8Array.from([
      0x00, 0x01, // format 1
      0x00, 0x02, // two tracks
      (PPQN >> 8) & 0xff, PPQN & 0xff,
    ])
  );

  return concatBytes([header, tempoTrack, performanceTrack]);
}

/** Counts note-ons in a built file, used for post-export confirmation. */
export function countNoteOns(events) {
  return events.filter(
    (event) =>
      (event.data[0] & 0xf0) === STATUS_NOTE_ON &&
      event.data.length >= 3 &&
      event.data[2] > 0
  ).length;
}

export function downloadMidi(bytes, filename) {
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download before it is handed off.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export { msToTicks };

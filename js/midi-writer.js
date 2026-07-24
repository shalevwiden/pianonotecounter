/**
 * Minimal Standard MIDI File (SMF) writer.
 * Produces Type 1 files with a tempo track + performance track
 * so timing is reliable in Synthesia and other DAWs.
 */

const PPQN = 480;
const DEFAULT_TEMPO_BPM = 120;
const MICROSECONDS_PER_MINUTE = 60_000_000;

function writeVariableLength(value) {
  const bytes = [];
  let buffer = value & 0x7f;
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function encodeString(str) {
  const encoder = new TextEncoder();
  return Array.from(encoder.encode(str));
}

function msToTicks(ms, bpm = DEFAULT_TEMPO_BPM) {
  return Math.max(0, Math.round((ms * PPQN * bpm) / 60000));
}

function buildTrack(events) {
  const bytes = [];
  for (const event of events) {
    bytes.push(...writeVariableLength(event.delta));
    bytes.push(...event.data);
  }
  return bytes;
}

function chunk(type, data) {
  const header = [
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
    (data.length >> 24) & 0xff,
    (data.length >> 16) & 0xff,
    (data.length >> 8) & 0xff,
    data.length & 0xff,
  ];
  return [...header, ...data];
}

/**
 * @param {Array<{ timeMs: number, data: Uint8Array }>} recordedEvents
 * @param {{ bpm?: number, trackName?: string }} [options]
 * @returns {Uint8Array}
 */
export function buildMidiFile(recordedEvents, options = {}) {
  const bpm = options.bpm ?? DEFAULT_TEMPO_BPM;
  const trackName = options.trackName ?? "Piano Session";
  const tempoMicros = Math.round(MICROSECONDS_PER_MINUTE / bpm);

  const tempoTrack = buildTrack([
    {
      delta: 0,
      data: [
        0xff,
        0x51,
        0x03,
        (tempoMicros >> 16) & 0xff,
        (tempoMicros >> 8) & 0xff,
        tempoMicros & 0xff,
      ],
    },
    {
      delta: 0,
      data: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08], // 4/4
    },
    {
      delta: 0,
      data: [0xff, 0x2f, 0x00],
    },
  ]);

  const nameBytes = encodeString(trackName);
  const noteEvents = [];

  noteEvents.push({
    delta: 0,
    data: [0xff, 0x03, nameBytes.length, ...nameBytes],
  });

  // Program Change → Acoustic Grand Piano
  noteEvents.push({
    delta: 0,
    data: [0xc0, 0x00],
  });

  let lastTick = 0;
  const sorted = [...recordedEvents].sort((a, b) => a.timeMs - b.timeMs);

  for (const event of sorted) {
    const status = event.data[0] & 0xf0;
    // Keep channel voice messages that matter for piano roll playback
    if (
      status !== 0x80 &&
      status !== 0x90 &&
      status !== 0xb0 &&
      status !== 0xe0
    ) {
      continue;
    }

    const tick = msToTicks(event.timeMs, bpm);
    const delta = Math.max(0, tick - lastTick);
    lastTick = tick;

    // Force channel 0 for a clean single-track piano file
    const data = Array.from(event.data);
    data[0] = (data[0] & 0xf0) | 0x00;
    noteEvents.push({ delta, data });
  }

  noteEvents.push({
    delta: 0,
    data: [0xff, 0x2f, 0x00],
  });

  const performanceTrack = buildTrack(noteEvents);

  // Header: format 1, 2 tracks, PPQN division
  const header = chunk("MThd", [
    0x00,
    0x00,
    0x00,
    0x01, // format 1
    0x00,
    0x02, // 2 tracks
    (PPQN >> 8) & 0xff,
    PPQN & 0xff,
  ]);

  const file = [
    ...header,
    ...chunk("MTrk", tempoTrack),
    ...chunk("MTrk", performanceTrack),
  ];

  return new Uint8Array(file);
}

export function downloadMidi(bytes, filename) {
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { PPQN, DEFAULT_TEMPO_BPM, msToTicks };

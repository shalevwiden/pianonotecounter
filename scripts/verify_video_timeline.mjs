/**
 * Headless checks for counter-video timing helpers (no WebCodecs required).
 *
 * Usage: node scripts/verify_video_timeline.mjs
 */

import {
  buildNoteTimeline,
  sessionDurationMs,
  countAtTime,
  msSinceLastNote,
  VIDEO_FPS,
  TAIL_MS,
} from "../js/video-export.js";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function noteOn(timeMs, note = 60, velocity = 100) {
  return { timeMs, data: new Uint8Array([0x90, note, velocity]) };
}

function noteOff(timeMs, note = 60) {
  return { timeMs, data: new Uint8Array([0x80, note, 0]) };
}

const events = [
  noteOn(0, 60),
  noteOff(200, 60),
  noteOn(1000, 62),
  noteOff(1200, 62),
  // Pause gap with no notes between 1500–4000
  noteOn(4000, 64),
  noteOff(4200, 64),
];

const timeline = buildNoteTimeline(events);
assert(timeline.length === 3, `expected 3 note-ons, got ${timeline.length}`);
assert(timeline[0].count === 1 && timeline[0].timeMs === 0, "first count");
assert(timeline[1].count === 2 && timeline[1].timeMs === 1000, "second count");
assert(timeline[2].count === 3 && timeline[2].timeMs === 4000, "third count");

assert(countAtTime(timeline, 0) === 1, "count at first note");
assert(countAtTime(timeline, 999) === 1, "count in gap before second");
assert(countAtTime(timeline, 1000) === 2, "count at second note");
assert(countAtTime(timeline, 2500) === 2, "count frozen across pause");
assert(countAtTime(timeline, 4000) === 3, "count at third note");

assert(msSinceLastNote(timeline, 2500) === 1500, "ms since note across pause");
assert(msSinceLastNote(timeline, 4000) === 0, "ms since note at boundary");

const duration = sessionDurationMs(events, timeline);
assert(duration === 4200, `duration should be last event time, got ${duration}`);

const totalMs = duration + TAIL_MS;
const frames = Math.max(1, Math.ceil((totalMs / 1000) * VIDEO_FPS) + 1);
assert(frames > VIDEO_FPS, "frame count should cover more than one second");

// Zero-velocity note-on must not increment the counter.
const ghost = buildNoteTimeline([
  noteOn(0, 60, 0),
  { timeMs: 10, data: new Uint8Array([0x90, 61, 80]) },
]);
assert(ghost.length === 1 && ghost[0].count === 1, "ignore zero-velocity note-ons");

console.log(`OK  timeline ${timeline.length} notes, ${frames} frames @ ${VIDEO_FPS}fps`);

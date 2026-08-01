/**
 * Headless checks for pause/resume timeline gaps and held-note closure.
 *
 * Usage: node scripts/verify_pause_recorder.mjs
 */

import { SessionRecorder } from "../js/recorder.js";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const rec = new SessionRecorder();
rec.start();
assert(rec.recording && rec.active, "should be recording");

rec.capture([0x90, 60, 100]);
assert(rec.noteCount === 1, "note counted");
assert(rec.heldNotes.has(60), "note held");

const closers = rec.pause();
assert(rec.paused, "should be paused");
assert(closers.length === 1, "held note closed on pause");
assert((closers[0].data[0] & 0xf0) === 0x80, "closer is note-off");
assert(!rec.heldNotes.has(60), "held map cleared");

const beforePauseCount = rec.noteCount;
assert(rec.capture([0x90, 62, 100]) == null, "ignore notes while paused");
assert(rec.noteCount === beforePauseCount, "count unchanged while paused");

await sleep(40);
rec.resume();
assert(rec.recording, "resumed");
assert(rec.pauseSpans.length === 1, "pause span recorded");
assert(rec.pauseSpans[0].endMs > rec.pauseSpans[0].startMs, "pause has duration");

rec.capture([0x90, 64, 90]);
assert(rec.noteCount === beforePauseCount + 1, "notes after resume count");

await sleep(20);
rec.stop();
assert(rec.state === "stopped", "stopped");
const elapsed = rec.getElapsedMs();
assert(elapsed >= 40, `elapsed should include pause gap, got ${elapsed}`);

const ons = rec.events.filter((e) => (e.data[0] & 0xf0) === 0x90 && e.data[2] > 0);
assert(ons.length === 2, `expected 2 note-ons in stream, got ${ons.length}`);

console.log(
  `OK  pause gap ${Math.round(rec.pauseSpans[0].endMs - rec.pauseSpans[0].startMs)}ms, ${rec.events.length} events`
);

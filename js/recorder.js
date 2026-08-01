/**
 * Captures MIDI messages with timestamps relative to session start.
 *
 * Pause keeps the timeline running (gaps are preserved in timeMs for video and
 * MIDI), but stops capturing until resume. Held notes are closed on pause so
 * they do not sustain across the gap.
 */

const NPS_WINDOW_MS = 1000;

/** @typedef {'idle' | 'recording' | 'paused' | 'stopped'} RecorderState */

export class SessionRecorder {
  constructor() {
    this.reset();
  }

  reset() {
    this.events = [];
    this.noteOnTimes = [];
    /** @type {Map<number, number>} MIDI note → latest sounding velocity */
    this.heldNotes = new Map();
    this.noteCount = 0;
    this.startedAt = null;
    this.endedAt = null;
    this.pausedAt = null;
    /** @type {Array<{ startMs: number, endMs: number }>} */
    this.pauseSpans = [];
    /** @type {RecorderState} */
    this.state = "idle";
    this.peakNps = 0;
  }

  /** True while actively capturing notes (not paused). */
  get recording() {
    return this.state === "recording";
  }

  get paused() {
    return this.state === "paused";
  }

  /** True for an in-progress take (recording or paused). */
  get active() {
    return this.state === "recording" || this.state === "paused";
  }

  start() {
    this.reset();
    this.startedAt = performance.now();
    this.state = "recording";
  }

  /**
   * Freeze capture but keep the clock running so the pause becomes a gap.
   * @returns {Array<{ timeMs: number, data: Uint8Array }>} note-off events written
   */
  pause() {
    if (this.state !== "recording") return [];
    const now = performance.now();
    this.pausedAt = now;
    const closers = this._closeHeldNotes(now - this.startedAt);
    this.state = "paused";
    return closers;
  }

  resume() {
    if (this.state !== "paused" || this.pausedAt == null || this.startedAt == null) {
      return;
    }
    const resumeAt = performance.now();
    this.pauseSpans.push({
      startMs: Math.max(0, this.pausedAt - this.startedAt),
      endMs: Math.max(0, resumeAt - this.startedAt),
    });
    this.pausedAt = null;
    this.state = "recording";
  }

  stop() {
    if (!this.active) return;
    const now = performance.now();
    if (this.state === "recording") {
      this._closeHeldNotes(now - this.startedAt);
    } else if (this.state === "paused" && this.pausedAt != null && this.startedAt != null) {
      this.pauseSpans.push({
        startMs: Math.max(0, this.pausedAt - this.startedAt),
        endMs: Math.max(0, now - this.startedAt),
      });
      this.pausedAt = null;
    }
    this.endedAt = now;
    this.state = "stopped";
  }

  /**
   * @param {Uint8Array|number[]} bytes raw MIDI message
   * @param {number} [timeStampMs] performance.now()-based timestamp
   */
  capture(bytes, timeStampMs) {
    if (this.state !== "recording" || !bytes || bytes.length === 0) return null;

    const status = bytes[0] & 0xf0;
    // System realtime (clock, active sensing) arrives constantly and carries no
    // performance information.
    if (bytes[0] >= 0xf0) return null;

    const at = typeof timeStampMs === "number" ? timeStampMs : performance.now();
    const timeMs = Math.max(0, at - this.startedAt);
    const data = Uint8Array.from(bytes);
    this.events.push({ timeMs, data });

    if (status === 0x90 && data.length >= 3 && data[2] > 0) {
      this.noteCount += 1;
      this.noteOnTimes.push(timeMs);
      this.heldNotes.set(data[1], data[2]);
      this._updatePeakNps(timeMs);
      return { isNoteOn: true, noteCount: this.noteCount };
    }

    if (status === 0x80 || (status === 0x90 && data.length >= 3 && data[2] === 0)) {
      this.heldNotes.delete(data[1]);
    }

    return { isNoteOn: false, noteCount: this.noteCount };
  }

  _closeHeldNotes(timeMs) {
    const closers = [];
    for (const note of this.heldNotes.keys()) {
      const data = new Uint8Array([0x80, note, 0]);
      const event = { timeMs: Math.max(0, timeMs), data };
      this.events.push(event);
      closers.push(event);
    }
    this.heldNotes.clear();
    return closers;
  }

  _updatePeakNps(nowMs) {
    const cutoff = nowMs - NPS_WINDOW_MS;
    while (this.noteOnTimes.length && this.noteOnTimes[0] < cutoff) {
      this.noteOnTimes.shift();
    }
    if (this.noteOnTimes.length > this.peakNps) {
      this.peakNps = this.noteOnTimes.length;
    }
  }

  getLiveNps() {
    if (this.startedAt == null) return 0;
    // During pause the counter is frozen — report NPS at the pause point.
    const elapsed = this.getElapsedMs();
    const cutoff = elapsed - NPS_WINDOW_MS;
    let count = 0;
    for (let i = this.noteOnTimes.length - 1; i >= 0; i--) {
      if (this.noteOnTimes[i] >= cutoff) count += 1;
      else break;
    }
    return count;
  }

  getElapsedMs() {
    if (this.startedAt == null) return 0;
    // Keep-gap: while a take is open (recording or paused) the clock keeps
    // running so pause time becomes silence / a frozen counter plateau later.
    if (this.state === "recording" || this.state === "paused") {
      return performance.now() - this.startedAt;
    }
    return Math.max(0, (this.endedAt ?? this.startedAt) - this.startedAt);
  }

  get pauseCount() {
    return this.pauseSpans.length;
  }

  get hasData() {
    return this.events.length > 0;
  }
}

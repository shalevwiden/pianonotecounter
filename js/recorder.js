/**
 * Captures MIDI messages from any input source with timestamps relative to the
 * moment recording started. Web MIDI timestamps and performance.now() share a
 * timeline, so both sources can be mixed without drift.
 */

const NPS_WINDOW_MS = 1000;

export class SessionRecorder {
  constructor() {
    this.reset();
  }

  reset() {
    this.events = [];
    this.noteOnTimes = [];
    this.noteCount = 0;
    this.startedAt = null;
    this.endedAt = null;
    this.recording = false;
    this.peakNps = 0;
  }

  start() {
    this.reset();
    this.startedAt = performance.now();
    this.recording = true;
  }

  stop() {
    if (!this.recording) return;
    this.endedAt = performance.now();
    this.recording = false;
  }

  /**
   * @param {Uint8Array|number[]} bytes raw MIDI message
   * @param {number} [timeStampMs] performance.now()-based timestamp
   */
  capture(bytes, timeStampMs) {
    if (!this.recording || !bytes || bytes.length === 0) return null;

    const status = bytes[0] & 0xf0;
    // System realtime (clock, active sensing) arrives constantly and carries no
    // performance information.
    if (bytes[0] >= 0xf0) return null;

    const at = typeof timeStampMs === "number" ? timeStampMs : performance.now();
    const timeMs = Math.max(0, at - this.startedAt);
    this.events.push({ timeMs, data: Uint8Array.from(bytes) });

    if (status === 0x90 && bytes.length >= 3 && bytes[2] > 0) {
      this.noteCount += 1;
      this.noteOnTimes.push(timeMs);
      this._updatePeakNps(timeMs);
      return { isNoteOn: true, noteCount: this.noteCount };
    }

    return { isNoteOn: false, noteCount: this.noteCount };
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
    const cutoff = this.getElapsedMs() - NPS_WINDOW_MS;
    let count = 0;
    for (let i = this.noteOnTimes.length - 1; i >= 0; i--) {
      if (this.noteOnTimes[i] >= cutoff) count += 1;
      else break;
    }
    return count;
  }

  getElapsedMs() {
    if (this.startedAt == null) return 0;
    if (this.recording) return performance.now() - this.startedAt;
    return Math.max(0, (this.endedAt ?? this.startedAt) - this.startedAt);
  }

  get hasData() {
    return this.events.length > 0;
  }
}

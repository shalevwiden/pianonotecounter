/**
 * Session recorder — stores MIDI events with high-resolution timestamps
 * relative to the recording start for accurate .mid export.
 */

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
    this.originMidiTs = null;
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
   * @param {MIDIMessageEvent} message
   */
  handleMessage(message) {
    if (!this.recording || !message.data || message.data.length === 0) {
      return null;
    }

    const data = new Uint8Array(message.data);
    const status = data[0] & 0xf0;
    const now = performance.now();
    const wallMs = now - this.startedAt;
    const midiTs =
      typeof message.timeStamp === "number" ? message.timeStamp : now;

    if (this.originMidiTs == null) {
      this.originMidiTs = midiTs;
    }

    const timeMs = Math.max(0, midiTs - this.originMidiTs);

    this.events.push({ timeMs, data, wallMs });

    // Note On with velocity > 0 (velocity 0 is Note Off)
    if (status === 0x90 && data.length >= 3 && data[2] > 0) {
      this.noteCount += 1;
      this.noteOnTimes.push(wallMs);
      this._updatePeakNps(wallMs);
      return { isNoteOn: true, noteCount: this.noteCount };
    }

    return { isNoteOn: false, noteCount: this.noteCount };
  }

  _updatePeakNps(nowMs) {
    const cutoff = nowMs - 1000;
    while (this.noteOnTimes.length && this.noteOnTimes[0] < cutoff) {
      this.noteOnTimes.shift();
    }
    if (this.noteOnTimes.length > this.peakNps) {
      this.peakNps = this.noteOnTimes.length;
    }
  }

  /** Live NPS over a rolling 1-second window. */
  getLiveNps() {
    if (this.startedAt == null) return 0;

    const now = this.recording
      ? performance.now() - this.startedAt
      : Math.max(0, (this.endedAt ?? this.startedAt) - this.startedAt);

    const cutoff = now - 1000;
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

  getByteEstimate() {
    return this.events.reduce((sum, e) => sum + e.data.length, 0);
  }
}

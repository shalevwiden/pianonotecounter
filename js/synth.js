/**
 * Lightweight additive piano voice for audible feedback.
 * Kept intentionally small: no samples to download, no external dependencies.
 */

import { noteToFrequency } from "./note-utils.js";

const PARTIALS = [
  { type: "triangle", ratio: 1, gain: 0.6, detune: 0 },
  { type: "sine", ratio: 2, gain: 0.24, detune: 4 },
  { type: "sine", ratio: 3, gain: 0.1, detune: -4 },
  { type: "sine", ratio: 4.01, gain: 0.05, detune: 0 },
];

export class PianoSynth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.7;
    this.sustain = false;
    /** @type {Map<number, object>} */
    this.voices = new Map();
    /** Notes released while the sustain pedal is down. */
    this.pendingRelease = new Set();
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 20;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    this.master.connect(compressor);
    compressor.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Audio stays locked until the page receives a real user gesture. */
  resume() {
    const ctx = this._ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  get isSuspended() {
    return !this.ctx || this.ctx.state !== "running";
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.allNotesOff();
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  setSustain(down) {
    this.sustain = down;
    if (down) return;
    for (const note of this.pendingRelease) this._release(note, 0.3);
    this.pendingRelease.clear();
  }

  noteOn(note, velocity = 100) {
    if (!this.enabled) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    this._release(note, 0.03);
    this.pendingRelease.delete(note);

    const now = ctx.currentTime;
    const frequency = noteToFrequency(note);
    const level = Math.min(1, Math.max(0.08, velocity / 127));

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(Math.min(16000, frequency * 9 + 1400), now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(500, frequency * 3),
      now + 1.4
    );

    const envelope = ctx.createGain();
    const peak = 0.3 * level;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(peak * 0.3, now + 0.9);
    envelope.gain.exponentialRampToValueAtTime(peak * 0.06, now + 4);

    const oscillators = PARTIALS.map((partial) => {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = frequency * partial.ratio;
      osc.detune.value = partial.detune;

      const partialGain = ctx.createGain();
      partialGain.gain.value = partial.gain;

      osc.connect(partialGain);
      partialGain.connect(filter);
      osc.start(now);
      return osc;
    });

    filter.connect(envelope);
    envelope.connect(this.master);

    this.voices.set(note, { oscillators, envelope });
  }

  noteOff(note) {
    if (this.sustain) {
      this.pendingRelease.add(note);
      return;
    }
    this._release(note, 0.3);
  }

  _release(note, releaseTime) {
    const voice = this.voices.get(note);
    if (!voice) return;
    this.voices.delete(note);

    const now = this.ctx.currentTime;
    const gain = voice.envelope.gain;
    const current = Math.max(0.0001, gain.value);

    gain.cancelScheduledValues(now);
    gain.setValueAtTime(current, now);
    gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

    for (const osc of voice.oscillators) {
      try {
        osc.stop(now + releaseTime + 0.05);
      } catch {
        // already stopped
      }
    }
  }

  allNotesOff() {
    for (const note of Array.from(this.voices.keys())) this._release(note, 0.08);
    this.pendingRelease.clear();
  }
}

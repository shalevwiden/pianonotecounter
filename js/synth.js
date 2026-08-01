/**
 * Multi-voice Web Audio synth.
 *
 * Every instrument is synthesised in-browser: no samples to download, no
 * licensing, and the page stays fully offline. Realism varies — harpsichord,
 * electric piano and 80s synth are strong; Steinway and guitar are stylised
 * approximations rather than studio-grade samples.
 */

import { noteToFrequency } from "./note-utils.js";

export const VOICES = [
  {
    id: "piano",
    label: "Grand Piano",
    description: "Bright additive acoustic",
  },
  {
    id: "steinway",
    label: "Steinway",
    description: "Warm concert grand",
  },
  {
    id: "cinematic",
    label: "Cinematic Piano",
    description: "Grand with hall reverb",
  },
  {
    id: "harpsichord",
    label: "Harpsichord",
    description: "Plucky baroque pluck",
  },
  {
    id: "epiano",
    label: "Electric Piano",
    description: "Rhodes-style bells",
  },
  {
    id: "eguitar",
    label: "Electric Guitar",
    description: "Driven amp tone",
  },
  {
    id: "eighties",
    label: "80s Synth",
    description: "Supersaw pad / lead",
  },
];

const VOICE_IDS = new Set(VOICES.map((voice) => voice.id));

function makeDistortionCurve(amount = 40) {
  const samples = 256;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/**
 * Lightweight hall: parallel filtered taps, no feedback loops.
 * Feedback delay cycles can hang OfflineAudioContext in some Chromium builds.
 */
function createReverb(ctx) {
  const input = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 1;

  const taps = [0.027, 0.039, 0.053, 0.071, 0.097, 0.131, 0.173, 0.229];
  taps.forEach((time, index) => {
    const delay = ctx.createDelay(0.3);
    delay.delayTime.value = time;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 5200 - index * 280;

    const tapGain = ctx.createGain();
    tapGain.gain.value = 0.28 - index * 0.025;

    input.connect(delay);
    delay.connect(filter);
    filter.connect(tapGain);
    tapGain.connect(wet);
  });

  return { input, wet };
}

function startOsc(ctx, type, frequency, detune = 0) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  osc.detune.value = detune;
  osc.start(ctx.currentTime);
  return osc;
}

function connectPartials(ctx, frequency, partials, destination) {
  const oscillators = [];
  for (const partial of partials) {
    const osc = startOsc(
      ctx,
      partial.type,
      frequency * partial.ratio,
      partial.detune ?? 0
    );
    const gain = ctx.createGain();
    gain.gain.value = partial.gain;
    osc.connect(gain);
    gain.connect(destination);
    oscillators.push(osc);
  }
  return oscillators;
}

function scheduleAmp(envelope, now, peak, attack, decay, sustainLevel, sustainTime) {
  envelope.gain.cancelScheduledValues(now);
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
  envelope.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, peak * sustainLevel),
    now + attack + decay
  );
  if (sustainTime > 0) {
    envelope.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, peak * sustainLevel * 0.35),
      now + attack + decay + sustainTime
    );
  }
}

export class PianoSynth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.dry = null;
    this.reverbSend = null;
    this.reverb = null;
    this.enabled = true;
    this.volume = 0.7;
    this.voiceId = "piano";
    this.sustain = false;
    /** @type {Map<number, object>} */
    this.voices = new Map();
    this.pendingRelease = new Set();
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;

    this.dry = this.ctx.createGain();
    this.dry.gain.value = 1;

    this.reverb = createReverb(this.ctx);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0;

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;

    this.dry.connect(this.master);
    this.reverbSend.connect(this.reverb.input);
    this.reverb.wet.connect(this.master);
    this.master.connect(compressor);
    compressor.connect(this.ctx.destination);

    this._applyVoiceMix();
    return this.ctx;
  }

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
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  setVoice(voiceId) {
    if (!VOICE_IDS.has(voiceId)) return;
    if (voiceId === this.voiceId) return;
    this.allNotesOff();
    this.voiceId = voiceId;
    this._applyVoiceMix();
  }

  _applyVoiceMix() {
    if (!this.ctx) return;
    const cinematic = this.voiceId === "cinematic";
    const eighties = this.voiceId === "eighties";
    const now = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(cinematic ? 0.72 : 1, now, 0.03);
    this.reverbSend.gain.setTargetAtTime(
      cinematic ? 0.72 : eighties ? 0.22 : 0.08,
      now,
      0.03
    );
  }

  setSustain(down) {
    this.sustain = down;
    if (down) return;
    const release = this._defaultRelease();
    for (const note of this.pendingRelease) this._release(note, release);
    this.pendingRelease.clear();
  }

  _defaultRelease() {
    switch (this.voiceId) {
      case "harpsichord":
        return 0.08;
      case "eguitar":
        return 0.18;
      case "epiano":
        return 0.45;
      case "eighties":
        return 0.55;
      case "cinematic":
      case "steinway":
        return 0.7;
      default:
        return 0.35;
    }
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

    const envelope = ctx.createGain();
    envelope.connect(this.dry);
    envelope.connect(this.reverbSend);

    const built = this._buildVoice(ctx, frequency, level, now, envelope);
    this.voices.set(note, {
      oscillators: built.oscillators,
      envelope,
      extras: built.extras ?? [],
    });
  }

  _buildVoice(ctx, frequency, level, now, envelope) {
    switch (this.voiceId) {
      case "steinway":
        return this._buildSteinway(ctx, frequency, level, now, envelope);
      case "cinematic":
        return this._buildCinematic(ctx, frequency, level, now, envelope);
      case "harpsichord":
        return this._buildHarpsichord(ctx, frequency, level, now, envelope);
      case "epiano":
        return this._buildEPiano(ctx, frequency, level, now, envelope);
      case "eguitar":
        return this._buildEGuitar(ctx, frequency, level, now, envelope);
      case "eighties":
        return this._buildEighties(ctx, frequency, level, now, envelope);
      default:
        return this._buildPiano(ctx, frequency, level, now, envelope);
    }
  }

  _buildPiano(ctx, frequency, level, now, envelope) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(Math.min(15000, frequency * 9 + 1400), now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(500, frequency * 3),
      now + 1.4
    );

    const peak = 0.28 * level;
    scheduleAmp(envelope, now, peak, 0.006, 0.85, 0.28, 3.2);

    const oscillators = connectPartials(
      ctx,
      frequency,
      [
        { type: "triangle", ratio: 1, gain: 0.62 },
        { type: "sine", ratio: 2, gain: 0.24, detune: 4 },
        { type: "sine", ratio: 3, gain: 0.1, detune: -4 },
        { type: "sine", ratio: 4.01, gain: 0.05 },
      ],
      filter
    );
    filter.connect(envelope);
    return { oscillators, extras: [filter] };
  }

  _buildSteinway(ctx, frequency, level, now, envelope) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.55;
    filter.frequency.setValueAtTime(Math.min(12000, frequency * 7 + 900), now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(420, frequency * 2.4),
      now + 2.4
    );

    const peak = 0.3 * level;
    scheduleAmp(envelope, now, peak, 0.01, 1.1, 0.34, 5);

    const oscillators = connectPartials(
      ctx,
      frequency,
      [
        { type: "sine", ratio: 1, gain: 0.55 },
        { type: "triangle", ratio: 1, gain: 0.18, detune: -3 },
        { type: "sine", ratio: 2, gain: 0.22, detune: 2 },
        { type: "sine", ratio: 3, gain: 0.12, detune: -2 },
        { type: "sine", ratio: 4.02, gain: 0.07 },
        { type: "sine", ratio: 5.01, gain: 0.035 },
        { type: "sine", ratio: 6.03, gain: 0.02 },
      ],
      filter
    );
    filter.connect(envelope);
    return { oscillators, extras: [filter] };
  }

  _buildCinematic(ctx, frequency, level, now, envelope) {
    // Same body as Steinway; the hall comes from the wet reverb bus.
    return this._buildSteinway(ctx, frequency, level * 0.95, now, envelope);
  }

  _buildHarpsichord(ctx, frequency, level, now, envelope) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(Math.min(14000, frequency * 14 + 2200), now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(900, frequency * 4),
      now + 0.18
    );

    const peak = 0.26 * level;
    scheduleAmp(envelope, now, peak, 0.002, 0.12, 0.08, 0.35);

    const oscillators = connectPartials(
      ctx,
      frequency,
      [
        { type: "square", ratio: 1, gain: 0.35 },
        { type: "sawtooth", ratio: 1, gain: 0.22, detune: 6 },
        { type: "square", ratio: 2, gain: 0.18 },
        { type: "sawtooth", ratio: 3, gain: 0.1 },
        { type: "square", ratio: 4, gain: 0.06 },
      ],
      filter
    );
    filter.connect(envelope);
    return { oscillators, extras: [filter] };
  }

  _buildEPiano(ctx, frequency, level, now, envelope) {
    // Simple FM: modulator drives carrier frequency for the Rhodes tine.
    const carrier = startOsc(ctx, "sine", frequency);
    const modulator = startOsc(ctx, "sine", frequency * 14);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(frequency * (2.2 + level * 1.6), now);
    modGain.gain.exponentialRampToValueAtTime(frequency * 0.4, now + 0.35);
    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    const bell = startOsc(ctx, "sine", frequency * 4.07, 8);
    const bellGain = ctx.createGain();
    bellGain.gain.value = 0.12 * level;

    const tone = ctx.createGain();
    tone.gain.value = 0.55;
    carrier.connect(tone);
    bell.connect(bellGain);
    bellGain.connect(tone);

    const tremolo = ctx.createGain();
    tremolo.gain.value = 0.85;
    const lfo = startOsc(ctx, "sine", 5.2);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain);
    lfoGain.connect(tremolo.gain);

    tone.connect(tremolo);

    const peak = 0.32 * level;
    scheduleAmp(envelope, now, peak, 0.004, 0.55, 0.22, 2.8);
    tremolo.connect(envelope);

    return {
      oscillators: [carrier, modulator, bell, lfo],
      extras: [modGain, bellGain, tone, tremolo, lfoGain],
    };
  }

  _buildEGuitar(ctx, frequency, level, now, envelope) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(Math.min(9000, frequency * 8 + 1800), now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(700, frequency * 3.5),
      now + 0.25
    );

    const drive = ctx.createWaveShaper();
    drive.curve = makeDistortionCurve(55);
    drive.oversample = "2x";

    const oscillators = connectPartials(
      ctx,
      frequency,
      [
        { type: "sawtooth", ratio: 1, gain: 0.42 },
        { type: "sawtooth", ratio: 1, gain: 0.28, detune: 8 },
        { type: "square", ratio: 2, gain: 0.12 },
      ],
      drive
    );

    drive.connect(filter);

    const peak = 0.22 * level;
    scheduleAmp(envelope, now, peak, 0.008, 0.35, 0.45, 1.6);
    filter.connect(envelope);

    return { oscillators, extras: [drive, filter] };
  }

  _buildEighties(ctx, frequency, level, now, envelope) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 4.5;
    filter.frequency.setValueAtTime(280, now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.min(9000, 900 + frequency * 8 + level * 3500),
      now + 0.12
    );
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(500, frequency * 4),
      now + 1.8
    );

    // Supersaw: stacked detuned saws do the chorus work without modulating
    // DelayNode.delayTime (another Offline-render footgun).
    const detunes = [-17, -9, -4, 0, 4, 9, 17];
    const oscillators = [];
    for (const detune of detunes) {
      const osc = startOsc(ctx, "sawtooth", frequency, detune);
      const gain = ctx.createGain();
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(filter);
      oscillators.push(osc);
    }

    const peak = 0.24 * level;
    scheduleAmp(envelope, now, peak, 0.04, 0.45, 0.55, 2.5);
    filter.connect(envelope);

    return { oscillators, extras: [filter] };
  }

  noteOff(note) {
    if (this.sustain) {
      this.pendingRelease.add(note);
      return;
    }
    this._release(note, this._defaultRelease());
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

    const stopAt = now + releaseTime + 0.05;
    for (const osc of voice.oscillators) {
      try {
        osc.stop(stopAt);
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

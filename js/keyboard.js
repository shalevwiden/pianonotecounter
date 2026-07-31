/**
 * QWERTY piano input.
 *
 * The home row plays the white keys left to right and the row above holds the
 * black keys in their natural gaps, matching the layout used by Virtual Piano
 * and Recursive Arts. Physical `event.code` values are used so the mapping is
 * independent of the user's keyboard language.
 */

import { clampNote, MIDDLE_C } from "./note-utils.js";

/** Offsets in semitones above the current base note (C of the active octave). */
export const DEFAULT_KEY_MAP = {
  KeyA: 0, // C
  KeyW: 1, // C#
  KeyS: 2, // D
  KeyE: 3, // D#
  KeyD: 4, // E
  KeyF: 5, // F
  KeyT: 6, // F#
  KeyG: 7, // G
  KeyY: 8, // G#
  KeyH: 9, // A
  KeyU: 10, // A#
  KeyJ: 11, // B
  KeyK: 12, // C
  KeyO: 13, // C#
  KeyL: 14, // D
  KeyP: 15, // D#
  Semicolon: 16, // E
  Quote: 17, // F
};

export const OCTAVE_DOWN_CODES = new Set(["KeyZ", "ArrowLeft", "ArrowDown"]);
export const OCTAVE_UP_CODES = new Set(["KeyX", "ArrowRight", "ArrowUp"]);

const MIN_OCTAVE_SHIFT = -3;
const MAX_OCTAVE_SHIFT = 3;

const SPECIAL_LABELS = {
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Space: "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

export function codeLabel(code) {
  if (!code) return "—";
  if (SPECIAL_LABELS[code]) return SPECIAL_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

export class ComputerKeyboard {
  constructor({ onNoteOn, onNoteOff, onOctaveChange } = {}) {
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.onOctaveChange = onOctaveChange;

    this.enabled = false;
    this.octaveShift = 0;
    this.velocity = 100;
    this.keyMap = { ...DEFAULT_KEY_MAP };
    /** @type {Map<string, number>} held key code → sounding note */
    this.held = new Map();
    /** Set while the settings panel is waiting to capture a key. */
    this.captureHandler = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this.releaseAll.bind(this);

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
  }

  get baseNote() {
    return MIDDLE_C + this.octaveShift * 12;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  setMapping(keyMap) {
    this.releaseAll();
    this.keyMap = { ...keyMap };
  }

  resetMapping() {
    this.setMapping(DEFAULT_KEY_MAP);
  }

  /** Rebinds a semitone to the next key the user presses. */
  captureNextKey(semitone, callback) {
    this.captureHandler = { semitone, callback };
  }

  cancelCapture() {
    this.captureHandler = null;
  }

  setOctaveShift(shift) {
    const next = Math.min(MAX_OCTAVE_SHIFT, Math.max(MIN_OCTAVE_SHIFT, shift));
    if (next === this.octaveShift) return;
    this.releaseAll();
    this.octaveShift = next;
    this.onOctaveChange?.(this.octaveShift);
  }

  shiftOctave(delta) {
    this.setOctaveShift(this.octaveShift + delta);
  }

  noteForCode(code) {
    const semitone = this.keyMap[code];
    if (semitone == null) return null;
    return clampNote(this.baseNote + semitone);
  }

  /** Note → key code, for labelling the on-screen piano. */
  getNoteLabels() {
    const labels = new Map();
    for (const [code, semitone] of Object.entries(this.keyMap)) {
      labels.set(clampNote(this.baseNote + semitone), codeLabel(code));
    }
    return labels;
  }

  releaseAll() {
    for (const [code, note] of this.held) {
      this.onNoteOff?.(note, code);
    }
    this.held.clear();
  }

  _isTypingTarget(target) {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    );
  }

  _onKeyDown(event) {
    if (this.captureHandler) {
      event.preventDefault();
      const { semitone, callback } = this.captureHandler;
      this.captureHandler = null;
      if (event.code !== "Escape") callback(event.code, semitone);
      else callback(null, semitone);
      return;
    }

    if (!this.enabled || event.metaKey || event.ctrlKey || event.altKey) return;
    if (this._isTypingTarget(event.target)) return;

    if (OCTAVE_DOWN_CODES.has(event.code)) {
      event.preventDefault();
      this.shiftOctave(-1);
      return;
    }

    if (OCTAVE_UP_CODES.has(event.code)) {
      event.preventDefault();
      this.shiftOctave(1);
      return;
    }

    const note = this.noteForCode(event.code);
    if (note == null) return;

    event.preventDefault();
    // Holding a key fires repeats; a piano key only strikes once.
    if (event.repeat || this.held.has(event.code)) return;

    this.held.set(event.code, note);
    this.onNoteOn?.(note, this.velocity, event.code);
  }

  _onKeyUp(event) {
    const note = this.held.get(event.code);
    if (note == null) return;
    this.held.delete(event.code);
    this.onNoteOff?.(note, event.code);
  }

  destroy() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
  }
}

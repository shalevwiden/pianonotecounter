export const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];

const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);

export const MIDI_LOWEST = 21; // A0
export const MIDI_HIGHEST = 108; // C8
export const MIDDLE_C = 60;

export function isBlackKey(note) {
  return BLACK_SEMITONES.has(((note % 12) + 12) % 12);
}

export function noteName(note) {
  const pitch = NOTE_NAMES[((note % 12) + 12) % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${pitch}${octave}`;
}

export function noteToFrequency(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function clampNote(note) {
  return Math.min(127, Math.max(0, note));
}

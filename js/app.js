import { MidiManager } from "./midi.js";
import { SessionRecorder } from "./recorder.js";
import { buildMidiFile, downloadMidi } from "./midi-writer.js";
import { PianoSynth } from "./synth.js";
import { PianoKeyboardUI } from "./piano-ui.js";
import { ComputerKeyboard, DEFAULT_KEY_MAP, codeLabel } from "./keyboard.js";
import { noteName } from "./note-utils.js";

const $ = (id) => document.getElementById(id);

const STORAGE = {
  theme: "psr-theme",
  keymap: "psr-keymap",
  sound: "psr-sound",
  volume: "psr-volume",
  velocity: "psr-velocity",
  source: "psr-source",
};

const ui = {
  themeToggle: $("themeToggle"),
  settingsBtn: $("btnSettings"),
  navItems: document.querySelectorAll(".nav__item"),
  viewDashboard: $("viewDashboard"),
  viewAbout: $("viewAbout"),
  sourceButtons: document.querySelectorAll(".segmented__item"),
  midiDot: $("midiDot"),
  midiStatus: $("midiStatus"),
  deviceSelect: $("deviceSelect"),
  recordingPill: $("recordingPill"),
  noteCount: $("noteCount"),
  heroHint: $("heroHint"),
  statTotal: $("statTotal"),
  statNps: $("statNps"),
  statPeakNps: $("statPeakNps"),
  statElapsed: $("statElapsed"),
  btnRecord: $("btnRecord"),
  btnStop: $("btnStop"),
  btnExport: $("btnExport"),
  btnReset: $("btnReset"),
  eventMeta: $("eventMeta"),
  footerSource: $("footerSource"),
  nowPlaying: $("nowPlaying"),
  octaveValue: $("octaveValue"),
  btnOctaveDown: $("btnOctaveDown"),
  btnOctaveUp: $("btnOctaveUp"),
  soundToggle: $("soundToggle"),
  piano: $("piano"),
  pianoHint: $("pianoHint"),
  settingsModal: $("settingsModal"),
  velocityRange: $("velocityRange"),
  velocityValue: $("velocityValue"),
  volumeRange: $("volumeRange"),
  volumeValue: $("volumeValue"),
  keymapList: $("keymapList"),
  btnResetMapping: $("btnResetMapping"),
  toast: $("toast"),
};

const midi = new MidiManager();
const session = new SessionRecorder();
const synth = new PianoSynth();

let inputSource = "keyboard";
let toastTimer = null;
let lockedNoteCount = 0;
let audioPromptShown = false;

const piano = new PianoKeyboardUI(ui.piano, {
  onNoteOn: (note) => {
    synth.resume();
    handleNoteOn(note, keyboard.velocity);
  },
  onNoteOff: (note) => handleNoteOff(note),
});

const keyboard = new ComputerKeyboard({
  onNoteOn: (note, velocity) => {
    synth.resume();
    handleNoteOn(note, velocity);
  },
  onNoteOff: (note) => handleNoteOff(note),
  onOctaveChange: () => {
    refreshKeyLabels();
    piano.scrollToNote(keyboard.baseNote);
  },
});

/* ---------------------------------------------------------------- formatting */

const formatCount = (n) => n.toLocaleString("en-US");
const formatNps = (n) => n.toFixed(1);

function formatElapsed(ms) {
  const tenths = Math.floor(ms / 100);
  const seconds = Math.floor(tenths / 10);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}.${tenths % 10}`;
}

/* -------------------------------------------------------------------- notes */

function handleNoteOn(note, velocity = 100) {
  piano.setActive(note, true);
  synth.noteOn(note, velocity);
  ui.nowPlaying.textContent = noteName(note);
  processMessage([0x90, note, velocity]);
}

function handleNoteOff(note) {
  piano.setActive(note, false);
  synth.noteOff(note);
  if (piano.activeNotes.size === 0) ui.nowPlaying.textContent = "—";
  processMessage([0x80, note, 0]);
}

/** Single funnel for every source so recordings are identical either way. */
function processMessage(bytes, timeStamp) {
  const result = session.capture(bytes, timeStamp);
  if (!result) return;

  if (result.isNoteOn) {
    ui.noteCount.textContent = formatCount(result.noteCount);
    ui.statTotal.textContent = formatCount(result.noteCount);
    flashCounter();
  }
  updateControls();
}

function handleDeviceMessage(event) {
  const data = event.data;
  if (!data || data.length === 0) return;

  const status = data[0] & 0xf0;
  const note = data[1];
  const isNoteOn = status === 0x90 && data.length >= 3 && data[2] > 0;

  if (isNoteOn) {
    unlockAudio();
    piano.setActive(note, true);
    synth.noteOn(note, data[2]);
    ui.nowPlaying.textContent = noteName(note);
  } else if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
    piano.setActive(note, false);
    synth.noteOff(note);
    if (piano.activeNotes.size === 0) ui.nowPlaying.textContent = "—";
  } else if (status === 0xb0 && note === 64) {
    synth.setSustain(data[2] >= 64);
  }

  processMessage(data, event.timeStamp);
}

function flashCounter() {
  ui.noteCount.classList.remove("is-hit");
  void ui.noteCount.offsetWidth; // restart the animation on rapid notes
  ui.noteCount.classList.add("is-hit");
}

/**
 * Playing a MIDI instrument is not a browser gesture, so the audio context can
 * stay locked no matter how many notes arrive. Ask for a click once it is clear
 * that resuming on its own is not working.
 */
function unlockAudio() {
  synth.resume();

  if (!synth.enabled || !synth.isSuspended) {
    lockedNoteCount = 0;
    return;
  }

  lockedNoteCount += 1;
  if (lockedNoteCount >= 3 && !audioPromptShown) {
    audioPromptShown = true;
    showToast("Click anywhere on the page to enable sound");
  }
}

/* ------------------------------------------------------------------ display */

function updateCounters() {
  ui.noteCount.textContent = formatCount(session.noteCount);
  ui.statTotal.textContent = formatCount(session.noteCount);
  ui.statNps.textContent = formatNps(session.getLiveNps());
  ui.statPeakNps.textContent = formatNps(session.peakNps);
  ui.statElapsed.textContent = formatElapsed(session.getElapsedMs());
  ui.eventMeta.textContent = `${formatCount(session.events.length)} events`;
}

function updateControls() {
  const recording = session.recording;
  ui.btnRecord.hidden = recording;
  ui.btnStop.hidden = !recording;
  ui.btnExport.disabled = !session.hasData;
  ui.btnReset.disabled = recording || !session.hasData;
  ui.recordingPill.hidden = !recording;
}

function setInputSource(source, { persist = false } = {}) {
  if (inputSource === source) return;
  inputSource = source;
  if (persist) localStorage.setItem(STORAGE.source, source);
  piano.clearActive();
  synth.allNotesOff();
  updateSourceUi();
}

function updateSourceUi() {
  for (const button of ui.sourceButtons) {
    button.classList.toggle("is-active", button.dataset.source === inputSource);
  }

  const usingKeyboard = inputSource === "keyboard";
  keyboard.setEnabled(usingKeyboard);

  const live = [];
  if (usingKeyboard) live.push("Computer keyboard");
  if (midi.activeInput) live.push(midi.activeInput.name || "MIDI device");
  ui.footerSource.textContent = live.join(" + ") || "No input";
  ui.pianoHint.hidden = !usingKeyboard;

  refreshKeyLabels();
  updateMidiStatus();
}

function refreshKeyLabels() {
  piano.setKeyLabels(
    inputSource === "keyboard" ? keyboard.getNoteLabels() : new Map()
  );
  ui.octaveValue.textContent = noteName(keyboard.baseNote);
}

function updateMidiStatus() {
  ui.midiDot.className = "status-bar__dot";

  if (!midi.supported) {
    ui.midiDot.classList.add("status-bar__dot--warn");
    ui.midiStatus.textContent = "Web MIDI unavailable";
  } else if (midi.activeInput) {
    ui.midiDot.classList.add("status-bar__dot--ok");
    ui.midiStatus.textContent = midi.activeInput.name || "MIDI connected";
  } else if (midi.inputs.length === 0) {
    ui.midiDot.classList.add("status-bar__dot--warn");
    ui.midiStatus.textContent = "No MIDI devices";
  } else {
    ui.midiStatus.textContent = "Select a device";
  }

  updateControls();
}

function setHint(text) {
  ui.heroHint.textContent = text;
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  ui.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove("is-visible");
    toastTimer = setTimeout(() => {
      ui.toast.hidden = true;
    }, 220);
  }, 2600);
}

/* ---------------------------------------------------------------- recording */

function startRecording() {
  synth.resume();
  session.start();
  updateCounters();
  updateControls();
  setHint("Recording — every note is counted and captured.");
}

function stopRecording() {
  session.stop();
  updateCounters();
  updateControls();
  setHint(
    session.hasData
      ? "Session captured. Export a .mid file for Synthesia."
      : "No notes were recorded."
  );
}

function resetSession() {
  session.reset();
  updateCounters();
  updateControls();
  setHint("Press Record, then play your keyboard.");
}

function exportMidi() {
  if (!session.hasData) {
    showToast("Nothing recorded yet");
    return;
  }

  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `piano-session-${stamp.getFullYear()}${pad(
    stamp.getMonth() + 1
  )}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(
    stamp.getMinutes()
  )}${pad(stamp.getSeconds())}.mid`;

  const bytes = buildMidiFile(session.events, {
    trackName: "Piano Session Recorder",
    bpm: 120,
  });

  downloadMidi(bytes, filename);
  showToast(
    `Exported ${formatCount(session.noteCount)} notes · ${formatCount(
      bytes.length
    )} bytes`
  );
}

/* ----------------------------------------------------------------- settings */

/**
 * Reads a stored number, falling back when the key was never written.
 * Note that Number(null) is 0 rather than NaN, so an unset key has to be
 * detected before parsing or every default silently becomes zero.
 */
function readStoredNumber(key, fallback, min, max) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function loadSettings() {
  const savedMap = localStorage.getItem(STORAGE.keymap);
  if (savedMap) {
    try {
      keyboard.setMapping(JSON.parse(savedMap));
    } catch {
      keyboard.resetMapping();
    }
  }

  keyboard.velocity = readStoredNumber(STORAGE.velocity, 100, 20, 127);
  ui.velocityRange.value = String(keyboard.velocity);
  ui.velocityValue.textContent = String(keyboard.velocity);

  const resolvedVolume = readStoredNumber(STORAGE.volume, 70, 0, 100);
  synth.setVolume(resolvedVolume / 100);
  ui.volumeRange.value = String(resolvedVolume);
  ui.volumeValue.textContent = String(resolvedVolume);

  const soundOn = localStorage.getItem(STORAGE.sound) !== "off";
  synth.setEnabled(soundOn);
  ui.soundToggle.checked = soundOn;

  const savedSource = localStorage.getItem(STORAGE.source);
  if (savedSource === "midi" || savedSource === "keyboard") {
    inputSource = savedSource;
  }
}

function saveMapping() {
  localStorage.setItem(STORAGE.keymap, JSON.stringify(keyboard.keyMap));
}

function renderKeymap() {
  ui.keymapList.innerHTML = "";

  const entries = Object.entries(keyboard.keyMap).sort((a, b) => a[1] - b[1]);

  for (const [code, semitone] of entries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "keymap__row";
    row.dataset.semitone = String(semitone);

    const label = document.createElement("span");
    label.className = "keymap__note";
    label.textContent = noteName(keyboard.baseNote + semitone);

    const key = document.createElement("kbd");
    key.className = "keymap__key";
    key.textContent = codeLabel(code);

    row.append(label, key);
    row.addEventListener("click", () => beginRebind(row, key, semitone));
    ui.keymapList.appendChild(row);
  }
}

function beginRebind(row, keyElement, semitone) {
  ui.keymapList
    .querySelectorAll(".keymap__row.is-listening")
    .forEach((el) => el.classList.remove("is-listening"));

  row.classList.add("is-listening");
  keyElement.textContent = "Press…";

  keyboard.captureNextKey(semitone, (code) => {
    if (code) {
      const next = Object.fromEntries(
        Object.entries(keyboard.keyMap).filter(([existing]) => existing !== code)
      );
      const previous = Object.entries(next).find(
        ([, value]) => value === semitone
      );
      if (previous) delete next[previous[0]];
      next[code] = semitone;
      keyboard.setMapping(next);
      saveMapping();
    }
    renderKeymap();
    refreshKeyLabels();
  });
}

/* --------------------------------------------------------------------- init */

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE.theme, theme);
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme);
  if (saved === "light" || saved === "dark") {
    setTheme(saved);
    return;
  }
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  setTheme(prefersLight ? "light" : "dark");
}

function setView(view) {
  ui.viewDashboard.hidden = view !== "dashboard";
  ui.viewAbout.hidden = view !== "about";
  for (const item of ui.navItems) {
    item.classList.toggle("is-active", item.dataset.view === view);
  }
}

function populateDevices(inputs) {
  ui.deviceSelect.innerHTML = "";
  ui.deviceSelect.disabled = inputs.length === 0;

  if (inputs.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No devices";
    ui.deviceSelect.appendChild(option);
    return;
  }

  for (const input of inputs) {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.name || input.manufacturer || "MIDI device";
    ui.deviceSelect.appendChild(option);
  }

  if (midi.activeInput) ui.deviceSelect.value = midi.activeInput.id;
}

async function initMidi() {
  if (!midi.supported) {
    updateMidiStatus();
    return;
  }

  midi.onDevicesChanged = populateDevices;
  midi.onStateChange = updateMidiStatus;
  midi.onMessage = handleDeviceMessage;

  try {
    await midi.connect();
    // Connecting an instrument must never silence the computer keyboard: a
    // MIDI device always plays, so the toggle only decides whether QWERTY is
    // live, and that stays the user's choice.
    updateSourceUi();
  } catch (error) {
    console.error(error);
    ui.midiDot.className = "status-bar__dot status-bar__dot--warn";
    ui.midiStatus.textContent = "MIDI permission denied";
    showToast("MIDI access was denied — computer keyboard still works");
  }
}

function bindUi() {
  ui.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "light" : "dark");
  });

  for (const item of ui.navItems) {
    item.addEventListener("click", () => setView(item.dataset.view));
  }

  for (const button of ui.sourceButtons) {
    button.addEventListener("click", () =>
      setInputSource(button.dataset.source, { persist: true })
    );
  }

  ui.deviceSelect.addEventListener("change", () => {
    midi.selectInput(ui.deviceSelect.value || null);
    updateSourceUi();
  });

  ui.btnRecord.addEventListener("click", startRecording);
  ui.btnStop.addEventListener("click", stopRecording);
  ui.btnExport.addEventListener("click", exportMidi);
  ui.btnReset.addEventListener("click", resetSession);

  ui.btnOctaveDown.addEventListener("click", () => keyboard.shiftOctave(-1));
  ui.btnOctaveUp.addEventListener("click", () => keyboard.shiftOctave(1));

  ui.soundToggle.addEventListener("change", () => {
    synth.setEnabled(ui.soundToggle.checked);
    localStorage.setItem(STORAGE.sound, ui.soundToggle.checked ? "on" : "off");
    if (ui.soundToggle.checked) synth.resume();
  });

  ui.settingsBtn.addEventListener("click", () => {
    renderKeymap();
    keyboard.setEnabled(false);
    ui.settingsModal.showModal();
  });

  ui.settingsModal.addEventListener("close", () => {
    keyboard.cancelCapture();
    updateSourceUi();
  });

  ui.velocityRange.addEventListener("input", () => {
    keyboard.velocity = Number(ui.velocityRange.value);
    ui.velocityValue.textContent = ui.velocityRange.value;
    localStorage.setItem(STORAGE.velocity, ui.velocityRange.value);
  });

  ui.volumeRange.addEventListener("input", () => {
    synth.setVolume(Number(ui.volumeRange.value) / 100);
    ui.volumeValue.textContent = ui.volumeRange.value;
    localStorage.setItem(STORAGE.volume, ui.volumeRange.value);
  });

  ui.btnResetMapping.addEventListener("click", () => {
    keyboard.setMapping(DEFAULT_KEY_MAP);
    saveMapping();
    renderKeymap();
    refreshKeyLabels();
  });

  window.addEventListener("keydown", (event) => {
    if (ui.settingsModal.open) return;
    if (event.target.closest?.("input, textarea, select")) return;

    if (event.code === "Space") {
      event.preventDefault();
      if (session.recording) stopRecording();
      else startRecording();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
      event.preventDefault();
      exportMidi();
    }
  });

  // Retry on every gesture until the context actually reports "running";
  // a single attempt can land before the browser is willing to unlock audio.
  const gestureUnlock = () => {
    synth.resume();
    if (synth.isSuspended) return;
    lockedNoteCount = 0;
    audioPromptShown = false;
    document.removeEventListener("pointerdown", gestureUnlock);
    document.removeEventListener("keydown", gestureUnlock);
  };

  document.addEventListener("pointerdown", gestureUnlock);
  document.addEventListener("keydown", gestureUnlock);
}

function tick() {
  updateCounters();
  requestAnimationFrame(tick);
}

initTheme();
loadSettings();
bindUi();
updateSourceUi();
updateCounters();
updateControls();
initMidi();

requestAnimationFrame(() => piano.scrollToNote(keyboard.baseNote));
requestAnimationFrame(tick);

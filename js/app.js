import { MidiManager } from "./midi.js";
import { SessionRecorder } from "./recorder.js";
import { buildMidiFile, downloadMidi } from "./midi-writer.js";

const $ = (id) => document.getElementById(id);

const ui = {
  themeToggle: $("themeToggle"),
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
};

const midi = new MidiManager();
const session = new SessionRecorder();

let hasExportableSession = false;
let rafId = null;

function formatCount(n) {
  return n.toLocaleString("en-US");
}

function formatElapsed(ms) {
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function formatNps(n) {
  return n.toFixed(1);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("psr-theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("psr-theme");
  if (saved === "light" || saved === "dark") {
    setTheme(saved);
    return;
  }
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  setTheme(prefersLight ? "light" : "dark");
}

function flashCounter() {
  ui.noteCount.classList.remove("is-hit");
  // Force reflow so the animation restarts on rapid notes
  void ui.noteCount.offsetWidth;
  ui.noteCount.classList.add("is-hit");
}

function updateCounters() {
  ui.noteCount.textContent = formatCount(session.noteCount);
  ui.statTotal.textContent = formatCount(session.noteCount);
  ui.statNps.textContent = formatNps(session.getLiveNps());
  ui.statPeakNps.textContent = formatNps(session.peakNps);
  ui.statElapsed.textContent = formatElapsed(session.getElapsedMs());
  ui.eventMeta.textContent = `${session.events.length.toLocaleString("en-US")} events · ${session
    .getByteEstimate()
    .toLocaleString("en-US")} bytes`;
}

function updateControls() {
  const connected = !!midi.activeInput;
  const recording = session.recording;

  ui.btnRecord.disabled = !connected || recording;
  ui.btnRecord.hidden = recording;
  ui.btnStop.disabled = !recording;
  ui.btnStop.hidden = !recording;
  ui.btnExport.disabled = !hasExportableSession || recording;
  ui.btnReset.disabled = recording || (session.noteCount === 0 && !hasExportableSession);
  ui.recordingPill.hidden = !recording;
}

function updateMidiStatus() {
  const connected = !!midi.activeInput;

  ui.midiDot.className = "status-bar__dot";
  if (!midi.supported) {
    ui.midiDot.classList.add("status-bar__dot--warn");
    ui.midiStatus.textContent = "Web MIDI unavailable";
    ui.heroHint.textContent = "Open this page in Chrome or Edge to use USB MIDI.";
  } else if (connected) {
    ui.midiDot.classList.add("status-bar__dot--ok");
    ui.midiStatus.textContent = "MIDI connected";
    ui.heroHint.textContent = session.recording
      ? "Recording — every note is counted and captured."
      : "Ready. Press Record, then play.";
  } else if (midi.inputs.length === 0) {
    ui.midiDot.classList.add("status-bar__dot--warn");
    ui.midiStatus.textContent = "No MIDI devices";
    ui.heroHint.textContent =
      "Plug in your Yamaha P-145BT via USB and allow MIDI access.";
  } else {
    ui.midiStatus.textContent = "Select a device";
    ui.heroHint.textContent = "Choose your keyboard from the device list.";
  }

  updateControls();
}

function populateDevices(inputs) {
  ui.deviceSelect.innerHTML = "";
  ui.deviceSelect.disabled = inputs.length === 0;

  if (inputs.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No devices";
    ui.deviceSelect.appendChild(opt);
    return;
  }

  for (const input of inputs) {
    const opt = document.createElement("option");
    opt.value = input.id;
    opt.textContent = input.name || input.manufacturer || "MIDI device";
    ui.deviceSelect.appendChild(opt);
  }

  if (midi.activeInput) {
    ui.deviceSelect.value = midi.activeInput.id;
  }
}

function tick() {
  if (session.recording || hasExportableSession) {
    updateCounters();
  }
  rafId = requestAnimationFrame(tick);
}

function startRecording() {
  if (!midi.activeInput) return;
  session.start();
  hasExportableSession = false;
  updateCounters();
  updateMidiStatus();
}

function stopRecording() {
  session.stop();
  hasExportableSession = session.events.length > 0;
  updateCounters();
  updateMidiStatus();
  ui.heroHint.textContent = hasExportableSession
    ? "Session captured. Export a .mid file for Synthesia."
    : "No MIDI events were recorded.";
}

function resetSession() {
  session.reset();
  hasExportableSession = false;
  updateCounters();
  updateMidiStatus();
  ui.heroHint.textContent = midi.activeInput
    ? "Ready. Press Record, then play."
    : "Connect your Yamaha P-145BT, then press Record and play.";
}

function exportMidi() {
  if (!hasExportableSession || session.events.length === 0) return;

  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `piano-session-${stamp.getFullYear()}${pad(
    stamp.getMonth() + 1
  )}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(
    stamp.getSeconds()
  )}.mid`;

  const bytes = buildMidiFile(session.events, {
    trackName: "Piano Session Recorder",
    bpm: 120,
  });
  downloadMidi(bytes, filename);
}

async function initMidi() {
  if (!midi.supported) {
    updateMidiStatus();
    return;
  }

  try {
    midi.onDevicesChanged = populateDevices;
    midi.onStateChange = updateMidiStatus;
    midi.onMessage = (message) => {
      const result = session.handleMessage(message);
      if (!result) return;
      if (result.isNoteOn) {
        ui.noteCount.textContent = formatCount(result.noteCount);
        ui.statTotal.textContent = formatCount(result.noteCount);
        flashCounter();
      }
    };

    await midi.connect();
    updateMidiStatus();
  } catch (err) {
    console.error(err);
    ui.midiDot.className = "status-bar__dot status-bar__dot--warn";
    ui.midiStatus.textContent = "MIDI permission denied";
    ui.heroHint.textContent =
      "Allow MIDI access when prompted, then refresh the page.";
  }
}

function bindUi() {
  ui.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(current === "dark" ? "light" : "dark");
  });

  ui.deviceSelect.addEventListener("change", () => {
    midi.selectInput(ui.deviceSelect.value || null);
    updateMidiStatus();
  });

  ui.btnRecord.addEventListener("click", startRecording);
  ui.btnStop.addEventListener("click", stopRecording);
  ui.btnExport.addEventListener("click", exportMidi);
  ui.btnReset.addEventListener("click", resetSession);

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (session.recording) stopRecording();
      else if (!ui.btnRecord.disabled) startRecording();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
      e.preventDefault();
      if (!ui.btnExport.disabled) exportMidi();
    }
  });
}

initTheme();
bindUi();
updateCounters();
updateControls();
initMidi();
rafId = requestAnimationFrame(tick);

window.addEventListener("beforeunload", () => {
  if (rafId) cancelAnimationFrame(rafId);
});

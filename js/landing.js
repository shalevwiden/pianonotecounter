/**
 * Peak Notes landing — scroll reveals + one-octave clickable keyboard.
 */

const NOTES = [
  { midi: 60, name: "C", black: false },
  { midi: 61, name: "C♯", black: true },
  { midi: 62, name: "D", black: false },
  { midi: 63, name: "D♯", black: true },
  { midi: 64, name: "E", black: false },
  { midi: 65, name: "F", black: false },
  { midi: 66, name: "F♯", black: true },
  { midi: 67, name: "G", black: false },
  { midi: 68, name: "G♯", black: true },
  { midi: 69, name: "A", black: false },
  { midi: 70, name: "A♯", black: true },
  { midi: 71, name: "B", black: false },
];

const BLACK_LEFT = {
  61: 10.2,
  63: 24.6,
  66: 53.4,
  68: 67.8,
  70: 82.2,
};

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function playNote(midi) {
  const ctx = ensureAudio();
  if (!ctx) return;

  const now = ctx.currentTime;
  const freq = midiToHz(midi);

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.22, now + 0.012);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
  master.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(Math.min(9000, freq * 8 + 1200), now);
  filter.frequency.exponentialRampToValueAtTime(freq * 3, now + 0.8);
  filter.connect(master);

  for (const [type, ratio, gain, detune] of [
    ["triangle", 1, 0.7, 0],
    ["sine", 2, 0.22, 3],
    ["sine", 3, 0.1, -2],
  ]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq * ratio;
    osc.detune.value = detune;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(filter);
    osc.start(now);
    osc.stop(now + 1.4);
  }
}

function buildOctave() {
  const root = document.getElementById("landingOctave");
  const hint = document.getElementById("octaveHint");
  if (!root) return;

  root.innerHTML = "";
  const whites = document.createElement("div");
  whites.className = "landing-octave__whites";
  const blacks = document.createElement("div");
  blacks.className = "landing-octave__blacks";

  for (const note of NOTES.filter((n) => !n.black)) {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "landing-octave__key landing-octave__key--white";
    key.dataset.midi = String(note.midi);
    key.setAttribute("aria-label", `${note.name}4`);
    key.innerHTML = `<span>${note.name}</span>`;
    whites.appendChild(key);
  }

  for (const note of NOTES.filter((n) => n.black)) {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "landing-octave__key landing-octave__key--black";
    key.dataset.midi = String(note.midi);
    key.style.left = `${BLACK_LEFT[note.midi]}%`;
    key.setAttribute("aria-label", `${note.name}4`);
    blacks.appendChild(key);
  }

  root.append(whites, blacks);

  const press = (key) => {
    const midi = Number(key.dataset.midi);
    key.classList.add("is-active");
    playNote(midi);
    if (hint) hint.textContent = "Keep going — or open the full studio";
    window.setTimeout(() => key.classList.remove("is-active"), 160);
  };

  root.addEventListener("pointerdown", (event) => {
    const key = event.target.closest(".landing-octave__key");
    if (!key) return;
    event.preventDefault();
    press(key);
  });
}

function initReveals() {
  const nodes = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    nodes.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
  );

  nodes.forEach((el) => observer.observe(el));
}

function initNavScroll() {
  const nav = document.querySelector(".landing-nav");
  if (!nav) return;
  const onScroll = () => {
    nav.classList.toggle("is-scrolled", window.scrollY > 24);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

buildOctave();
initReveals();
initNavScroll();

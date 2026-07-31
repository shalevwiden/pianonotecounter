# Piano Session Recorder

A polished web app for recording piano performances. Play a USB MIDI instrument or your computer keyboard, watch a live note counter, and export a Standard MIDI File you can open in Synthesia.

Tested with a **Yamaha P-145BT** over USB MIDI in Chrome.

## Requirements

- [Python 3](https://www.python.org/) for the local server
- [Sass](https://sass-lang.com/) only if you edit styles (`brew install sass/sass/sass`)
- Chrome or Edge for Web MIDI (computer-keyboard input works in any modern browser)

## Quick start

```bash
python3 scripts/serve.py
```

Serves the app at [http://127.0.0.1:8765](http://127.0.0.1:8765) and opens it. If that port is busy the script automatically moves to the next free one.

```bash
python3 scripts/serve.py --port 9000   # pick a port
python3 scripts/serve.py --no-open     # don't launch a browser
```

> Web MIDI requires a secure context. Serving over `localhost` satisfies this; opening `index.html` as a `file://` URL does not.

## Playing

Choose an input source at the top of the dashboard.

A connected instrument **always** plays and records. The source toggle only decides whether the computer keyboard is live as well, so pick **MIDI Device** when you want typing to stay silent during a take.

**MIDI Device** — plug the keyboard in over USB and allow MIDI access when prompted. Detected instruments appear in the dropdown, and Yamaha devices are preferred automatically.

**Computer Keyboard** — the home row plays white keys starting at Middle C, and the row above holds the black keys in their natural gaps:

| Keys | Purpose |
| --- | --- |
| `A S D F G H J K L ; '` | White keys, C4 upward |
| `W E T Y U O P` | Black keys |
| `Z` / `X` | Octave down / up (arrow keys also work) |
| `Space` | Start or stop recording |
| `⌘E` / `Ctrl+E` | Export the session |

Multiple keys can be held at once, key repeat is ignored, and every note lights up the on-screen 88-key piano. Notes sound through a built-in synth, which can be muted with the Sound switch.

## Recording and export

1. Press **Record** (or `Space`).
2. Play. The counter, notes per second, peak NPS, and elapsed time update live.
3. Press **Stop**.
4. Press **Export .mid**.

Exports are **SMF Format 1** at **480 PPQN** with a dedicated tempo track at 120 BPM. Notes still held when you stop are closed automatically, leading silence is trimmed so the roll starts on your first note, and system-realtime traffic such as active sensing is discarded.

### Checking an exported file

```bash
python3 scripts/verify_midi.py ~/Downloads/piano-session-20260731-120000.mid --events 10
```

It reports the header, per-track note counts, tempo, and warns about notes left hanging. A file that plays correctly ends with `OK  N notes on, N notes off`.

## Settings

The gear icon opens a panel for note velocity, playback volume, and key mapping. Select any note, press the key you want, and the binding is saved. Preferences persist in local storage.

## Project structure

```
piano-midi/
├── index.html
├── css/main.css              # compiled styles
├── scss/                     # source styles
├── js/
│   ├── app.js                # UI wiring and session flow
│   ├── midi.js               # Web MIDI device manager
│   ├── keyboard.js           # QWERTY piano mapping
│   ├── synth.js              # WebAudio piano voice
│   ├── piano-ui.js           # 88-key on-screen keyboard
│   ├── recorder.js           # event capture and live stats
│   ├── midi-writer.js        # Standard MIDI File builder
│   └── note-utils.js         # shared note helpers
└── scripts/
    ├── serve.py              # local HTTP server
    ├── compile_scss.py       # SCSS → CSS
    └── verify_midi.py        # inspect an exported .mid
```

## Editing styles

```bash
python3 scripts/compile_scss.py            # one-off build
python3 scripts/compile_scss.py --watch    # rebuild on change
```

## Troubleshooting

**Exports look empty**  
Run `verify_midi.py` on the file. If it reports zero note-ons, the session had no notes. The dev server sends no-cache headers so code changes always take effect; if you are serving the app another way, hard-reload with `⌘⇧R` — browsers cache ES modules aggressively and a stale `midi-writer.js` can produce a malformed header.

**"Web MIDI unavailable"**  
Use Chrome or Edge. Safari and Firefox do not support Web MIDI here. Computer-keyboard input still works.

**"No MIDI devices"**  
Confirm the keyboard is powered and connected over USB rather than Bluetooth only, then check that it appears in macOS **Audio MIDI Setup**. Try another cable or port, and reload the page.

**No sound**  
Browsers keep audio locked until the page receives a real user gesture, and MIDI notes do not count as one — playing a connected instrument on a page you have never clicked leaves the audio context suspended. Click anywhere once and the sound starts; the app prompts you if it detects this. Also check that the Sound switch is on.

**Notes are not counting**  
Counting starts when a recording is active. Press **Record** first, and confirm the input source matches how you are playing.

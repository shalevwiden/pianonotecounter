# Piano Session Recorder

A polished web app for recording piano performances over USB MIDI. Built for YouTube sessions with a live note counter and accurate `.mid` export (Synthesia-friendly).

Works with keyboards like the **Yamaha P-145BT** via the Web MIDI API in Chrome or another Chromium-based browser.

## Requirements

- macOS (or any OS with a modern Chromium browser)
- [Python 3](https://www.python.org/) (for the local server)
- [Sass](https://sass-lang.com/) (only if you edit styles)
- Chrome, Edge, or another Chromium browser with Web MIDI support
- A USB MIDI keyboard

## Quick start

From the project root:

```bash
python3 scripts/serve.py
```

This starts a local server at [http://127.0.0.1:8765](http://127.0.0.1:8765) and opens it in your browser.

Options:

```bash
python3 scripts/serve.py --port 9000      # custom port
python3 scripts/serve.py --no-open       # don't auto-open the browser
```

> Web MIDI needs a secure context. Serving over `http://127.0.0.1` is enough; opening `index.html` as a `file://` URL usually will not work.

## Using the app

1. Plug in your keyboard over USB (e.g. Yamaha P-145BT).
2. Open the app in Chrome/Edge and **allow MIDI access** when prompted.
3. Confirm the correct device is selected in the device dropdown (Yamaha devices are preferred automatically).
4. Click **Record**, then play.
5. Click **Stop** when finished.
6. Click **Export .mid** to download a Standard MIDI File.

### Keyboard shortcuts

| Shortcut        | Action                 |
| --------------- | ---------------------- |
| `Space`         | Start / stop recording |
| `⌘E` / `Ctrl+E` | Export `.mid`          |

### Dashboard

- **Notes Played** — live total of Note On events (velocity &gt; 0)
- **Total Notes** — same total in the stats row
- **Notes / Sec** — rolling 1-second NPS
- **Peak NPS** — highest NPS reached in the session
- **Elapsed** — recording duration

Use the theme toggle in the header for dark or light mode.

## MIDI export

Exports are **Standard MIDI File (SMF) Type 1**:

- Tempo track at 120 BPM
- Performance track with note, control change (e.g. sustain), and pitch-bend events
- **480 PPQN** resolution
- Timing taken from Web MIDI message timestamps so the file can open cleanly in **Synthesia** for a piano-roll visualization

## Project structure

```
piano-midi/
├── index.html
├── css/main.css          # compiled styles
├── scss/                 # source styles
├── js/
│   ├── app.js            # UI + session flow
│   ├── midi.js           # Web MIDI device manager
│   ├── recorder.js       # note counting + event capture
│   └── midi-writer.js    # SMF .mid builder
└── scripts/
    ├── serve.py          # local HTTP server
    └── compile_scss.py   # SCSS → CSS
```

## Editing styles

After changing files under `scss/`:

```bash
python3 scripts/compile_scss.py
```

Watch mode:

```bash
python3 scripts/compile_scss.py --watch
```

Requires the `sass` CLI (`brew install sass/sass/sass` on macOS).

## Troubleshooting

**“Web MIDI unavailable”**  
Use Chrome or Edge. Firefox and Safari do not fully support Web MIDI for this use case.

**“MIDI permission denied”**  
Allow MIDI when the browser prompts you, then refresh. Check site settings if you previously blocked it.

**“No MIDI devices”**

- Confirm the keyboard is powered and connected over USB (not only Bluetooth, unless your OS exposes it as MIDI).
- Unplug/replug the cable.
- Check macOS **Audio MIDI Setup** to see if the device appears.
- Try another USB port/cable.

**Notes aren’t counting**  
Make sure **Record** is active. Counting and capture only run during a recording session.

**Exported file feels wrong in Synthesia**  
Import the `.mid` as a normal MIDI file. Timing assumes 120 BPM with 480 PPQN; note positions should still match your performance relative to when you pressed Record.

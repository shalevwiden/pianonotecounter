#!/usr/bin/env python3
"""Inspect a Standard MIDI File and report whether it contains playable notes.

Usage:
    python3 scripts/verify_midi.py path/to/session.mid [--events 20]
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(note: int) -> str:
    return f"{NOTE_NAMES[note % 12]}{note // 12 - 1}"


class ParseError(Exception):
    pass


@dataclass
class TrackSummary:
    index: int
    length: int
    note_on: int = 0
    note_off: int = 0
    controls: int = 0
    last_tick: int = 0
    name: str | None = None
    tempo_bpm: float | None = None
    hanging: list[int] = field(default_factory=list)
    events: list[tuple[int, str]] = field(default_factory=list)


def read_vlq(data: bytes, i: int) -> tuple[int, int]:
    value = 0
    for _ in range(4):
        if i >= len(data):
            raise ParseError("unexpected end of data while reading a delta time")
        byte = data[i]
        i += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, i
    raise ParseError("variable-length quantity longer than 4 bytes")


def parse_track(data: bytes, start: int, index: int) -> tuple[TrackSummary, int]:
    if data[start : start + 4] != b"MTrk":
        raise ParseError(f"expected MTrk at byte {start}, found {data[start:start + 4]!r}")

    length = int.from_bytes(data[start + 4 : start + 8], "big")
    i = start + 8
    end = i + length
    summary = TrackSummary(index=index, length=length)

    tick = 0
    running_status: int | None = None
    held: dict[int, int] = {}

    while i < end:
        delta, i = read_vlq(data, i)
        tick += delta

        status = data[i]
        if status & 0x80:
            running_status = status
            i += 1
        else:
            if running_status is None:
                raise ParseError(f"data byte {status:#04x} before any status byte")
            status = running_status

        if status == 0xFF:
            meta_type = data[i]
            i += 1
            meta_len, i = read_vlq(data, i)
            payload = data[i : i + meta_len]
            i += meta_len

            if meta_type == 0x03:
                summary.name = payload.decode("utf-8", "replace")
            elif meta_type == 0x51 and meta_len == 3:
                micros = int.from_bytes(payload, "big")
                summary.tempo_bpm = round(60_000_000 / micros, 3) if micros else None
            elif meta_type == 0x2F:
                break
        elif status in (0xF0, 0xF7):
            sysex_len, i = read_vlq(data, i)
            i += sysex_len
        else:
            kind = status & 0xF0
            data_len = 1 if kind in (0xC0, 0xD0) else 2
            payload = data[i : i + data_len]
            i += data_len

            if kind == 0x90 and payload[1] > 0:
                summary.note_on += 1
                held[payload[0]] = held.get(payload[0], 0) + 1
                if len(summary.events) < 512:
                    summary.events.append((tick, f"on  {note_name(payload[0])} v{payload[1]}"))
            elif kind == 0x80 or (kind == 0x90 and payload[1] == 0):
                summary.note_off += 1
                if held.get(payload[0]):
                    held[payload[0]] -= 1
                    if held[payload[0]] == 0:
                        del held[payload[0]]
                if len(summary.events) < 512:
                    summary.events.append((tick, f"off {note_name(payload[0])}"))
            elif kind == 0xB0:
                summary.controls += 1

    summary.last_tick = tick
    summary.hanging = sorted(held)
    return summary, end


def verify(path: Path, show_events: int) -> int:
    data = path.read_bytes()
    print(f"File     {path}")
    print(f"Size     {len(data):,} bytes")

    if data[:4] != b"MThd":
        print("FAIL     missing MThd header")
        return 1

    header_len = int.from_bytes(data[4:8], "big")
    if header_len != 6:
        print(f"FAIL     MThd length is {header_len}, expected 6")
        return 1

    fmt = int.from_bytes(data[8:10], "big")
    ntracks = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    print(f"Format   {fmt}")
    print(f"Tracks   {ntracks}")
    print(f"Division {division} ticks per quarter note")

    if division == 0 or division & 0x8000:
        print("FAIL     unusable division (SMPTE timing is not supported here)")
        return 1

    i = 14
    total_on = total_off = 0
    tempo = None
    problems: list[str] = []

    for index in range(ntracks):
        try:
            summary, i = parse_track(data, i, index)
        except (ParseError, IndexError) as exc:
            print(f"FAIL     track {index}: {exc}")
            return 1

        total_on += summary.note_on
        total_off += summary.note_off
        tempo = tempo or summary.tempo_bpm

        label = f'"{summary.name}"' if summary.name else "(unnamed)"
        print(
            f"\nTrack {index} {label}\n"
            f"  bytes      {summary.length:,}\n"
            f"  note on    {summary.note_on:,}\n"
            f"  note off   {summary.note_off:,}\n"
            f"  controls   {summary.controls:,}\n"
            f"  last tick  {summary.last_tick:,}"
        )
        if summary.tempo_bpm:
            print(f"  tempo      {summary.tempo_bpm} BPM")
        if summary.hanging:
            names = ", ".join(note_name(n) for n in summary.hanging)
            problems.append(f"track {index} leaves notes held open: {names}")

        if show_events and summary.events:
            print(f"  first {min(show_events, len(summary.events))} note events:")
            for tick, text in summary.events[:show_events]:
                seconds = tick / division * (60 / (tempo or 120))
                print(f"    t={tick:<8} {seconds:7.3f}s  {text}")

    print()
    if total_on == 0:
        print("FAIL     no note-on events — this file would look empty in Synthesia")
        return 1

    for problem in problems:
        print(f"WARN     {problem}")

    print(f"OK       {total_on:,} notes on, {total_off:,} notes off")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a Standard MIDI File")
    parser.add_argument("path", type=Path)
    parser.add_argument(
        "--events", type=int, default=0, help="print the first N note events"
    )
    args = parser.parse_args()

    if not args.path.exists():
        print(f"No such file: {args.path}", file=sys.stderr)
        return 1

    return verify(args.path, args.events)


if __name__ == "__main__":
    raise SystemExit(main())

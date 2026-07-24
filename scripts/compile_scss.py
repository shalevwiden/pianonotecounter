#!/usr/bin/env python3
"""Compile SCSS → css/main.css using the system `sass` binary."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCSS = ROOT / "scss" / "main.scss"
OUT = ROOT / "css" / "main.css"


def main() -> int:
    sass = shutil.which("sass")
    if not sass:
        print("sass not found. Install with: brew install sass/sass/sass", file=sys.stderr)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    cmd = [sass, f"{SCSS}:{OUT}", "--style=compressed", "--no-source-map"]
    if "--watch" in sys.argv:
        cmd.append("--watch")

    print(" ".join(cmd))
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())

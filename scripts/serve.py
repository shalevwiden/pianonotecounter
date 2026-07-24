#!/usr/bin/env python3
"""Serve Piano Session Recorder locally (required for Web MIDI / secure context)."""

from __future__ import annotations

import argparse
import errno
import functools
import http.server
import json
import os
import socketserver
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# #region agent log
_DEBUG_LOG = ROOT / ".cursor" / "debug-7cb5f6.log"


def _agent_log(hypothesis_id: str, location: str, message: str, data: dict) -> None:
    try:
        _DEBUG_LOG.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "sessionId": "7cb5f6",
            "runId": os.environ.get("DEBUG_RUN_ID", "post-fix"),
            "hypothesisId": hypothesis_id,
            "location": location,
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        with _DEBUG_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass


def _port_listeners(port: int) -> list[dict]:
    try:
        out = subprocess.check_output(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    rows = []
    for line in out.strip().splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            rows.append({"command": parts[0], "pid": parts[1], "name": parts[-1]})
    return rows


# #endregion


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **getattr(http.server.SimpleHTTPRequestHandler, "extensions_map", {}),
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".mid": "audio/midi",
        ".midi": "audio/midi",
        ".wasm": "application/wasm",
    }

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), format % args))


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def _is_addr_in_use(exc: OSError) -> bool:
    if exc.errno in {errno.EADDRINUSE}:
        return True
    # macOS sometimes surfaces this only in the message
    return "Address already in use" in str(exc)


def bind_http_server(
    host: str,
    preferred_port: int,
    handler,
    *,
    max_tries: int = 20,
):
    """Bind preferred port, or the next free ports if it is already taken."""
    last_exc: OSError | None = None

    for offset in range(max_tries):
        port = preferred_port + offset
        # #region agent log
        listeners_before = _port_listeners(port)
        _agent_log(
            "E",
            "serve.py:bind_http_server:attempt",
            "Attempting bind",
            {
                "host": host,
                "port": port,
                "preferred_port": preferred_port,
                "offset": offset,
                "pid": os.getpid(),
                "listeners_before": listeners_before,
            },
        )
        # #endregion
        try:
            httpd = ReusableTCPServer((host, port), handler)
            # #region agent log
            _agent_log(
                "E",
                "serve.py:bind_http_server:success",
                "Bind succeeded",
                {
                    "host": host,
                    "port": port,
                    "preferred_port": preferred_port,
                    "fell_back": offset > 0,
                    "pid": os.getpid(),
                },
            )
            # #endregion
            return httpd, port
        except OSError as exc:
            last_exc = exc
            # #region agent log
            _agent_log(
                "A",
                "serve.py:bind_http_server:failed",
                "Bind attempt failed",
                {
                    "host": host,
                    "port": port,
                    "error": str(exc),
                    "errno": getattr(exc, "errno", None),
                    "addr_in_use": _is_addr_in_use(exc),
                    "listeners": _port_listeners(port),
                },
            )
            # #endregion
            if _is_addr_in_use(exc) and offset + 1 < max_tries:
                continue
            raise

    assert last_exc is not None
    raise last_exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve Piano Session Recorder")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-open", action="store_true", help="Do not open a browser")
    args = parser.parse_args()

    os.chdir(ROOT)
    handler = functools.partial(QuietHandler, directory=str(ROOT))

    try:
        httpd, port = bind_http_server(args.host, args.port, handler)
    except OSError as exc:
        # #region agent log
        _agent_log(
            "E",
            "serve.py:main:exhausted",
            "All bind attempts failed",
            {"host": args.host, "preferred_port": args.port, "error": str(exc)},
        )
        # #endregion
        print(
            f"Could not bind {args.host}:{args.port} (or nearby ports) — {exc}",
            file=sys.stderr,
        )
        return 1

    if port != args.port:
        print(
            f"Port {args.port} is in use; serving on {port} instead.",
            file=sys.stderr,
        )

    url = f"http://{args.host}:{port}/"
    print("Piano Session Recorder")
    print(f"Serving {ROOT}")
    print(f"Open {url}")
    print("Press Ctrl+C to stop.\n")

    if not args.no_open:
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

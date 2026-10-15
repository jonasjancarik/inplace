"""Serve one HTML file for in-place editing, with live reload when it changes on disk."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import socket
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import htmldoc

EDITOR_PREFIX = "/__inplace/"


def _digest(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:12]


class Document:
    """The edited file, plus a version that changes whenever its content does."""

    def __init__(self, path: Path, write_ids: bool = True):
        self.path = path
        self.write_ids = write_ids
        self.lock = threading.Lock()
        self.changed = threading.Condition(self.lock)
        self.version = ""
        with self.lock:
            self._refresh()

    def _read(self) -> str:
        return self.path.read_text(encoding="utf-8")

    def _write(self, text: str) -> None:
        tmp = self.path.with_name(f".{self.path.name}.inplace-tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(self.path)
        self.version = _digest(text)

    def _refresh(self) -> str:
        text = self._read()
        version = _digest(text)
        if version != self.version:
            self.version = version
            self.changed.notify_all()
        return text

    def load(self) -> tuple[str, str]:
        """Current text with ids on every editable block, and its version."""
        with self.lock:
            text = self._refresh()
            if self.write_ids:
                text, added = htmldoc.assign_ids(text)
                if added:
                    self._write(text)
            return text, self.version

    def save_block(self, block_id: str, old: str, new: str) -> str:
        with self.lock:
            text = self._refresh()
            patched = htmldoc.patch_block(text, block_id, old, new)
            if patched != text:
                self._write(patched)
            return self.version

    def poll(self) -> None:
        with self.lock:
            try:
                self._refresh()
            except FileNotFoundError:
                pass  # mid-rename by an editor; pick it up on the next poll

    def wait_for_change(self, version: str, timeout: float) -> str:
        with self.lock:
            self.changed.wait_for(lambda: self.version != version, timeout)
            return self.version


def _asset(name: str) -> bytes:
    return files("inplace").joinpath("static", name).read_bytes()


def make_handler(doc: Document):
    root_dir = doc.path.parent.resolve()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # keep the terminal quiet except for errors
            if args and str(args[1]).startswith(("4", "5")):
                super().log_message(fmt, *args)

        def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict):
            self._send(status, json.dumps(payload).encode(), "application/json")

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if path in ("/", "/" + doc.path.name):
                return self._page()
            if path == EDITOR_PREFIX + "editor.js":
                return self._send(200, _asset("editor.js"), "text/javascript; charset=utf-8")
            if path == EDITOR_PREFIX + "events":
                return self._events()
            return self._static(path)

        def do_POST(self):
            if urlparse(self.path).path != EDITOR_PREFIX + "save":
                return self._json(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length", 0))
            try:
                req = json.loads(self.rfile.read(length))
                version = doc.save_block(req["id"], req["old"], req["new"])
            except htmldoc.BlockConflict as e:
                return self._json(409, {"error": "conflict", "current": e.current, "version": doc.version})
            except htmldoc.BlockNotFound:
                return self._json(404, {"error": "block not found", "version": doc.version})
            except (KeyError, ValueError) as e:
                return self._json(400, {"error": str(e)})
            self._json(200, {"version": version})

        def _page(self):
            text, version = doc.load()
            editable = " ".join(htmldoc.editable_ids(text))
            tag = (
                f'<script src="{EDITOR_PREFIX}editor.js" data-inplace '
                f'data-version="{version}" data-file="{doc.path.name}" '
                f'data-editable="{editable}"></script>'
            )
            lower = text.lower()
            at = lower.rfind("</body>")
            text = text[:at] + tag + text[at:] if at != -1 else text + tag
            self._send(200, text.encode(), "text/html; charset=utf-8")

        def _events(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            version = doc.version
            try:
                self.wfile.write(f"event: version\ndata: {version}\n\n".encode())
                self.wfile.flush()
                while True:
                    new = doc.wait_for_change(version, timeout=15)
                    if new == version:
                        self.wfile.write(b": ping\n\n")
                    else:
                        version = new
                        self.wfile.write(f"event: version\ndata: {version}\n\n".encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            self.close_connection = True

        def _static(self, path: str):
            target = (root_dir / path.lstrip("/")).resolve()
            if not target.is_relative_to(root_dir) or not target.is_file():
                return self._send(404, b"not found", "text/plain")
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            self._send(200, target.read_bytes(), ctype)

    return Handler


def _watch(doc: Document, interval: float = 0.25):
    while True:
        time.sleep(interval)
        doc.poll()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="inplace",
        description="Edit an HTML document in the browser while an agent edits the same file.",
    )
    parser.add_argument("file", type=Path, help="HTML file to edit")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument(
        "--no-write-ids",
        action="store_true",
        help="don't add data-id attributes to the file (editing is then disabled for blocks without one)",
    )
    args = parser.parse_args(argv)

    path = args.file.expanduser().resolve()
    if not path.is_file():
        sys.exit(f"inplace: no such file: {path}")

    doc = Document(path, write_ids=not args.no_write_ids)
    threading.Thread(target=_watch, args=(doc,), daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(doc))
    server.daemon_threads = True

    host = socket.gethostname().removesuffix(".local")
    print(f"Editing {path}")
    print(f"  http://localhost:{args.port}/", flush=True)
    if args.host == "0.0.0.0":
        print(f"  http://{host}.local:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

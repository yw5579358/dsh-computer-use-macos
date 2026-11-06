#!/usr/bin/env python3
"""Native helper smoke against an owned fixture, not a Host-consent E2E test.

No system permission is requested or changed. Missing permissions/locked desktop
produce exit 77 (blocked), never a passing native test. --compile-only and
--capabilities-only do not launch the fixture or send desktop input.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import queue
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zlib


ROOT = Path(__file__).resolve().parents[1]
UNICODE_TEXT = "你好，macOS 🧪 — café"
TYPED_TEXT = "Unicode 输入 🧪 Café"


class ProtocolError(RuntimeError):
    def __init__(self, code, method, message=""):
        super().__init__(f"{method}: {code}" + (f": {message}" if message else ""))
        self.code = code


class Helper:
    def __init__(self, executable, log_path):
        self.log = open(log_path, "wb")
        self.process = subprocess.Popen(
            [str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=self.log, bufsize=0,
        )
        self.lines = queue.Queue()
        self.sequence = 0
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        try:
            for line in iter(self.process.stdout.readline, b""):
                self.lines.put(line)
        finally:
            self.lines.put(None)

    def call(self, method, params=None, timeout=30):
        self.sequence += 1
        request_id = f"fixture-{self.sequence}"
        frame = {"id": request_id, "method": method, "params": params or {}}
        self.process.stdin.write((json.dumps(frame, ensure_ascii=False) + "\n").encode())
        self.process.stdin.flush()
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"{method}: helper reply deadline")
            try:
                line = self.lines.get(timeout=remaining)
            except queue.Empty:
                raise TimeoutError(f"{method}: helper reply deadline") from None
            if line is None:
                raise RuntimeError(f"{method}: helper closed its output")
            reply = json.loads(line)
            if reply.get("type") == "diagnostic":
                continue
            if reply.get("id") != request_id:
                raise RuntimeError(f"{method}: mismatched reply identifier")
            if "error" in reply:
                raise ProtocolError(reply["error"].get("code", "UNKNOWN"), method, reply["error"].get("message", ""))
            if "result" not in reply:
                raise RuntimeError(f"{method}: missing result")
            return reply["result"]

    def close(self):
        # This is our proxy connection. Do not kill a shared helper-service PID.
        try:
            self.process.stdin.close()
            self.process.wait(timeout=8)
        except (OSError, subprocess.TimeoutExpired):
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        finally:
            self.log.close()


def wait_state(path, predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = json.loads(path.read_text())
            if predicate(value):
                return value
        except (OSError, ValueError):
            pass
        time.sleep(0.05)
    raise AssertionError("Owned fixture did not show the expected state change")


def build_fixture(directory):
    compiler = shutil.which("swiftc")
    if not compiler:
        raise RuntimeError("swiftc is unavailable; install Apple Command Line Tools")
    bundle = directory / "DSH Native Test Fixture.app"
    executable = bundle / "Contents/MacOS/native-fixture"
    source = ROOT / "test/fixtures/native.swift"
    source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
    receipt = directory / "source.sha256"
    if executable.is_file() and receipt.is_file() and receipt.read_text() == source_digest:
        return executable
    executable.parent.mkdir(parents=True, exist_ok=True)
    with open(bundle / "Contents/Info.plist", "wb") as output:
        plistlib.dump({
            "CFBundleIdentifier": "io.github.yw5579358.dsh-native-fixture." + uuid.uuid4().hex,
            "CFBundleName": "DSH Native Test Fixture",
            "CFBundleExecutable": "native-fixture",
            "CFBundlePackageType": "APPL",
            "CFBundleVersion": "1",
            "LSUIElement": False,
            "NSHighResolutionCapable": True,
        }, output)
    result = subprocess.run(
        [compiler, "-module-cache-path", str(directory / "swift-module-cache"),
         str(source), "-framework", "AppKit", "-o", str(executable)],
        capture_output=True, text=True, timeout=90,
    )
    if result.returncode:
        raise RuntimeError("Fixture compilation failed:\n" + result.stderr[-4000:])
    receipt.write_text(source_digest)
    return executable


def element(state, identifier):
    matches = [value for value in state.get("elements", []) if value.get("identifier") == identifier]
    if len(matches) != 1:
        raise AssertionError(f"Expected one fixture AX element: {identifier}")
    return matches[0]


def clipboard_fingerprint(state_path):
    # Ask the already-owned fixture to hash clipboard formats. A second AppKit
    # process can steal focus even without a window, so do not launch one here.
    identifier = uuid.uuid4().hex
    request_path = state_path.parent / "clipboard-request.json"
    response_path = state_path.parent / "clipboard-response.json"
    request_path.write_text(json.dumps({"command": "fingerprint", "id": identifier}))
    response = wait_state(response_path, lambda result: result.get("id") == identifier)
    response_path.unlink(missing_ok=True)
    request_path.unlink(missing_ok=True)
    if response.get("unavailable"):
        return None
    fingerprint = response.get("digest", "")
    if len(fingerprint) != 64 or any(c not in "0123456789abcdef" for c in fingerprint):
        raise RuntimeError("Owned clipboard fingerprint process returned malformed data")
    return fingerprint


def inspect_png(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError("Screenshot is not a PNG")
    offset, width, height, ended = 8, None, None, False
    while offset + 12 <= len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        content = data[offset + 8:offset + 8 + size]
        if len(content) != size or offset + 12 + size > len(data):
            raise AssertionError("Truncated PNG chunk")
        crc = struct.unpack(">I", data[offset + 8 + size:offset + 12 + size])[0]
        if zlib.crc32(kind + content) & 0xffffffff != crc:
            raise AssertionError("PNG chunk checksum mismatch")
        if kind == b"IHDR":
            width, height = struct.unpack(">II", content[:8])
        if kind == b"IEND":
            ended = True
            break
        offset += 12 + size
    if not ended or not width or not height:
        raise AssertionError("PNG metadata is incomplete")
    return width, height


def exercise(helper, executable, work, artifacts, checks):
    state_path = work / "fixture-state.json"
    fixture = subprocess.Popen(
        [str(executable), "--state", str(state_path)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        wait_state(state_path, lambda state: state.get("ready") and state.get("pid") == fixture.pid)
        app = helper.call("getApp", {"selector": str(fixture.pid)})
        if app.get("pid") != fixture.pid:
            raise AssertionError("Native target is not the owned fixture process")
        handle = app["appHandle"]
        windows = helper.call("listWindows", {"appHandle": handle})
        windows = [window for window in windows if window.get("pid") == fixture.pid and window.get("title") == "DSH Native Test Fixture"]
        if len(windows) != 1:
            raise AssertionError("Expected exactly one owned fixture window")
        window_id = windows[0]["windowId"]

        def observe():
            state = helper.call("getState", {
                "appHandle": handle, "windowId": window_id,
                "maxElements": 400, "maxDepth": 25, "details": True,
            })
            if state.get("pid") != fixture.pid or state.get("windowId") != window_id:
                raise AssertionError("Observation target ownership changed")
            return state

        first = observe()
        button = element(first, "dsh-fixture-increment")
        element(first, "dsh-fixture-text")
        if not first.get("tree") or first.get("truncated"):
            raise AssertionError("Fixture AX observation is empty or truncated")
        checks.append({"name": "owned-window-ax-tree", "status": "pass"})

        helper.call("click", {"appHandle": handle, "snapshotId": first["snapshotId"], "elementIndex": button["index"]})
        wait_state(state_path, lambda state: state.get("counter") == 1)
        checks.append({"name": "ax-button-click-observed-counter", "status": "pass"})

        second = observe()
        if second["snapshotId"] == first["snapshotId"]:
            raise AssertionError("Refreshing state did not create a fresh snapshot")
        try:
            helper.call("click", {"appHandle": handle, "snapshotId": first["snapshotId"], "elementIndex": button["index"]})
        except ProtocolError as error:
            if error.code != "STALE_SNAPSHOT":
                raise
        else:
            raise AssertionError("An obsolete AX snapshot was not rejected")
        wait_state(state_path, lambda state: state.get("counter") == 1)
        checks.append({"name": "obsolete-snapshot-rejected", "status": "pass"})

        current = observe()
        field = element(current, "dsh-fixture-text")
        helper.call("setValue", {
            "appHandle": handle, "snapshotId": current["snapshotId"],
            "elementIndex": field["index"], "value": UNICODE_TEXT,
        })
        wait_state(state_path, lambda state: state.get("text") == UNICODE_TEXT)
        current = observe()
        if element(current, "dsh-fixture-text").get("value") != UNICODE_TEXT:
            raise AssertionError("AX readback did not preserve Unicode text")
        checks.append({"name": "unicode-set-value-and-application-readback", "status": "pass"})

        # Scope screenshot to the exact owned window. Direct helper coordinates
        # use window points; the adapter's encoded-image pixel conversion is a
        # separate test and must not be inferred from this smoke.
        screenshot = helper.call("screenshot", {"appHandle": handle, "windowId": window_id}, timeout=45)
        if screenshot.get("windowId") != window_id or screenshot.get("mimeType") != "image/png":
            raise AssertionError("Screenshot target or encoding mismatch")
        image = base64.b64decode(screenshot["data"], validate=True)
        width, height = inspect_png(image)
        if (width, height) != (screenshot.get("pixelWidth"), screenshot.get("pixelHeight")):
            raise AssertionError("PNG header dimensions disagree with native metadata")
        bounds = screenshot["bounds"]
        if width <= 0 or height <= 0 or bounds["width"] <= 0 or bounds["height"] <= 0:
            raise AssertionError("Screenshot geometry is invalid")
        image_path = artifacts / "owned-fixture.png"
        image_path.write_bytes(image)
        image_path.chmod(0o600)
        checks.append({"name": "owned-window-png-and-geometry", "status": "pass", "pixels": [width, height]})

        button = element(current, "dsh-fixture-increment")
        rectangle = button.get("bounds")
        if not isinstance(rectangle, list) or len(rectangle) != 4:
            raise AssertionError("Fixture button has no point geometry")
        x = rectangle[0] + rectangle[2] / 2 - bounds["x"]
        y = rectangle[1] + rectangle[3] / 2 - bounds["y"]
        if not (0 <= x < bounds["width"] and 0 <= y < bounds["height"]):
            raise AssertionError("Fixture coordinate lies outside the fresh window capture")
        helper.call("click", {
            "appHandle": handle, "windowId": window_id,
            "snapshotId": current["snapshotId"], "x": x, "y": y,
        })
        wait_state(state_path, lambda state: state.get("counter") == 2)
        checks.append({"name": "fresh-window-coordinate-click-observed-counter", "status": "pass"})

        # Exercise keyboard focus/chords independently of AX setValue.
        helper.call("activate", {"appHandle": handle})
        current = observe()
        field = element(current, "dsh-fixture-text")
        helper.call("click", {"appHandle": handle, "snapshotId": current["snapshotId"], "elementIndex": field["index"]})
        wait_state(state_path, lambda state: state.get("focusedEditor") and state.get("isActive"))
        observe()
        helper.call("pressKey", {"appHandle": handle, "key": "a", "modifiers": ["command"]})
        observe()
        helper.call("typeText", {"appHandle": handle, "text": TYPED_TEXT})
        wait_state(state_path, lambda state: state.get("text") == TYPED_TEXT)
        current = observe()
        if element(current, "dsh-fixture-text").get("value") != TYPED_TEXT:
            raise AssertionError("Keyboard Unicode input did not match AX readback")
        checks.append({"name": "focused-command-a-and-unicode-type-text", "status": "pass"})

        field = element(current, "dsh-fixture-text")
        if field.get("selectionWritable") is True:
            helper.call("selectText", {
                "appHandle": handle, "snapshotId": current["snapshotId"],
                "elementIndex": field["index"], "text": "🧪", "selectionType": "text",
            })
            start = len(TYPED_TEXT.split("🧪")[0].encode("utf-16-le")) // 2
            wait_state(state_path, lambda state: state.get("selectedRange") == [start, 2])
            current = observe()
            selected = element(current, "dsh-fixture-text")
            if selected.get("selectedText") != "🧪" or selected.get("selectedRange") != [start, 2]:
                raise AssertionError("Literal Unicode selection did not match application/AX readback")
            checks.append({"name": "literal-emoji-selection-utf16-range-and-readback", "status": "pass"})
        else:
            checks.append({"name": "literal-emoji-selection-utf16-range-and-readback", "status": "unsupported", "reason": "Fixture control does not advertise writable selection"})

        original_clipboard = clipboard_fingerprint(state_path)
        if original_clipboard is None:
            checks.append({"name": "plain-and-html-paste-clipboard-restoration", "status": "unsupported", "reason": "Clipboard cannot be fingerprinted within the private 16 MiB test limit; no paste was attempted"})
        else:
            for content_format, content, expected in [
                ("text", "Plain 粘贴 ✅", "Plain 粘贴 ✅"),
                # Use an encoding-independent fragment: AppKit HTML import
                # otherwise applies target-app-specific charset heuristics.
                ("html", "<b>HTML 粘贴 ✅</b>".encode("ascii", "xmlcharrefreplace").decode("ascii"), "HTML 粘贴 ✅"),
            ]:
                helper.call("activate", {"appHandle": handle})
                wait_state(state_path, lambda state: state.get("isActive"))
                current = observe()
                field = element(current, "dsh-fixture-text")
                helper.call("click", {"appHandle": handle, "snapshotId": current["snapshotId"], "elementIndex": field["index"]})
                observe()
                helper.call("pressKey", {"appHandle": handle, "key": "a", "modifiers": ["command"]})
                observe()
                helper.call("paste", {
                    "appHandle": handle, "text": content, "format": content_format,
                    "maxClipboardBytes": 16 * 1024 * 1024, "pasteReadTimeoutMs": 3000,
                    "maxElements": 400, "maxDepth": 25,
                })
                if clipboard_fingerprint(state_path) != original_clipboard:
                    raise AssertionError("Clipboard representations changed during paste test; contents were not logged")
                wait_state(state_path, lambda state: state.get("text") == expected)
                current = observe()
                if element(current, "dsh-fixture-text").get("value") != expected:
                    raise AssertionError("Pasted fixture value did not match AX readback")
                if clipboard_fingerprint(state_path) != original_clipboard:
                    raise AssertionError("Clipboard representations changed during paste test; contents were not logged")
                checks.append({"name": content_format + "-paste-readback-and-clipboard-restored", "status": "pass", **({"input_kind": "HTML fragment with numeric Unicode character references"} if content_format == "html" else {})})

        # Pointer scroll must produce an independently observed document offset.
        current = observe()
        screenshot = helper.call("screenshot", {"appHandle": handle, "windowId": window_id}, timeout=45)
        before_scroll = json.loads(state_path.read_text())
        rectangle = before_scroll["scrollRect"]
        scroll_x = rectangle[0] + rectangle[2] / 2
        scroll_y = screenshot["bounds"]["height"] - (rectangle[1] + rectangle[3] / 2)
        helper.call("scroll", {
            "appHandle": handle, "windowId": window_id, "snapshotId": current["snapshotId"],
            "x": scroll_x, "y": scroll_y, "deltaLinesX": 0, "deltaLinesY": -8,
        })
        wait_state(state_path, lambda state: state.get("scrollY", 0) > before_scroll["scrollY"])
        observe()
        checks.append({"name": "scroll-pointer-dispatch-observed-document-offset", "status": "pass"})
    finally:
        # Only the synthetic fixture state is retained for failed-test diagnosis.
        if state_path.is_file():
            (artifacts / "owned-fixture-final-state.json").write_bytes(state_path.read_bytes())
        # Never terminate an app discovered from inventory; only our own child.
        fixture.terminate()
        try:
            fixture.wait(timeout=5)
        except subprocess.TimeoutExpired:
            fixture.kill()
            fixture.wait(timeout=3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--helper", required=True, type=Path)
    parser.add_argument("--artifacts", required=True, type=Path, help="Private parent directory for synthetic artifacts")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--compile-only", action="store_true")
    mode.add_argument("--capabilities-only", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    args.artifacts.mkdir(parents=True, exist_ok=True)
    artifacts = args.artifacts / ("native-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8])
    artifacts.mkdir(mode=0o700)
    build_directory = args.artifacts / "fixture-build"
    build_directory.mkdir(mode=0o700, exist_ok=True)
    report = {
        "scope": "owned AppKit fixture against native JSONL helper; not Harness Host consent or model E2E",
        "status": "pending", "checks": [],
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    helper = None
    code = 1
    try:
        if sys.platform != "darwin":
            report.update(status="blocked", reason="macOS required")
            code = 77
        elif args.compile_only:
            build_fixture(build_directory)
            report.update(status="compile-only", reason="Fixture compiled; no UI launched and no native operation tested")
            report["checks"].append({"name": "swift-fixture-build", "status": "pass"})
            code = 0
        else:
            if not args.helper.is_file():
                raise RuntimeError("The selected helper executable is unavailable")
            helper = Helper(args.helper.resolve(), artifacts / "helper-stderr.log")
            capabilities = helper.call("getCapabilities", timeout=45)
            report["capabilities"] = {
                key: capabilities.get(key) for key in ["platform", "permissions", "sessionLocked", "coordinateSpace"]
            }
            permissions = capabilities.get("permissions", {})
            if not permissions.get("accessibility") or not permissions.get("screenRecording"):
                report.update(status="blocked", reason="Accessibility and Screen Recording must be granted by the user")
                code = 77
            elif capabilities.get("sessionLocked") is True:
                report.update(status="blocked", reason="Unlock macOS normally before native testing")
                code = 77
            elif args.capabilities_only:
                report.update(status="capabilities-only", reason="Permissions available; no fixture or desktop input tested")
                code = 0
            else:
                with tempfile.TemporaryDirectory(prefix="fixture-", dir=artifacts) as work:
                    executable = build_fixture(build_directory)
                    report["checks"].append({"name": "swift-fixture-build", "status": "pass"})
                    exercise(helper, executable, Path(work), artifacts, report["checks"])
                report["status"] = "pass-with-limitations" if any(check["status"] == "unsupported" for check in report["checks"]) else "pass"
                code = 0
    except Exception as error:
        report.update(status="fail", error_type=type(error).__name__, reason=str(error))
        code = 1
    finally:
        if helper is not None:
            helper.close()
        path = artifacts / "report.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        path.chmod(0o600)
    print(json.dumps({"status": report["status"], "checks": report["checks"], "reason": report.get("reason"), "report": str(artifacts / "report.json")}, ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())

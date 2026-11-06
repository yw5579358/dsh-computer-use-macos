import AppKit
import Foundation
import CryptoKit

// Fingerprint all clipboard representations without emitting their contents.
// Used only around an explicitly requested paste-restoration smoke test.
func clipboardFingerprint() throws -> String {
    var digest = SHA256()
    var total = 0
    for (index, item) in (NSPasteboard.general.pasteboardItems ?? []).enumerated() {
        digest.update(data: Data("item:\(index)\n".utf8))
        for type in item.types.sorted(by: { $0.rawValue < $1.rawValue }) {
            guard let bytes = item.data(forType: type) else { continue }
            total += bytes.count
            guard total <= 16 * 1024 * 1024 else {
                throw NSError(domain: "FixtureClipboard", code: 1)
            }
            digest.update(data: Data("\(type.rawValue):\(bytes.count)\n".utf8))
            digest.update(data: bytes)
        }
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

// An owned synthetic application for integration tests. No personal document,
// credential, clipboard, application inventory, or account data is consulted.
final class FlippedDocument: NSView {
    override var isFlipped: Bool { true }
}

final class FixtureDelegate: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    private var window: NSWindow!
    private var textField: NSTextField!
    private var counterLabel: NSTextField!
    private var scrollView: NSScrollView!
    private var timer: Timer?
    private var counter = 0
    private var lastState: Data?
    private var clipboardRequestID: String?
    private let stateURL: URL

    init(stateURL: URL) {
        self.stateURL = stateURL
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu(title: "Fixture")
        applicationMenu.addItem(withTitle: "Quit Fixture", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu
        menu.addItem(applicationItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApplication.shared.mainMenu = menu
        window = NSWindow(
            contentRect: NSRect(x: 160, y: 160, width: 620, height: 420),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "DSH Native Test Fixture"
        window.setAccessibilityIdentifier("dsh-fixture-window")
        window.isReleasedWhenClosed = false
        let content = window.contentView!

        let button = NSButton(
            title: "Increment fixture counter",
            target: self,
            action: #selector(incrementCounter)
        )
        button.frame = NSRect(x: 24, y: 346, width: 240, height: 34)
        button.bezelStyle = .rounded
        button.setAccessibilityIdentifier("dsh-fixture-increment")
        content.addSubview(button)

        counterLabel = NSTextField(labelWithString: "Counter: 0")
        counterLabel.frame = NSRect(x: 290, y: 350, width: 280, height: 24)
        counterLabel.setAccessibilityIdentifier("dsh-fixture-counter-label")
        content.addSubview(counterLabel)

        let label = NSTextField(labelWithString: "Synthetic Unicode input")
        label.frame = NSRect(x: 24, y: 310, width: 500, height: 22)
        content.addSubview(label)

        textField = NSTextField(string: "Fixture initial text")
        textField.frame = NSRect(x: 24, y: 270, width: 570, height: 30)
        textField.delegate = self
        textField.allowsEditingTextAttributes = true
        textField.setAccessibilityIdentifier("dsh-fixture-text")
        textField.setAccessibilityLabel("Fixture Unicode text")
        content.addSubview(textField)

        scrollView = NSScrollView(frame: NSRect(x: 24, y: 28, width: 570, height: 218))
        scrollView.borderType = .bezelBorder
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = false
        scrollView.setAccessibilityIdentifier("dsh-fixture-scroll")
        let document = FlippedDocument(frame: NSRect(x: 0, y: 0, width: 540, height: 1500))
        for index in 0..<35 {
            let row = NSTextField(labelWithString: "Synthetic scroll row \(index + 1)")
            row.frame = NSRect(x: 15, y: 15 + index * 40, width: 490, height: 26)
            document.addSubview(row)
        }
        scrollView.documentView = document
        content.addSubview(scrollView)

        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        publishState()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.publishState()
        }
    }

    @objc private func incrementCounter() {
        counter += 1
        counterLabel.stringValue = "Counter: \(counter)"
        publishState()
    }

    func controlTextDidChange(_ notification: Notification) {
        publishState()
    }

    private func publishState() {
        guard textField != nil, scrollView != nil else { return }
        processClipboardRequest()
        let currentText = textField.currentEditor()?.string ?? textField.stringValue
        let selection = (textField.currentEditor() as? NSTextView)?.selectedRange()
        let scrollRect = scrollView.convert(scrollView.bounds, to: nil)
        let state: [String: Any] = [
            "ready": true,
            "pid": ProcessInfo.processInfo.processIdentifier,
            "counter": counter,
            "text": currentText,
            "scrollY": scrollView.contentView.bounds.origin.y,
            "scrollRect": [scrollRect.origin.x, scrollRect.origin.y, scrollRect.width, scrollRect.height],
            "selectedRange": selection.map { [$0.location, $0.length] } ?? [],
            "focusedEditor": textField.currentEditor() != nil,
            "isActive": NSApplication.shared.isActive,
            "windowTitle": window.title
        ]
        guard let bytes = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]),
              bytes != lastState else { return }
        do {
            try bytes.write(to: stateURL, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
            lastState = bytes
        } catch {
            fputs("Fixture could not persist synthetic state.\n", stderr)
            NSApplication.shared.terminate(nil)
        }
    }

    private func processClipboardRequest() {
        let directory = stateURL.deletingLastPathComponent()
        let requestURL = directory.appendingPathComponent("clipboard-request.json")
        guard let bytes = try? Data(contentsOf: requestURL), bytes.count < 4096,
              let request = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: String],
              request["command"] == "fingerprint", let identifier = request["id"],
              identifier != clipboardRequestID else { return }
        clipboardRequestID = identifier
        var response: [String: Any] = ["id": identifier]
        do { response["digest"] = try clipboardFingerprint() }
        catch { response["unavailable"] = true }
        if let result = try? JSONSerialization.data(withJSONObject: response) {
            let responseURL = directory.appendingPathComponent("clipboard-response.json")
            try? result.write(to: responseURL, options: [.atomic])
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: responseURL.path)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
    }
}

guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--state" else {
    fputs("Usage: native-fixture --state <private-json-path>\n", stderr)
    exit(64)
}
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = FixtureDelegate(stateURL: URL(fileURLWithPath: CommandLine.arguments[2]))
application.delegate = delegate
application.run()

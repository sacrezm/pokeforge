import AppKit
import XCTest
@testable import PokeTokenBar

@MainActor
final class StablePopoverAnchorTests: XCTestCase {
    func testOpenPopoverDoesNotFollowAStatusItemThatIsRehidden() throws {
        let sourceWindow = NSWindow(
            contentRect: NSRect(x: 900, y: 700, width: 80, height: 24),
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        let sourceView = NSView(frame: sourceWindow.contentView!.bounds)
        sourceWindow.contentView = sourceView
        sourceWindow.orderFrontRegardless()
        defer { sourceWindow.orderOut(nil) }

        let content = NSViewController()
        content.view = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 240))
        let popover = NSPopover()
        popover.contentViewController = content
        let anchor = StablePopoverAnchor()
        anchor.show(popover, relativeTo: sourceView, preferredEdge: .minY)
        drainMainRunLoop()
        defer {
            popover.performClose(nil)
            anchor.clear()
        }

        let popoverWindow = try XCTUnwrap(content.view.window)
        let before = popoverWindow.frame.origin
        sourceWindow.setFrameOrigin(NSPoint(x: 100, y: 700))
        drainMainRunLoop()
        let after = popoverWindow.frame.origin

        XCTAssertEqual(after.x, before.x, accuracy: 1,
                       "Ice may move the status item, but an open activity must stay put")
        XCTAssertEqual(after.y, before.y, accuracy: 1)
    }

    private func drainMainRunLoop(_ seconds: TimeInterval = 0.2) {
        RunLoop.main.run(until: Date().addingTimeInterval(seconds))
    }
}

import AppKit

/// Keeps an open popover attached to the screen location where its status item
/// was clicked. Menu-bar managers may move the real status-item window while
/// rehiding it; anchoring directly to that button makes AppKit move the open
/// popover with it.
@MainActor
final class StablePopoverAnchor {
    private var window: NSPanel?

    func show(_ popover: NSPopover, relativeTo view: NSView, preferredEdge: NSRectEdge) {
        clear()

        guard let sourceWindow = view.window else {
            // The status button normally always owns a window. Keep the native
            // behavior as a safe fallback if AppKit has not attached it yet.
            popover.show(relativeTo: view.bounds, of: view, preferredEdge: preferredEdge)
            return
        }

        let windowRect = view.convert(view.bounds, to: nil)
        let screenRect = sourceWindow.convertToScreen(windowRect)
        let anchorWindow = NSPanel(
            contentRect: screenRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        anchorWindow.isOpaque = false
        anchorWindow.backgroundColor = .clear
        anchorWindow.hasShadow = false
        anchorWindow.ignoresMouseEvents = true
        anchorWindow.level = .statusBar
        anchorWindow.collectionBehavior = [.fullScreenAuxiliary, .ignoresCycle]
        anchorWindow.isReleasedWhenClosed = false

        let anchorView = NSView(frame: NSRect(origin: .zero, size: screenRect.size))
        anchorWindow.contentView = anchorView
        anchorWindow.orderFrontRegardless()
        window = anchorWindow

        popover.show(relativeTo: anchorView.bounds, of: anchorView, preferredEdge: preferredEdge)
        if !popover.isShown { clear() }
    }

    func clear() {
        window?.orderOut(nil)
        window?.contentView = nil
        window = nil
    }
}

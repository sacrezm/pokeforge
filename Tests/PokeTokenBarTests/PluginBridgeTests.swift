import XCTest
@testable import PokeTokenBar

@MainActor
final class PluginBridgeTests: XCTestCase {
    private var directory: URL!
    private var companion: CompanionStore!
    private var bridge: PluginBridge!
    override func setUp() async throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("pb-" + UUID().uuidString.prefix(8))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var state = CompanionState()
        state.language = .en
        state.usedSinceInstall = 50_000_000
        state.dex = [DexEntry(id: "owned", baseID: 25, finalID: 25, chainOrder: [25], rarity: .common, caughtAt: nil)]
        state.inventory[ItemKind.rareCandy.rawValue] = 3
        state.inventory[ItemKind.mint.rawValue] = 1
        let url = directory.appendingPathComponent("companion-state.json")
        try JSONEncoder().encode(state).write(to: url)
        let line = EvoLine(baseID: 25, tree: EvoNode(speciesID: 25, children: []), rarity: .common, names: [25: ["en": "Pikachu"]])
        let defaults = UserDefaults(suiteName: "plugin-tests-" + UUID().uuidString)!
        defaults.set(1.0, forKey: "shopDifficulty")
        companion = CompanionStore(provider: StubProvider(value: line), fileURL: url, defaults: defaults)
        let usage = UsageStore(providers: [], autoRefresh: false, defaults: defaults)
        bridge = PluginBridge(companion: companion, usage: usage, directory: directory, sandbox: true)
    }
    override func tearDown() async throws {
        bridge.stop()
        try? FileManager.default.removeItem(at: directory)
    }
    private func stateData() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(companion.state)
    }
    private func request(_ action: String, _ value: String = "", nonce: String = UUID().uuidString,
                         expires: Double = Date().timeIntervalSince1970 + 10, price: Int? = nil) throws -> Data {
        var object: [String: Any] = ["action": action, "value": value, "nonce": nonce, "expires": expires]
        if let price { object["expectedPrice"] = price }
        return try JSONSerialization.data(withJSONObject: object)
    }
    private func result(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: bridge.handle(data)) as? [String: Any])
    }
    func testLiveSnapshotExcludesTransferredPokemonAndReportsMissingUsage() throws {
        var snapshot = bridge.snapshot()
        XCTAssertEqual((snapshot["collection"] as? [[String: Any]])?.count, 1)
        let usage = try XCTUnwrap(snapshot["usage"] as? [String: Any])
        XCTAssertTrue(usage["updatedAt"] is NSNull)
        companion.setTrainingExcludedIDs(["owned"])
        snapshot = bridge.snapshot()
        XCTAssertEqual((snapshot["collection"] as? [[String: Any]])?.count, 0)
        XCTAssertEqual(try result(request("target", "owned"))["error"] as? String, "unavailable")
    }
    func testMutationIsPersistedAndDuplicateNonceNeverSpendsTwice() throws {
        XCTAssertNil(try result(request("mode", "balanced"))["error"])
        XCTAssertNil(try result(request("focus", "attack"))["error"])
        let candy = try request("candy", "owned")
        let first = bridge.handle(candy)
        XCTAssertEqual(bridge.handle(candy), first)
        XCTAssertEqual(companion.rareCandyCount, 2)
        XCTAssertEqual(companion.trainingPokemon?.progression.level, 6)
        let saved = try JSONDecoder().decode(CompanionState.self, from: Data(contentsOf: directory.appendingPathComponent("companion-state.json")))
        XCTAssertEqual(saved.trainingMode, .balanced)
        XCTAssertEqual(saved.trainingFocus, .attack)
        XCTAssertEqual(saved.inventory[ItemKind.rareCandy.rawValue], 2)
    }
    func testInvalidExpiredAndStalePurchaseRequestsDoNotChangeState() throws {
        let before = try stateData()
        for data in [try request("destroy"), try request("mode", "unknown"), try request("focus", "unknown"),
                     try request("candy", "owned", expires: 0), try request("candy", "owned", nonce: "bad"),
                     try request("buyItem", "rareCandy", price: 1), try request("buyBall", "pokeBall", price: 1)] {
            XCTAssertNotNil(try result(data)["error"])
        }
        XCTAssertEqual(try stateData(), before)
        XCTAssertEqual(try result(request("candy", "another"))["error"] as? String, "unavailable")
    }
    func testPurchasesAndQueueUseTheNativePricesAndInventory() throws {
        let before = companion.availableTokens
        XCTAssertNil(try result(request("buyItem", "rareCandy", price: companion.price(of: .rareCandy)))["error"])
        XCTAssertEqual(companion.rareCandyCount, 4)
        XCTAssertEqual(companion.availableTokens, before - companion.price(of: .rareCandy)!)
        XCTAssertNil(try result(request("buyBall", "quickBall", price: CatchingBall.quickBall.price))["error"])
        XCTAssertNil(try result(request("queueBall", "quickBall"))["error"])
        XCTAssertEqual(companion.eggBall, .quickBall)
        XCTAssertEqual(companion.ballCount(.quickBall), 0)
    }
    func testFailedSaveRollsBackEveryNewlyExposedMutator() throws {
        let url = directory.appendingPathComponent("companion-state.json")
        try FileManager.default.removeItem(at: url)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        let before = try stateData()
        for data in [try request("mode", "balanced"), try request("focus", "attack"), try request("target", "owned"),
                     try request("buyItem", "rareCandy", price: companion.price(of: .rareCandy)), try request("candy", "owned")] {
            XCTAssertEqual(try result(data)["error"] as? String, "save_failed")
            XCTAssertEqual(try stateData(), before)
        }
    }
    func testMintSaveFailureRestoresNatureAndStockWithoutSuccessFeedback() throws {
        let url = directory.appendingPathComponent("companion-state.json")
        var state = companion.state
        state.active = MonState(baseID: 25, pathIDs: [25], stageIndex: 0, usedAtStage: 0,
                                rarity: .common, totalForms: 1, nature: .adamant)
        try JSONEncoder().encode(state).write(to: url)
        companion = CompanionStore(provider: StubProvider(value: EvoLine(baseID: 25,
            tree: EvoNode(speciesID: 25, children: []), rarity: .common, names: [:])), fileURL: url)
        bridge = PluginBridge(companion: companion, directory: directory)
        let before = try stateData()
        try FileManager.default.removeItem(at: url)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        XCTAssertEqual(try result(request("mint", state.active!.id))["error"] as? String, "save_failed")
        XCTAssertEqual(try stateData(), before)
        XCTAssertNil(companion.mintFeedbackNature)
    }
    func testSocketIsPrivateAndSecondInstanceCannotStealIt() async throws {
        try bridge.start()
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("plugin.sock").path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let other = PluginBridge(companion: companion, usage: UsageStore(providers: [], autoRefresh: false), directory: directory)
        XCTAssertThrowsError(try other.start())
        // Let the listener drain the disconnected probe: it must not reply to a closed peer.
        try await Task.sleep(for: .milliseconds(100))
    }
    func testRealSocketAcceptsDelayedAndFragmentedRequests() async throws {
        try bridge.start()
        let path = directory.appendingPathComponent("plugin.sock").path
        let request = try request("snapshot") + Data([10])
        let response = try await Task.detached { () throws -> Data in
            let fd = socket(AF_UNIX, SOCK_STREAM, 0)
            defer { close(fd) }
            var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
            address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
            withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: Array(path.utf8) + [0]) }
            let connected = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
            guard connected == 0 else { throw POSIXError(.ECONNREFUSED) }
            var timeout = timeval(tv_sec: 3, tv_usec: 0)
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
            var noSignal: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
            usleep(50000)
            for part in [request.prefix(10), request.dropFirst(10)] {
                let sent = part.withUnsafeBytes { send(fd, $0.baseAddress, $0.count, 0) }
                guard sent == part.count else { throw POSIXError(.EPIPE) }
                usleep(20000)
            }
            var output = Data(); var bytes = [UInt8](repeating: 0, count: 4096)
            while !output.contains(10) {
                let count = recv(fd, &bytes, bytes.count, 0)
                guard count > 0 else { throw POSIXError(.ETIMEDOUT) }
                output.append(contentsOf: bytes.prefix(count))
            }
            return output
        }.value
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
        XCTAssertEqual(decoded["schemaVersion"] as? Int, 1)
        XCTAssertEqual((decoded["collection"] as? [[String: Any]])?.count, 1)
    }

}

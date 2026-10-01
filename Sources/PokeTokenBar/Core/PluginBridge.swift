import AppKit
import Darwin

/// Same-user IPC only. The native stores remain the sole writers of game state.
@MainActor
final class PluginBridge {
    private let companion: CompanionStore
    private let usage: UsageStore?
    private let trading: TradingFeature?
    private let openNative: (String) -> Void
    private var source: DispatchSourceRead?
    private var idleTimer: Timer?
    private var lastRequestAt = Date()
    private var clients = 0
    private var replies: [String: (expires: Double, data: Data)] = [:]
    private let socketURL: URL
    let sandbox: Bool

    init(companion: CompanionStore, usage: UsageStore? = nil, trading: TradingFeature? = nil,
         directory: URL = AppStatePaths.directory(), sandbox: Bool = false,
         openNative: @escaping (String) -> Void = { _ in }) {
        self.companion = companion; self.usage = usage; self.trading = trading
        self.openNative = openNative; self.sandbox = sandbox
        socketURL = directory.appendingPathComponent("plugin.sock")
    }

    func start() throws {
        let path = socketURL.path
        guard path.utf8.count < 104 else { throw POSIXError(.ENAMETOOLONG) }
        try FileManager.default.createDirectory(at: socketURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        var old = stat()
        if lstat(path, &old) == 0 {
            guard old.st_uid == geteuid(), old.st_mode & S_IFMT == S_IFSOCK else { throw POSIXError(.EACCES) }
            // Never unlink another running bridge. A refused connection denotes a stale socket.
            let probe = socket(AF_UNIX, SOCK_STREAM, 0)
            defer { close(probe) }
            var address = Self.address(path)
            let active = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(probe, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
            guard active != 0, errno == ECONNREFUSED else { throw POSIXError(.EADDRINUSE) }
            guard unlink(path) == 0 else { throw POSIXError(.EACCES) }
        }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw POSIXError(.EIO) }
        var noSignal: Int32 = 1
        guard setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0 else { close(fd); throw POSIXError(.EIO) }
        var address = Self.address(path)
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard bound == 0, chmod(path, 0o600) == 0, listen(fd, 8) == 0 else { close(fd); throw POSIXError(.EIO) }
        _ = fcntl(fd, F_SETFL, O_NONBLOCK)
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .main)
        source.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.acceptClient(fd) }
        }
        source.setCancelHandler { close(fd); unlink(path) }
        self.source = source
        source.resume()
        if AppEnv.isPluginEngine {
            idleTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, Date().timeIntervalSince(self.lastRequestAt) > 300,
                          !NSApp.windows.contains(where: { $0.isVisible }) else { return }
                    NSApp.terminate(nil)
                }
            }
        }
    }

    func stop() { idleTimer?.invalidate(); idleTimer = nil; source?.cancel(); source = nil }

    private static func address(_ path: String) -> sockaddr_un {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &address.sun_path) { bytes in
            bytes.copyBytes(from: Array(path.utf8) + [0])
        }
        return address
    }

    private func acceptClient(_ listener: Int32) {
        let fd = accept(listener, nil, nil)
        guard fd >= 0 else { return }
        var uid: uid_t = 0; var gid: gid_t = 0
        guard clients < 8, getpeereid(fd, &uid, &gid) == 0, uid == geteuid() else { close(fd); return }
        clients += 1
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) & ~O_NONBLOCK)
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var noSignal: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let request = Self.receive(fd)
            Task { @MainActor [weak self] in
                guard let self else { close(fd); return }
                guard let request else { close(fd); self.clients -= 1; return }
                let reply = self.handle(request)
                DispatchQueue.global(qos: .utility).async {
                    let bytes = Array(reply + Data([10]))
                    var sent = 0
                    while sent < bytes.count {
                        let count = bytes.withUnsafeBytes { Darwin.send(fd, $0.baseAddress!.advanced(by: sent), bytes.count - sent, 0) }
                        if count <= 0 { break }; sent += count
                    }
                    close(fd)
                    Task { @MainActor [weak self] in self?.clients -= 1 }
                }
            }
        }
    }

    nonisolated private static func receive(_ fd: Int32) -> Data? {
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(5)
        while data.count < 16384 && Date() < deadline {
            let count = recv(fd, &buffer, buffer.count, 0)
            guard count > 0 else { return nil }
            data.append(contentsOf: buffer.prefix(count))
            if let newline = data.firstIndex(of: 10) { return Data(data[..<newline]) }
        }
        return nil
    }

    static func encode(_ object: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    }

    func handle(_ data: Data) -> Data {
        guard let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(request.keys).isSubset(of: ["action", "value", "nonce", "expires", "expectedPrice"]),
              let action = request["action"] as? String,
              let nonce = request["nonce"] as? String, UUID(uuidString: nonce) != nil,
              let expires = request["expires"] as? Double,
              expires > Date().timeIntervalSince1970, expires <= Date().timeIntervalSince1970 + 30 else {
            return Self.encode(["error": "invalid_request"])
        }
        replies = replies.filter { $0.value.expires > Date().timeIntervalSince1970 }
        lastRequestAt = Date()
        if let cached = replies[nonce] { return cached.data }
        guard action == "snapshot" || replies.count < 256 else { return Self.encode(["error": "busy"]) }
        let value = request["value"] as? String ?? ""
        var error: String?
        var applied = true
        switch action {
        case "snapshot": break
        case "refresh": Task { await usage?.refresh() }
        case "mode":
            if let mode = TrainingMode(rawValue: value) { applied = companion.setTrainingMode(mode) }
            else { error = "invalid_request" }
        case "focus":
            if let focus = PokemonStat(rawValue: value) { applied = companion.setTrainingFocus(focus) }
            else { error = "invalid_request" }
        case "target": applied = companion.setTrainingTarget(value)
        case "candy":
            applied = companion.trainingTargetID == value && companion.useTrainingCandy()
        case "mint":
            applied = companion.state.active?.id == value && companion.useMint() != nil
        case "buyItem":
            if let item = ItemKind(rawValue: value), let price = request["expectedPrice"] as? Int,
               price == companion.price(of: item) { applied = companion.buy(item) }
            else { error = "price_changed" }
        case "buyBall":
            if let ball = CatchingBall(rawValue: value), request["expectedPrice"] as? Int == ball.price { applied = companion.buyBall(ball) }
            else { error = "price_changed" }
        case "queueBall":
            if let ball = CatchingBall(rawValue: value) { applied = companion.queueBall(ball) }
            else { error = "invalid_request" }
        case "openNative":
            if ["trade", "settings"].contains(value) { openNative(value) }
            else { error = "invalid_request" }
        default: error = "invalid_request"
        }
        if !applied { error = companion.persistenceError == nil ? "unavailable" : "save_failed" }
        var object = snapshot()
        if let error { object["error"] = error }
        let reply = Self.encode(object)
        if action != "snapshot" {
            // Requests expire before deduplication entries are removed. No automatic retry after restart.
            replies[nonce] = (expires, reply)
        }
        return reply
    }

    func snapshot() -> [String: Any] {
        let null = NSNull()
        let entries = companion.dexEntries
        let owned = OwnedCollection.pokemon(entries: entries,
            activeID: entries.first(where: companion.isActiveDexEntry)?.id,
            held: (trading?.heldInventory ?? []).map(companion.trainedVersion),
            transferredIDs: companion.trainingExcludedIDs.union(trading?.transferredIDs ?? []), language: .en)
        let candidates = Set(companion.trainingCandidates.map(\.id))
        let collection: [[String: Any]] = owned.map { pokemon in
            let p = pokemon.progression
            return ["id": pokemon.id, "speciesID": pokemon.speciesID, "name": pokemon.name,
                "shiny": pokemon.isShiny, "raising": pokemon.isRaising, "rarity": pokemon.rarity.rawValue,
                "nature": pokemon.nature?.rawValue as Any? ?? null,
                "trainer": pokemon.originalTrainer as Any? ?? null,
                "recordedAt": pokemon.recordedAt?.timeIntervalSince1970 as Any? ?? null,
                "level": p.level, "xp": p.totalExperience, "nextXP": p.experienceToNextLevel as Any? ?? null,
                "evs": Dictionary(uniqueKeysWithValues: PokemonStat.allCases.map { ($0.rawValue, p.ev(for: $0)) }),
                "trainable": candidates.contains(pokemon.id)]
        }
        let providers: [[String: Any]] = (usage?.snapshots ?? []).map { p in
            ["id": p.providerID, "name": p.displayName, "today": p.today?.totalTokens as Any? ?? null,
             "week": p.weekTotal?.totalTokens as Any? ?? null, "month": p.monthTotal?.totalTokens as Any? ?? null,
             "cost": p.reportsCost && p.today?.costCoverage.hasKnown == true ? p.today?.totalCost as Any? ?? null : null,
             "costEstimated": p.today?.costCoverage.estimated ?? false,
             "costPartial": p.today?.costCoverage.unknown ?? true,
             "updatedAt": p.fetchedAt.timeIntervalSince1970,
             "daily": (p.monthDaily ?? []).map { ["date": $0.date, "tokens": $0.totalTokens] as [String: Any] }]
        }
        var limits: [[String: Any]] = []
        for bucket in usage?.codexLimits?.visibleSnapshots ?? [] {
            for window in [bucket.primary, bucket.secondary].compactMap({ $0 }) {
                limits.append(["provider": bucket.bucketDisplayName, "used": window.usedPercent,
                    "minutes": window.windowDurationMins as Any? ?? null, "reset": window.resetsAt as Any? ?? null])
            }
        }
        for (minutes, window) in [(300, usage?.limits?.fiveHour), (10080, usage?.limits?.sevenDay)] {
            if let used = window?.utilization {
                limits.append(["provider": "Claude", "used": used, "minutes": minutes,
                    "reset": window?.resetDate?.timeIntervalSince1970 as Any? ?? null])
            }
        }
        let items: [[String: Any]] = ItemKind.allCases.map { item in
            ["id": item.rawValue, "price": companion.price(of: item) as Any? ?? null,
             "count": companion.itemCount(item), "canBuy": companion.canBuy(item), "passive": item.isPassive]
        }
        return ["schemaVersion": 1, "sandbox": sandbox, "headless": AppEnv.isPluginEngine,
            "enginePID": ProcessInfo.processInfo.processIdentifier,
            "updatedAt": Date().timeIntervalSince1970,
            "saveError": companion.persistenceError != nil, "collection": collection,
            "companion": ["egg": companion.isEgg, "name": companion.displayName,
                "speciesID": companion.currentSpeciesID as Any? ?? null, "shiny": companion.currentIsShiny,
                "progress": companion.isEgg ? companion.eggProgress : companion.progress,
                "remaining": companion.isEgg ? companion.eggTokensToHatch : companion.tokensToNext,
                "finalStage": companion.isFinalStage, "hatching": companion.isHatching,
                "activeID": companion.state.active?.id as Any? ?? null],
            "training": ["mode": companion.trainingMode.rawValue, "focus": companion.trainingFocus.rawValue,
                "target": companion.trainingTargetID as Any? ?? null, "canCandy": companion.canUseTrainingCandy,
                "canMint": companion.canUseMint],
            "wallet": companion.availableTokens, "items": items,
            "balls": CatchingBall.allCases.map { ["id": $0.rawValue, "price": $0.price, "count": companion.ballCount($0)] as [String: Any] },
            "queuedBall": companion.queuedBall?.rawValue as Any? ?? null,
            "eggBall": companion.eggBall?.rawValue as Any? ?? null,
            "usage": ["providers": providers, "limits": limits, "stale": usage?.isStale ?? false,
                "refreshing": usage?.isRefreshing ?? false, "updatedAt": usage?.lastUpdated?.timeIntervalSince1970 as Any? ?? null]]
    }
}

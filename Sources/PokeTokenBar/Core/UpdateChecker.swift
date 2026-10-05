import AppKit
import Observation

/// GitHub discovery drives the persistent in-app banner; Sparkle owns installation.
@MainActor
@Observable
final class UpdateChecker {
    struct Available: Equatable { let version: String; let url: String }
    struct LatestRelease: Equatable, Sendable { let tag: String; let url: String }

    /// What Settings should say after a check. A skipped release is not "up to date".
    enum SettingsNotice: Equatable {
        case offer(String)
        case skipped(String)
        case current
    }

    private(set) var available: Available?
    /// Newer release the user chose to skip. Hidden from the banner, still shown in Settings.
    private(set) var skipped: Available?

    let currentVersion: String
    nonisolated static let repository = "sacrezm/pokeforge"
    private let clock: () -> Date
    private let session: URLSession
    private let defaults: UserDefaults
    private let fetchLatest: (() async -> LatestRelease?)?
    private let installUpdate: (() -> Void)?
    @ObservationIgnored private var installer: SparkleInstaller?
    @ObservationIgnored private var automaticTask: Task<Void, Never>?
    private(set) var checkFailed = false
    private(set) var noPublishedRelease = false
    private let skippedKey = "tradingFork.skippedUpdateVersion"
    private var lastChecked: Date?
    private var isChecking = false

    init(currentVersion: String? = nil, clock: @escaping () -> Date = Date.init,
         session: URLSession = .shared, defaults: UserDefaults = .standard,
         installUpdate: (() -> Void)? = nil,
         fetchLatest: (() async -> LatestRelease?)? = nil) {
        self.currentVersion = currentVersion
            ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
        self.clock = clock
        self.session = session
        self.defaults = defaults
        self.installUpdate = installUpdate
        self.fetchLatest = fetchLatest
    }

    convenience init(currentVersion: String? = nil, clock: @escaping () -> Date = Date.init,
                     defaults: UserDefaults = .standard,
                     fetchLatest: @escaping () async -> LatestRelease?) {
        self.init(currentVersion: currentVersion, clock: clock, session: .shared,
                  defaults: defaults, installUpdate: nil, fetchLatest: fetchLatest)
    }

    /// App-owned, so closing the popover does not stop discovery. No silent installs.
    func startAutomaticChecks(interval: TimeInterval = 3600) {
        guard automaticTask == nil, interval.isFinite, interval > 0 else { return }
        automaticTask = Task { [weak self] in
            while !Task.isCancelled {
                guard self != nil else { return }
                await self?.check(minInterval: interval)
                do { try await Task.sleep(for: .seconds(interval)) }
                catch { return }
            }
        }
    }

    func stopAutomaticChecks() {
        automaticTask?.cancel()
        automaticTask = nil
    }

    var settingsNotice: SettingsNotice {
        if let available { return .offer(available.version) }
        if let skipped { return .skipped(skipped.version) }
        return .current
    }

    /// Release Settings can install. A skip hides the banner; it does not throw the URL away.
    var updateTarget: Available? { available ?? skipped }

    /// 최신 릴리스 조회. 스킵한 버전은 배너(`available`)에 안 올리고 Settings(`skipped`)에만 남긴다.
    /// minInterval 보다 자주 호출되면 무시(레이트리밋 보호).
    func check(minInterval: TimeInterval = 1800) async {
        guard !isChecking else { return }
        if let last = lastChecked, clock().timeIntervalSince(last) < minInterval { return }
        isChecking = true
        defer { isChecking = false }
        checkFailed = false
        noPublishedRelease = false
        if let fetchLatest {
            guard let release = await fetchLatest(),
                  Self.isTrustedReleaseURL(release.url),
                  let version = Self.normalizedReleaseVersion(release.tag) else {
                checkFailed = true
                return
            }
            lastChecked = clock()
            consider(latest: version, url: release.url)
            return
        }
        guard let url = URL(string: "https://api.github.com/repos/\(Self.repository)/releases/latest") else { return }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("PokeForge", forHTTPHeaderField: "User-Agent")
        guard let (data, resp) = try? await session.data(for: req) else { checkFailed = true; return }
        if (resp as? HTTPURLResponse)?.statusCode == 404 {
            available = nil
            noPublishedRelease = true
            return
        }
        guard
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["draft"] as? Bool == false, json["prerelease"] as? Bool == false,
              let tag = json["tag_name"] as? String,
              let html = json["html_url"] as? String,
              // Only accept release metadata belonging to this fork.
              let htmlURL = URL(string: html),
              htmlURL.absoluteString == "https://github.com/\(Self.repository)/releases/tag/\(tag)"
        else { checkFailed = true; return }
        lastChecked = clock()
        consider(latest: tag, url: html)
        if minInterval == 0, let skipped {
            available = skipped
            self.skipped = nil
        }
    }

    nonisolated static func isTrustedReleaseURL(_ string: String) -> Bool {
        guard let url = URL(string: string), url.scheme == "https", url.host == "github.com" else { return false }
        return url.path.hasPrefix("/\(repository)/releases/tag/")
    }

    nonisolated static func normalizedReleaseVersion(_ tag: String) -> String? {
        var version = Substring(tag.trimmingCharacters(in: .whitespacesAndNewlines))
        if version.first == "v" || version.first == "V" { version = version.dropFirst() }
        let parts = version.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts.allSatisfy({ !$0.isEmpty && $0.count <= 9 && $0.allSatisfy { $0.isASCII && $0.isNumber } })
        else { return nil }
        return parts.map { String(Int($0)!) }.joined(separator: ".")
    }

    /// Apply one fetched release while retaining a skipped release for Settings.
    func consider(latest tag: String, url: String) {
        let latest = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        let parts = latest.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({
            !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) && Int($0) != nil
        }) else { checkFailed = true; return }
        let skippedVersion = defaults.string(forKey: skippedKey)
        guard Self.isNewer(latest, than: currentVersion) else {
            available = nil
            skipped = nil
            return
        }
        let release = Available(version: latest, url: url)
        if latest == skippedVersion {
            available = nil
            skipped = release
        } else {
            available = release
            skipped = nil
        }
    }

    /// Hide the banner for this version. Settings can still see it and install it.
    func skipCurrent() {
        guard let release = available else { return }
        defaults.set(release.version, forKey: skippedKey)
        skipped = release
        available = nil
    }

    /// Undo a skip so the banner can show the same release again.
    func showSkippedAgain() {
        defaults.removeObject(forKey: skippedKey)
        if let release = skipped {
            available = release
            skipped = nil
        }
    }

    /// Download, signature verification, installation and relaunch use Sparkle's native UI.
    func applyUpdate() {
        guard updateTarget != nil else { return }
        if let installUpdate { installUpdate(); return }
        if installer == nil { installer = SparkleInstaller() }
        installer?.install()
    }

    // MARK: 버전 비교

    /// a 가 b 보다 높은 semver 인가. ("2.0.10" > "2.0.9" 등 숫자 비교)
    nonisolated static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0) ?? 0 }
        let pb = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }

}

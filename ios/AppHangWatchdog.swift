import Foundation
import Darwin

final class AppHangWatchdog {
  private let thresholdMs: Int
  private let pollIntervalMs: Int
  private let onHangDetected: (Int, String) -> Void
  private let queue: DispatchQueue
  private var lastMainHeartbeatNs: UInt64 = 0
  private var lastJsHeartbeatNs: UInt64 = 0
  private var jsTracked: Bool = false
  private var running = false
  private var inHangMain = false
  private var inHangJs = false

  init(
    label: String,
    thresholdMs: Int,
    pollIntervalMs: Int = 50,
    onHangDetected: @escaping (Int, String) -> Void
  ) {
    self.thresholdMs = thresholdMs
    self.pollIntervalMs = max(10, min(pollIntervalMs, thresholdMs))
    self.onHangDetected = onHangDetected
    self.queue = DispatchQueue(
      label: "io.base14.scout-react.watchdog.\(label)",
      qos: .userInitiated
    )
  }

  func start() {
    lastMainHeartbeatNs = Self.nowNs()
    lastJsHeartbeatNs = Self.nowNs()
    running = true
    queue.async { [weak self] in self?.loop() }
  }

  func stop() { running = false }

  func notifyJsAlive() {
    lastJsHeartbeatNs = Self.nowNs()
    jsTracked = true
  }

  deinit { stop() }

  private func loop() {
    while running {
      DispatchQueue.main.async { [weak self] in
        self?.lastMainHeartbeatNs = Self.nowNs()
      }
      Thread.sleep(forTimeInterval: Double(pollIntervalMs) / 1000.0)
      guard running else { return }
      let now = Self.nowNs()
      let elapsedMainMs = Int((now &- lastMainHeartbeatNs) / 1_000_000)
      if elapsedMainMs >= thresholdMs {
        if !inHangMain {
          inHangMain = true
          onHangDetected(elapsedMainMs, "main")
        }
      } else if inHangMain {
        inHangMain = false
      }
      if jsTracked {
        let elapsedJsMs = Int((now &- lastJsHeartbeatNs) / 1_000_000)
        if elapsedJsMs >= thresholdMs {
          if !inHangJs {
            inHangJs = true
            onHangDetected(elapsedJsMs, "js")
          }
        } else if inHangJs && elapsedJsMs < pollIntervalMs * 4 {
          inHangJs = false
        }
      }
    }
  }

  private static func nowNs() -> UInt64 {
    var ts = timespec()
    clock_gettime(CLOCK_UPTIME_RAW, &ts)
    return UInt64(ts.tv_sec) * 1_000_000_000 + UInt64(ts.tv_nsec)
  }
}

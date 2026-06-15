import Foundation
import Darwin

final class AppHangWatchdog {
  private let thresholdMs: Int
  private let pollIntervalMs: Int
  private let onHangDetected: (Int) -> Void
  private let queue: DispatchQueue
  private var lastHeartbeatNs: UInt64 = 0
  private var running = false
  private var inHang = false

  init(
    label: String,
    thresholdMs: Int,
    pollIntervalMs: Int = 50,
    onHangDetected: @escaping (Int) -> Void
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
    lastHeartbeatNs = Self.nowNs()
    running = true
    queue.async { [weak self] in self?.loop() }
  }

  func stop() { running = false }

  deinit { stop() }

  private func loop() {
    while running {
      DispatchQueue.main.async { [weak self] in
        self?.lastHeartbeatNs = Self.nowNs()
      }
      Thread.sleep(forTimeInterval: Double(pollIntervalMs) / 1000.0)
      guard running else { return }
      let elapsedMs = Int((Self.nowNs() &- lastHeartbeatNs) / 1_000_000)
      if elapsedMs >= thresholdMs {
        if !inHang {
          inHang = true
          onHangDetected(elapsedMs)
        }
      } else if inHang {
        inHang = false
      }
    }
  }

  private static func nowNs() -> UInt64 {
    var ts = timespec()
    clock_gettime(CLOCK_UPTIME_RAW, &ts)
    return UInt64(ts.tv_sec) * 1_000_000_000 + UInt64(ts.tv_nsec)
  }
}

import ExpoModulesCore
import Foundation

public class ScoutCrashModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScoutCrash")

    OnCreate {
      ScoutCrashInstaller.installIfNeeded()
    }

    AsyncFunction("getPendingCrashes") { () -> [[String: Any]] in
      return ScoutCrashInstaller.readPendingReports()
    }

    AsyncFunction("clearPendingCrashes") { () -> Void in
      ScoutCrashInstaller.clearPendingReports()
    }

    AsyncFunction("isInstalled") { () -> Bool in
      return ScoutCrashInstaller.isInstalled
    }

    
    
    
    
    
    AsyncFunction("crashNow") { (reason: String?) -> Void in
      let message = reason ?? "synthetic native crash from ScoutCrash.crashNow"
      let exception = NSException(
        name: NSExceptionName(rawValue: "ScoutCrashTest"),
        reason: message,
        userInfo: nil
      )
      exception.raise()
    }
  }
}

private final class ScoutCrashInstaller {
  private static let syncQueue = DispatchQueue(label: "io.base14.scout-crash")
  private(set) static var isInstalled = false
  private static var previousHandler: ((NSException) -> Void)? = nil

  static func installIfNeeded() {
    syncQueue.sync {
      guard !isInstalled else { return }

      
      
      let prev = NSGetUncaughtExceptionHandler()
      previousHandler = prev.map { handler in
        { exception in handler(exception) }
      }

      NSSetUncaughtExceptionHandler { exception in
        ScoutCrashInstaller.writeReport(for: exception)
        
        ScoutCrashInstaller.previousHandler?(exception)
      }
      isInstalled = true
    }
  }

  static func readPendingReports() -> [[String: Any]] {
    guard let dir = crashDir() else { return [] }
    let fm = FileManager.default
    guard let files = try? fm.contentsOfDirectory(atPath: dir.path) else { return [] }
    let jsonFiles = files.filter { $0.hasSuffix(".json") }.sorted()
    var out: [[String: Any]] = []
    for name in jsonFiles {
      let url = dir.appendingPathComponent(name)
      guard let data = try? Data(contentsOf: url),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { continue }
      out.append(obj)
    }
    return out
  }

  static func clearPendingReports() {
    guard let dir = crashDir() else { return }
    let fm = FileManager.default
    guard let files = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
    for name in files {
      try? fm.removeItem(at: dir.appendingPathComponent(name))
    }
  }

  

  private static func writeReport(for exception: NSException) {
    guard let dir = crashDir() else { return }
    let report: [String: Any] = [
      "crash.type": "nsexception",
      "crash.reason": exception.reason ?? "",
      "crash.nsexception_name": exception.name.rawValue,
      "crash.stack_trace": exception.callStackSymbols.joined(separator: "\n"),
      "crash.thread": String(pthread_mach_thread_np(pthread_self())),
      "crash.timestamp": ISO8601DateFormatter().string(from: Date()),
    ]
    let filename = String(format: "ns_%@_%.0f.json",
                          UUID().uuidString,
                          Date().timeIntervalSince1970 * 1000)
    let url = dir.appendingPathComponent(filename)
    if let data = try? JSONSerialization.data(withJSONObject: report, options: []) {
      try? data.write(to: url)
    }
  }

  private static func crashDir() -> URL? {
    guard let cachesDir = FileManager.default.urls(
      for: .cachesDirectory,
      in: .userDomainMask
    ).first else { return nil }
    let dir = cachesDir.appendingPathComponent("scout-crash/pending", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }
}

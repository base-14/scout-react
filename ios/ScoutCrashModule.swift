import ExpoModulesCore
import Foundation
import MetricKit
import UIKit
import Darwin

private func scoutProcessStartTimeMillis() -> Double {
  var info = kinfo_proc()
  var size = MemoryLayout<kinfo_proc>.stride
  var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
  let result = mib.withUnsafeMutableBufferPointer { ptr -> Int32 in
    sysctl(ptr.baseAddress, u_int(ptr.count), &info, &size, nil, 0)
  }
  if result == 0 {
    let sec = Double(info.kp_proc.p_starttime.tv_sec)
    let usec = Double(info.kp_proc.p_starttime.tv_usec)
    return sec * 1000.0 + usec / 1000.0
  }
  return Date().timeIntervalSince1970 * 1000.0
}

public class ScoutCrashModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScoutCrash")

    OnCreate {
      
      
      _ = ScoutCrashInstaller.crashDirPath()

      
      
      
      
      
      
      
      if let dir = ScoutCrashInstaller.crashDirURL() {
        ScoutKSCrashIntegration.installIfNeeded(reportPath: dir.path)
        
        
        
        
        ScoutKSCrashIntegration.drainPendingReports(into: dir)
      }

      
      
      
      
      if #available(iOS 14.0, *) {
        ScoutMetricKitCollector.installIfNeeded()
      }
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

    
    
    
    
    AsyncFunction("getAccessibilitySnapshot") { () async -> [String: Any] in
      return await MainActor.run { ScoutAccessibilityQueries.snapshot() }
    }

    
    
    
    
    
    AsyncFunction("getProcessStartTimeMillis") { () -> Double in
      return scoutProcessStartTimeMillis()
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

@available(iOS 14.0, *)
private final class ScoutMetricKitCollector: NSObject, MXMetricManagerSubscriber {
  private static let shared = ScoutMetricKitCollector()
  private static var installed = false

  static func installIfNeeded() {
    guard !installed else { return }
    MXMetricManager.shared.add(shared)
    installed = true
  }

  
  
  func didReceive(_ payloads: [MXMetricPayload]) {}

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    for payload in payloads {
      if let crashes = payload.crashDiagnostics {
        for crash in crashes {
          writeCrashReport(crash, payload: payload)
        }
      }
      if let hangs = payload.hangDiagnostics {
        for hang in hangs {
          writeHangReport(hang, payload: payload)
        }
      }
    }
  }

  

  private func writeCrashReport(
    _ d: MXCrashDiagnostic,
    payload: MXDiagnosticPayload
  ) {
    var report: [String: Any] = [
      "crash.type": "metric_kit_crash",
      "crash.timestamp": ISO8601DateFormatter().string(from: Date()),
    ]
    if let s = d.signal { report["crash.signal"] = String(s.intValue) }
    if let et = d.exceptionType { report["crash.exception_type"] = String(et.intValue) }
    if let ec = d.exceptionCode { report["crash.exception_code"] = String(ec.intValue) }
    if let tr = d.terminationReason { report["crash.termination_reason"] = tr }
    if let ver = d.applicationVersion as String? {
      report["crash.application_version"] = ver
    }
    report["crash.os_version"] = d.metaData.osVersion
    report["crash.device_type"] = d.metaData.deviceType
    report["crash.region_format"] = d.metaData.regionFormat
    report["crash.application_build_version"] = d.metaData.applicationBuildVersion
    report["crash.diagnostic_payload_time_begin"] =
      ISO8601DateFormatter().string(from: payload.timeStampBegin)
    report["crash.diagnostic_payload_time_end"] =
      ISO8601DateFormatter().string(from: payload.timeStampEnd)
    if let tree = String(
      data: d.callStackTree.jsonRepresentation(),
      encoding: .utf8
    ) {
      
      
      report["crash.callstack_tree_json"] = String(tree.prefix(32_000))
    }
    persist(report, prefix: "mxc")
  }

  private func writeHangReport(
    _ d: MXHangDiagnostic,
    payload: MXDiagnosticPayload
  ) {
    var report: [String: Any] = [
      "crash.type": "metric_kit_hang",
      "crash.timestamp": ISO8601DateFormatter().string(from: Date()),
    ]
    report["crash.hang_duration_ms"] =
      d.hangDuration.converted(to: .milliseconds).value
    if let ver = d.applicationVersion as String? {
      report["crash.application_version"] = ver
    }
    report["crash.os_version"] = d.metaData.osVersion
    report["crash.device_type"] = d.metaData.deviceType
    if let tree = String(
      data: d.callStackTree.jsonRepresentation(),
      encoding: .utf8
    ) {
      report["crash.callstack_tree_json"] = String(tree.prefix(32_000))
    }
    persist(report, prefix: "mxh")
  }

  private func persist(_ report: [String: Any], prefix: String) {
    guard
      let dirPath = ScoutCrashInstaller.crashDirPath(),
      let data = try? JSONSerialization.data(withJSONObject: report, options: [])
    else { return }
    let filename = String(
      format: "%@_%@_%.0f.json",
      prefix,
      UUID().uuidString,
      Date().timeIntervalSince1970 * 1000
    )
    let url = URL(fileURLWithPath: dirPath).appendingPathComponent(filename)
    try? data.write(to: url)
  }
}

@MainActor
private enum ScoutAccessibilityQueries {
  static func snapshot() -> [String: Any] {
    var out: [String: Any] = [:]
    out["bold_text_enabled"] = UIAccessibility.isBoldTextEnabled
    out["reduce_transparency_enabled"] = UIAccessibility.isReduceTransparencyEnabled
    out["reduce_motion_enabled"] = UIAccessibility.isReduceMotionEnabled
    out["invert_colors_enabled"] = UIAccessibility.isInvertColorsEnabled
    out["grayscale_enabled"] = UIAccessibility.isGrayscaleEnabled
    out["increase_contrast_enabled"] = UIAccessibility.isDarkerSystemColorsEnabled
    out["assistive_switch_enabled"] = UIAccessibility.isSwitchControlRunning
    out["assistive_touch_enabled"] = UIAccessibility.isAssistiveTouchRunning
    out["video_autoplay_enabled"] = UIAccessibility.isVideoAutoplayEnabled
    out["closed_captioning_enabled"] = UIAccessibility.isClosedCaptioningEnabled
    out["mono_audio_enabled"] = UIAccessibility.isMonoAudioEnabled
    out["shake_to_undo_enabled"] = UIAccessibility.isShakeToUndoEnabled
    out["speak_screen_enabled"] = UIAccessibility.isSpeakScreenEnabled
    out["speak_selection_enabled"] = UIAccessibility.isSpeakSelectionEnabled
    out["on_off_switch_labels_enabled"] = UIAccessibility.isOnOffSwitchLabelsEnabled
    out["single_app_mode_enabled"] = UIAccessibility.isGuidedAccessEnabled
    if #available(iOS 13.0, *) {
      out["button_shapes_enabled"] = UIAccessibility.buttonShapesEnabled
    }
    if #available(iOS 13.0, *) {
      out["differentiate_without_color"] = UIAccessibility.shouldDifferentiateWithoutColor
    }
    if #available(iOS 14.0, *) {
      out["reduced_animations_enabled"] = UIAccessibility.prefersCrossFadeTransitions
    }
    return out
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

  
  
  static func crashDirPath() -> String? {
    return crashDir()?.path
  }

  
  static func crashDirURL() -> URL? {
    return crashDir()
  }
}

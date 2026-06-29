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
  private var hangWatchdog: AppHangWatchdog?
  private var anrWatchdog: AppHangWatchdog?
  private var mainThreadPort: thread_t = thread_t(MACH_PORT_NULL)

  public func definition() -> ModuleDefinition {
    Name("ScoutCrash")

    Events("ScoutUIHang", "ScoutAnr")

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

    AsyncFunction("setBreadcrumbs") { (json: String) -> Void in
      ScoutKSCrashIntegration.setBreadcrumbs(json)
    }

    AsyncFunction("setSessionContext") { (sessionId: String, sessionStartedAt: String) -> Void in
      ScoutKSCrashIntegration.setSessionContext(sessionId: sessionId, sessionStartedAt: sessionStartedAt)
    }

    AsyncFunction("startHangDetection") { (thresholdMs: Int) -> Void in
      guard thresholdMs > 0 else { return }
      if self.mainThreadPort == thread_t(MACH_PORT_NULL) {
        DispatchQueue.main.sync { self.mainThreadPort = ScoutThreadBacktrace.currentPort() }
      }
      self.hangWatchdog?.stop()
      let wd = AppHangWatchdog(
        label: "ui_hang",
        thresholdMs: thresholdMs
      ) { [weak self] elapsedMs, source in
        guard let self = self else { return }
        let frames = ScoutThreadBacktrace.capture(self.mainThreadPort)
        let mainStack = frames.joined(separator: "\n")
        var payload: [String: Any] = [
          "durationMs": elapsedMs,
          "thresholdMs": thresholdMs,
          "source": source,
        ]
        if !mainStack.isEmpty {
          payload["mainThreadStack"] = mainStack
        }
        self.sendEvent("ScoutUIHang", payload)
      }
      self.hangWatchdog = wd
      wd.start()
    }

    AsyncFunction("stopHangDetection") { () -> Void in
      self.hangWatchdog?.stop()
      self.hangWatchdog = nil
    }

    AsyncFunction("startAnrDetection") { (thresholdMs: Int) -> Void in
      guard thresholdMs > 0 else { return }
      if self.mainThreadPort == thread_t(MACH_PORT_NULL) {
        DispatchQueue.main.sync { self.mainThreadPort = ScoutThreadBacktrace.currentPort() }
      }
      self.anrWatchdog?.stop()
      let wd = AppHangWatchdog(
        label: "anr",
        thresholdMs: thresholdMs
      ) { [weak self] elapsedMs, source in
        guard let self = self else { return }
        let frames = ScoutThreadBacktrace.capture(self.mainThreadPort)
        let mainStack = frames.joined(separator: "\n")
        var payload: [String: Any] = [
          "durationMs": elapsedMs,
          "thresholdMs": thresholdMs,
          "source": source,
        ]
        if !mainStack.isEmpty {
          payload["mainThreadStack"] = mainStack
        }
        self.sendEvent("ScoutAnr", payload)
      }
      self.anrWatchdog = wd
      wd.start()
    }

    AsyncFunction("stopAnrDetection") { () -> Void in
      self.anrWatchdog?.stop()
      self.anrWatchdog = nil
    }

    AsyncFunction("notifyJsAlive") { () -> Void in
      self.hangWatchdog?.notifyJsAlive()
      self.anrWatchdog?.notifyJsAlive()
    }

    AsyncFunction("__debugBlockMainThread") { (durationMs: Int) -> Void in
      let clamped = max(0, min(durationMs, 30_000))
      DispatchQueue.main.async {
        Thread.sleep(forTimeInterval: Double(clamped) / 1000.0)
      }
    }

    AsyncFunction("isDeviceCompromised") { () -> Bool in
      #if targetEnvironment(simulator)
      return false
      #else
      let paths = [
        "/Applications/Cydia.app",
        "/Library/MobileSubstrate/MobileSubstrate.dylib",
        "/bin/bash",
        "/usr/sbin/sshd",
        "/etc/apt",
        "/private/var/lib/apt/",
        "/private/var/lib/cydia",
        "/usr/libexec/ssh-keysign",
        "/usr/libexec/sftp-server",
        "/Applications/Sileo.app",
        "/Applications/Zebra.app",
      ]
      let fm = FileManager.default
      for path in paths {
        if fm.fileExists(atPath: path) { return true }
      }
      return false
      #endif
    }

    AsyncFunction("getCpuPercent") { () -> Double in
      var threadList: thread_act_array_t?
      var threadCount: mach_msg_type_number_t = 0
      let threadResult = task_threads(mach_task_self_, &threadList, &threadCount)
      var totalCpu: Double = 0.0
      if threadResult == KERN_SUCCESS, let threads = threadList {
        for i in 0..<Int(threadCount) {
          var threadInfo = thread_basic_info()
          var threadInfoCount = mach_msg_type_number_t(
            MemoryLayout<thread_basic_info>.size / MemoryLayout<integer_t>.size
          )
          let infoResult = withUnsafeMutablePointer(to: &threadInfo) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
              thread_info(
                threads[i], thread_flavor_t(THREAD_BASIC_INFO), $0, &threadInfoCount
              )
            }
          }
          if infoResult == KERN_SUCCESS {
            let usage = Double(threadInfo.cpu_usage) / Double(TH_USAGE_SCALE) * 100.0
            totalCpu += usage
          }
        }
        vm_deallocate(
          mach_task_self_,
          vm_address_t(bitPattern: threads),
          vm_size_t(threadCount) * vm_size_t(MemoryLayout<thread_t>.size)
        )
      }
      return totalCpu
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
      report["crash.app_version"] = ver
    }
    report["crash.os_version"] = d.metaData.osVersion
    report["crash.device_type"] = d.metaData.deviceType
    report["crash.region_format"] = d.metaData.regionFormat
    report["crash.application_build_version"] = d.metaData.applicationBuildVersion
    report["crash.diagnostic_payload_time_begin"] =
      ISO8601DateFormatter().string(from: payload.timeStampBegin)
    report["crash.diagnostic_payload_time_end"] =
      ISO8601DateFormatter().string(from: payload.timeStampEnd)
    let mxcStack = d.callStackTree.jsonRepresentation().base64EncodedString()
    report["crash.callstack_tree_json"] = mxcStack
    report["crash.stack_trace"] = mxcStack
    report["crash.callstack_tree_encoding"] = "base64"
    persist(report, prefix: "mxc")
  }

  private func writeHangReport(
    _ d: MXHangDiagnostic,
    payload: MXDiagnosticPayload
  ) {
    let hangMs = d.hangDuration.converted(to: .milliseconds).value
    var report: [String: Any] = [
      "crash.type": "metric_kit_hang",
      "crash.timestamp": ISO8601DateFormatter().string(from: Date()),
      "crash.reason": "App hang \(Int(hangMs))ms",
    ]
    report["crash.hang_duration_ms"] = hangMs
    if let ver = d.applicationVersion as String? {
      report["crash.application_version"] = ver
      report["crash.app_version"] = ver
    }
    report["crash.os_version"] = d.metaData.osVersion
    report["crash.device_type"] = d.metaData.deviceType
    let mxhStack = d.callStackTree.jsonRepresentation().base64EncodedString()
    report["crash.callstack_tree_json"] = mxhStack
    report["crash.stack_trace"] = mxhStack
    report["crash.callstack_tree_encoding"] = "base64"
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

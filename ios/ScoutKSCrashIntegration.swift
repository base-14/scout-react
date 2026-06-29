import Foundation
import KSCrash
import UIKit

enum ScoutKSCrashIntegration {
  private static var installed = false
  private static var userInfoLock = NSLock()
  private static var userInfoState: [String: Any] = [:]

  private static func mergeUserInfo(_ key: String, _ value: Any) {
    userInfoLock.lock()
    userInfoState[key] = value
    KSCrash.shared.userInfo = userInfoState
    userInfoLock.unlock()
  }

  static func setBreadcrumbs(_ json: String) {
    mergeUserInfo("scout.breadcrumbs", json)
  }

  private static func resolveUserInfo(_ user: [String: Any]) -> [String: Any] {
    if user["error"] != nil, let raw = user["json_data"] as? String,
       let data = raw.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      return parsed
    }
    return user
  }

  static func setSessionContext(sessionId: String, sessionStartedAt: String) {
    mergeUserInfo("scout.session_id", sessionId)
    mergeUserInfo("scout.session_started_at", sessionStartedAt)
  }

  static func installIfNeeded(reportPath: String) {
    guard !installed else { return }
    let crash = KSCrash.shared
    let config = KSCrashConfiguration()
    
    
    
    
    config.monitors = [
      .machException,
      .signal,
      .cppException,
      .nsException,
      .mainThreadDeadlock,
      .userReported,
      .system,
      .applicationState,
    ]
    config.addConsoleLogToReport = false
    config.printPreviousLogOnStartup = false
    config.enableSwapCxaThrow = true
    do {
      try crash.install(with: config)
      installed = true
    } catch {
      NSLog("[scout-react] KSCrash install failed: \(error)")
    }
  }

  
  
  
  static func drainPendingReports(into dir: URL) {
    guard let store = KSCrash.shared.reportStore else { return }
    let ids = store.reportIDs
    guard !ids.isEmpty else { return }
    for id in ids {
      autoreleasepool {
        if let report = store.report(for: id.int64Value) {
          let flat = flatten(report: report.value)
          persist(flat, into: dir)
        }
      }
    }
    store.deleteAllReports()
  }

  

  
  
  
  
  private static func flatten(report: [String: Any]) -> [String: Any] {
    var out: [String: Any] = [:]
    out["crash.type"] = "kscrash"

    if let header = report["report"] as? [String: Any] {
      if let id = header["id"] as? String { out["crash.report_id"] = id }
      if let ts = header["timestamp"] as? String { out["crash.timestamp"] = ts }
      if let proc = header["process_name"] as? String { out["crash.process_name"] = proc }
    }

    if let process = report["process"] as? [String: Any] {
      if let pid = process["pid"] { out["crash.pid"] = String(describing: pid) }
      if let ppid = process["ppid"] { out["crash.ppid"] = String(describing: ppid) }
      if let name = process["name"] as? String { out["crash.process_name"] = name }
    }

    if let system = report["system"] as? [String: Any] {
      let put: (String, Any?) -> Void = { key, value in
        guard let v = value else { return }
        if let s = v as? String, s.isEmpty { return }
        out[key] = v
      }
      put("crash.os_name",            system["system_name"])
      put("crash.os_version",         system["system_version"])
      put("crash.os_build",           system["os_version"])
      put("crash.kernel_version",     system["kernel_version"])
      put("crash.boot_time",          system["boot_time"])
      put("crash.app_start_time",     system["app_start_time"])
      put("crash.time_zone",          system["time_zone"])
      put("crash.machine",            system["machine"])
      put("crash.device_model",       system["model"])
      put("crash.cpu_arch",           system["cpu_arch"])
      put("crash.cpu_type",           system["cpu_type"])
      put("crash.cpu_subtype",        system["cpu_subtype"])
      put("crash.binary_cpu_type",    system["binary_cpu_type"])
      put("crash.binary_cpu_subtype", system["binary_cpu_subtype"])
      put("crash.app_name",           system["CFBundleName"])
      put("crash.app_executable",     system["CFBundleExecutable"])
      put("crash.bundle_id",          system["CFBundleIdentifier"] ?? system["bundle_id"])
      put("crash.app_id",             system["CFBundleIdentifier"] ?? system["bundle_id"])
      put("crash.application_version", system["CFBundleShortVersionString"] ?? system["bundle_short_version"])
      put("crash.application_build_version", system["CFBundleVersion"] ?? system["bundle_version"])
      put("crash.executable_path",    system["CFBundleExecutablePath"])
      put("crash.build_type",         system["build_type"])
      put("crash.device_app_hash",    system["device_app_hash"])
      put("crash.app_uuid",           system["app_uuid"])
      put("crash.parent_pid",         system["parent_process_id"])
      if out["crash.process_name"] == nil {
        put("crash.process_name", system["process_name"])
      }
      if out["crash.pid"] == nil {
        put("crash.pid", system["process_id"])
      }
      if let memory = system["memory"] as? [String: Any] {
        put("crash.memory_size_bytes",   memory["size"])
        put("crash.memory_free_bytes",   memory["free"])
        put("crash.memory_usable_bytes", memory["usable"])
      }
      if let appMem = system["app_memory"] as? [String: Any] {
        put("crash.memory_footprint",     appMem["memory_footprint"])
        put("crash.memory_remaining",     appMem["memory_remaining"])
        put("crash.memory_pressure",      appMem["memory_pressure"])
        put("crash.memory_level",         appMem["memory_level"])
        put("crash.memory_limit",         appMem["memory_limit"])
        put("crash.app_transition_state", appMem["app_transition_state"])
      }
      put("crash.storage_size_bytes", system["storage"])
      if let jb = system["jailbroken"] as? Bool {
        out["crash.jailbroken"] = jb
      }
      put("crash.last_dealloced_nsexception", system["last_dealloced_nsexception"])
      if let stats = system["application_stats"] as? [String: Any] {
        put("crash.app_active_time_secs",                      stats["active_time_since_launch"])
        put("crash.app_background_time_secs",                  stats["background_time_since_launch"])
        put("crash.app_active_time_since_last_crash_secs",     stats["active_time_since_last_crash"])
        put("crash.app_background_time_since_last_crash_secs", stats["background_time_since_last_crash"])
        put("crash.app_launches_since_last_crash",             stats["launches_since_last_crash"])
        put("crash.app_sessions_since_last_crash",             stats["sessions_since_last_crash"])
        put("crash.app_sessions_since_launch",                 stats["sessions_since_launch"])
        if let inFg = stats["application_in_foreground"] as? Bool {
          out["crash.app_in_foreground"] = inFg
        }
        if let active = stats["application_active"] as? Bool {
          out["crash.app_active"] = active
        }
      }
    }

    addDrainTimeContext(&out)
    addProcessSysctlContext(&out)

    if let crashInfo = report["crash"] as? [String: Any] {
      let putCrash: (String, Any?) -> Void = { key, value in
        guard let v = value else { return }
        if let s = v as? String, s.isEmpty { return }
        out[key] = v
      }
      if let error = crashInfo["error"] as? [String: Any] {
        if let errType = error["type"] as? String { out["crash.error_type"] = errType }
        if let reason = error["reason"] as? String { out["crash.reason"] = reason }
        if let addr = error["address"] {
          out["crash.signal_address"] = String(describing: addr)
          out["crash.fault_address"] = String(describing: addr)
        }
        if let signal = error["signal"] as? [String: Any] {
          if let name = signal["name"] as? String { out["crash.signal"] = name }
          if let code = signal["code"] { out["crash.signal_code"] = String(describing: code) }
          if let codeName = signal["code_name"] as? String {
            out["crash.signal_code_name"] = codeName
          }
          if let signum = signal["signal"] { out["crash.signal_number"] = signum }
        }
        if let termination = error["termination"] as? [String: Any]
            ?? crashInfo["termination"] as? [String: Any]
        {
          putCrash("crash.termination_flags",     termination["flags"])
          putCrash("crash.termination_code",      termination["code"])
          putCrash("crash.termination_namespace", termination["namespace"])
          putCrash("crash.termination_indicator", termination["indicator"])
          putCrash("crash.termination_by_proc",   termination["byProc"])
          putCrash("crash.termination_by_pid",    termination["byPid"])
        }
        if let mach = error["mach"] as? [String: Any] {
          if let name = mach["exception_name"] as? String { out["crash.mach_exception"] = name }
          if let code = mach["code"] { out["crash.mach_code"] = String(describing: code) }
          if let codeName = mach["code_name"] as? String {
            out["crash.mach_code_name"] = codeName
          }
          if let subcode = mach["subcode"] { out["crash.mach_subcode"] = String(describing: subcode) }
          if let excCode = mach["exception_code"] {
            out["crash.mach_exception_code"] = String(describing: excCode)
          }
          if let excName = mach["exception"] { out["crash.mach_exception_number"] = String(describing: excName) }
        }
        if let ns = error["nsexception"] as? [String: Any] {
          if let name = ns["name"] as? String { out["crash.nsexception_name"] = name }
          if let reason = ns["reason"] as? String, !reason.isEmpty {
            out["crash.nsexception_reason"] = reason
          }
          if let userInfo = ns["userInfo"],
             let data = try? JSONSerialization.data(withJSONObject: userInfo, options: []),
             let s = String(data: data, encoding: .utf8)
          {
            out["crash.nsexception_userinfo"] = s
          }
        }
        if let cpp = error["cpp_exception"] as? [String: Any] {
          if let name = cpp["name"] as? String { out["crash.cpp_exception_name"] = name }
        }
      }

      if let diag = crashInfo["diagnosis"] as? String { out["crash.diagnosis"] = diag }
      if let crashedIdx = crashInfo["crashed_thread"] {
        out["crash.crashing_thread_index"] = String(describing: crashedIdx)
      }

      if let threads = crashInfo["threads"] as? [[String: Any]] {
        out["crash.thread_count"] = threads.count
        if let crashed = threads.first(where: { ($0["crashed"] as? Bool) == true }) ?? threads.first {
          putCrash("crash.thread_index", crashed["index"])
          if let name = crashed["name"] as? String, !name.isEmpty {
            out["crash.thread_name"] = name
            out["crash.thread"] = name
          } else if let idx = crashed["index"] {
            out["crash.thread"] = String(describing: idx)
          }
          putCrash("crash.thread_id",      crashed["thread_id"])
          putCrash("crash.thread_current", crashed["current_thread"])
          if let queue = crashed["queue_name"] as? String ?? crashed["dispatch_queue"] as? String {
            out["crash.queue"] = queue
            out["crash.queue_name"] = queue
          }
          putCrash("crash.dispatch_queue", crashed["dispatch_queue"])
          if let regs = crashed["registers"],
             let regJson = try? JSONSerialization.data(withJSONObject: regs, options: []),
             let s = String(data: regJson, encoding: .utf8)
          {
            out["crash.registers_json"] = s
            
            
            if let farKeyRange = s.range(of: "\"far\":") {
              let after = s[farKeyRange.upperBound...]
              let endIdx = after.firstIndex(where: { $0 == "," || $0 == "}" }) ?? after.endIndex
              out["crash.fault_address_register"] = String(after[..<endIdx])
            }
            if let esrKeyRange = s.range(of: "\"esr\":") {
              let after = s[esrKeyRange.upperBound...]
              let endIdx = after.firstIndex(where: { $0 == "," || $0 == "}" }) ?? after.endIndex
              out["crash.exception_syndrome_register"] = String(after[..<endIdx])
            }
            
            
            if let firstBrace = s.range(of: "\"exception\":{"),
               let nested = s.range(of: "\"exception\":", range: firstBrace.upperBound..<s.endIndex)
            {
              let after = s[nested.upperBound...]
              let endIdx = after.firstIndex(where: { $0 == "," || $0 == "}" }) ?? after.endIndex
              out["crash.exception_register"] = String(after[..<endIdx])
            }
          }
        }
        if let treeJson = try? JSONSerialization.data(withJSONObject: threads, options: []),
           let s = String(data: treeJson, encoding: .utf8)
        {
          out["crash.callstack_tree_json"] = s
        }
      }
    }

    if let images = report["binary_images"] as? [[String: Any]] {
      out["crash.binary_images_count"] = images.count
      let slim: [[String: Any]] = images.map { img in
        var o: [String: Any] = [:]
        if let a = img["image_addr"] { o["addr"] = a }
        if let s = img["image_size"] { o["size"] = s }
        if let v = img["image_vmaddr"] { o["vmaddr"] = v }
        if let n = img["name"] { o["name"] = n }
        if let u = img["uuid"] { o["uuid"] = u }
        return o
      }
      if let data = try? JSONSerialization.data(withJSONObject: slim, options: []),
         let s = String(data: data, encoding: .utf8)
      {
        out["crash.binary_images_json"] = s
      }
    }

    if let user = report["user"] as? [String: Any] {
      let resolved = resolveUserInfo(user)
      if let crumbs = resolved["scout.breadcrumbs"] as? String, !crumbs.isEmpty {
        out["crash.breadcrumbs"] = crumbs
      }
      if let sid = resolved["scout.session_id"] as? String, !sid.isEmpty {
        out["crash.previous_session_id"] = sid
      }
      if let sstart = resolved["scout.session_started_at"] as? String, !sstart.isEmpty {
        out["crash.session_started_at"] = sstart
      }
      let internalKeys: Set<String> = ["scout.breadcrumbs", "scout.session_id", "scout.session_started_at"]
      let extras = resolved.filter { !internalKeys.contains($0.key) }
      if !extras.isEmpty,
         let data = try? JSONSerialization.data(withJSONObject: extras, options: []),
         let s = String(data: data, encoding: .utf8)
      {
        out["crash.user_info_json"] = s
      }
    }

    out["crash.report_type"] = "kscrash"
    out["crash.report_version"] = "1.0"

    return out
  }

  private static func addProcessSysctlContext(_ out: inout [String: Any]) {
    var translated: Int32 = 0
    var tsize = MemoryLayout<Int32>.size
    if sysctlbyname("sysctl.proc_translated", &translated, &tsize, nil, 0) == 0 {
      out["crash.translated"] = translated == 1
    }
    let pid = getpid()
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    var size = 0
    if sysctl(&mib, u_int(mib.count), nil, &size, nil, 0) == 0 && size > 0 {
      var buf = [UInt8](repeating: 0, count: size)
      if sysctl(&mib, u_int(mib.count), &buf, &size, nil, 0) == 0 {
        let ppid = buf.withUnsafeBytes { raw -> Int32 in
          let kp = raw.bindMemory(to: kinfo_proc.self).baseAddress!
          return kp.pointee.kp_eproc.e_ppid
        }
        if out["crash.parent_pid"] == nil {
          out["crash.parent_pid"] = Int(ppid)
        }
        var pmib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, ppid]
        var psize = 0
        if sysctl(&pmib, u_int(pmib.count), nil, &psize, nil, 0) == 0 && psize > 0 {
          var pbuf = [UInt8](repeating: 0, count: psize)
          if sysctl(&pmib, u_int(pmib.count), &pbuf, &psize, nil, 0) == 0 {
            let name = pbuf.withUnsafeBytes { raw -> String in
              let kp = raw.bindMemory(to: kinfo_proc.self).baseAddress!
              return withUnsafePointer(to: kp.pointee.kp_proc.p_comm) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXCOMLEN) + 1) {
                  String(cString: $0)
                }
              }
            }
            if !name.isEmpty {
              out["crash.parent_proc_name"] = name
            }
          }
        }
      }
    }
  }

  private static func addDrainTimeContext(_ out: inout [String: Any]) {
    if let idfv = UIDevice.current.identifierForVendor?.uuidString {
      out["crash.idfv"] = idfv
    }
    out["crash.uid"] = Int(getuid())
    out["crash.gid"] = Int(getgid())
    var bootTime = timeval()
    var btSize = MemoryLayout<timeval>.size
    if sysctlbyname("kern.boottime", &bootTime, &btSize, nil, 0) == 0 {
      let bootDate = Date(timeIntervalSince1970: Double(bootTime.tv_sec))
      out["crash.system_boot_time_iso"] = ISO8601DateFormatter().string(from: bootDate)
      out["crash.time_since_boot_secs"] = Date().timeIntervalSince(bootDate)
    }
    out["crash.drain_uptime_secs"] = ProcessInfo.processInfo.systemUptime
    out["crash.drain_process_start_time"] = ISO8601DateFormatter().string(from: Date())
    let appState: UIApplication.State = Thread.isMainThread
      ? UIApplication.shared.applicationState
      : DispatchQueue.main.sync { UIApplication.shared.applicationState }
    switch appState {
    case .active:     out["crash.drain_app_state"] = "active"
    case .inactive:   out["crash.drain_app_state"] = "inactive"
    case .background: out["crash.drain_app_state"] = "background"
    @unknown default: out["crash.drain_app_state"] = "unknown"
    }
    #if targetEnvironment(simulator)
      out["crash.environment"] = "simulator"
    #else
      out["crash.environment"] = "device"
    #endif
    #if DEBUG
      out["crash.build_configuration"] = "debug"
    #else
      out["crash.build_configuration"] = "release"
    #endif
  }

  private static func persist(_ report: [String: Any], into dir: URL) {
    guard let data = try? JSONSerialization.data(withJSONObject: report, options: []) else {
      return
    }
    let filename = String(
      format: "ks_%@_%.0f.json",
      UUID().uuidString,
      Date().timeIntervalSince1970 * 1000
    )
    let url = dir.appendingPathComponent(filename)
    try? data.write(to: url)
  }
}

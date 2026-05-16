import Foundation
import KSCrash

enum ScoutKSCrashIntegration {
  private static var installed = false

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
      if let osName = system["system_name"] as? String { out["crash.os_name"] = osName }
      if let osVer = system["system_version"] as? String { out["crash.os_version"] = osVer }
      if let kernel = system["kernel_version"] as? String { out["crash.kernel_version"] = kernel }
      if let machine = system["machine"] as? String { out["crash.machine"] = machine }
      if let model = system["model"] as? String { out["crash.device_model"] = model }
      if let cpu = system["cpu_arch"] as? String { out["crash.cpu_arch"] = cpu }
      if let bundle = system["bundle_id"] as? String { out["crash.bundle_id"] = bundle }
      if let ver = system["bundle_short_version"] as? String {
        out["crash.application_version"] = ver
      }
      if let build = system["bundle_version"] as? String {
        out["crash.application_build_version"] = build
      }
      if let bt = system["build_type"] as? String { out["crash.build_type"] = bt }
    }

    if let crashInfo = report["crash"] as? [String: Any] {
      if let error = crashInfo["error"] as? [String: Any] {
        if let errType = error["type"] as? String { out["crash.error_type"] = errType }
        if let reason = error["reason"] as? String { out["crash.reason"] = reason }
        if let addr = error["address"] {
          out["crash.signal_address"] = String(describing: addr)
        }
        if let signal = error["signal"] as? [String: Any] {
          if let name = signal["name"] as? String { out["crash.signal"] = name }
          if let code = signal["code"] { out["crash.signal_code"] = String(describing: code) }
        }
        if let mach = error["mach"] as? [String: Any] {
          if let name = mach["exception_name"] as? String { out["crash.mach_exception"] = name }
          if let code = mach["code"] { out["crash.mach_code"] = String(describing: code) }
        }
        if let ns = error["nsexception"] as? [String: Any] {
          if let name = ns["name"] as? String { out["crash.nsexception_name"] = name }
        }
        if let cpp = error["cpp_exception"] as? [String: Any] {
          if let name = cpp["name"] as? String { out["crash.cpp_exception_name"] = name }
        }
      }

      
      
      
      if let threads = crashInfo["threads"] as? [[String: Any]] {
        if let crashed = threads.first(where: { ($0["crashed"] as? Bool) == true }) {
          if let idx = crashed["index"] { out["crash.thread"] = String(describing: idx) }
          if let queue = crashed["queue_name"] as? String { out["crash.queue"] = queue }
          if let regs = crashed["registers"],
             let regJson = try? JSONSerialization.data(withJSONObject: regs, options: []),
             let s = String(data: regJson, encoding: .utf8)
          {
            out["crash.registers_json"] = String(s.prefix(16_000))
            
            
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
          out["crash.callstack_tree_json"] = String(s.prefix(32_000))
        }
      }
    }

    if let images = report["binary_images"] as? [[String: Any]] {
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
        out["crash.binary_images_json"] = String(s.prefix(16_000))
      }
    }

    return out
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

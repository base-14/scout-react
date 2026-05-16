package io.base14.scoutreact

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

class ScoutCrashModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScoutCrash")

    OnCreate {
      val ctx = appContext.reactContext ?: return@OnCreate
      ScoutCrashInstaller.installIfNeeded(ctx)
      
      
      
      
      val dir = java.io.File(ctx.filesDir, "scout-crash/pending").apply { mkdirs() }
      ScoutNdkSignalHandler.installIfNeeded(dir.absolutePath)
      
      
      
      
      ScoutExitInfoCollector.drain(ctx, dir)
    }

    AsyncFunction("getPendingCrashes") { ->
      ScoutCrashInstaller.readPendingReports()
    }

    AsyncFunction("clearPendingCrashes") { ->
      ScoutCrashInstaller.clearPendingReports()
    }

    AsyncFunction("isInstalled") { ->
      ScoutCrashInstaller.isInstalled
    }

    AsyncFunction("getAccessibilitySnapshot") { ->
      val ctx = appContext.reactContext ?: return@AsyncFunction emptyMap<String, Any>()
      ScoutAccessibilityQueries.snapshot(ctx)
    }
  }
}

private object ScoutExitInfoCollector {
  private const val PREFS = "scout_exit_info"
  private const val KEY_LAST_TIMESTAMP = "last_timestamp"
  private const val MAX_TRACE_BYTES = 32_000

  
  fun drain(ctx: Context, dir: File) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      ?: return
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val lastTs = prefs.getLong(KEY_LAST_TIMESTAMP, 0L)
    val infos = try {
      am.getHistoricalProcessExitReasons(null, 0, 50)
    } catch (_: Throwable) {
      return
    }
    var newest = lastTs
    for (info in infos) {
      if (info.timestamp <= lastTs) continue
      if (info.timestamp > newest) newest = info.timestamp
      if (!isInteresting(info.reason)) continue
      try {
        writeReport(dir, info)
      } catch (_: Throwable) {
        
      }
    }
    if (newest > lastTs) {
      prefs.edit().putLong(KEY_LAST_TIMESTAMP, newest).apply()
    }
  }

  private fun isInteresting(reason: Int): Boolean = when (reason) {
    ApplicationExitInfo.REASON_CRASH,
    ApplicationExitInfo.REASON_CRASH_NATIVE,
    ApplicationExitInfo.REASON_ANR,
    ApplicationExitInfo.REASON_LOW_MEMORY,
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE,
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE,
    ApplicationExitInfo.REASON_SIGNALED -> true
    else -> false
  }

  private fun writeReport(dir: File, info: ApplicationExitInfo) {
    val obj = JSONObject().apply {
      put("crash.type", "exit_info")
      put("crash.os_reason_code", info.reason)
      put("crash.os_reason_name", reasonName(info.reason))
      
      
      
      try {
        val m = info.javaClass.getMethod("getSubReason")
        val sub = m.invoke(info) as? Int
        if (sub != null) put("crash.subreason", sub)
      } catch (_: Throwable) {
        
      }
      put("crash.exit_status", info.status)
      put("crash.death_timestamp_ms", info.timestamp)
      put("crash.process_name", info.processName ?: "")
      put("crash.pid", info.pid)
      put("crash.importance", info.importance)
      put("crash.pss_kb", info.pss)
      put("crash.rss_kb", info.rss)
      put("crash.reason", info.description ?: "")
      
      
      val trace = try {
        info.traceInputStream?.use { stream ->
          val buf = ByteArray(MAX_TRACE_BYTES)
          val read = stream.read(buf)
          if (read > 0) String(buf, 0, read, Charsets.UTF_8) else ""
        } ?: ""
      } catch (_: Throwable) {
        ""
      }
      if (trace.isNotEmpty()) put("crash.tombstone", trace)
      put("crash.timestamp", info.timestamp.toString())
    }
    val out = File(dir, "exit_${info.pid}_${info.timestamp}.json")
    out.writeText(obj.toString())
  }

  private fun reasonName(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_CRASH -> "crash"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "crash_native"
    ApplicationExitInfo.REASON_ANR -> "anr"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "low_memory"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive_resource_usage"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization_failure"
    ApplicationExitInfo.REASON_SIGNALED -> "signaled"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "user_requested"
    ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "package_updated"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency_died"
    ApplicationExitInfo.REASON_OTHER -> "other"
    else -> "reason_$reason"
  }
}

private object ScoutAccessibilityQueries {
  fun snapshot(context: Context): Map<String, Any> {
    val out = HashMap<String, Any>()
    try {
      val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
      val srEnabled = am?.isTouchExplorationEnabled == true || am?.isEnabled == true
      out["assistive_switch_enabled"] = srEnabled
      val any = am?.getEnabledAccessibilityServiceList(android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
      if (any != null && any.isNotEmpty()) {
        out["assistive_switch_enabled"] = true
      }
    } catch (_: Throwable) {
      
    }
    try {
      val r = context.resources
      val ratio = Settings.System.getFloat(context.contentResolver, Settings.System.FONT_SCALE, r.configuration.fontScale)
      out["text_size_scale"] = ratio
    } catch (_: Throwable) {
      
    }
    try {
      
      val high = Settings.Secure.getInt(context.contentResolver, "high_text_contrast_enabled", 0) == 1
      out["increase_contrast_enabled"] = high
    } catch (_: Throwable) {
      
    }
    try {
      
      val inverted = Settings.Secure.getInt(context.contentResolver, "accessibility_display_inversion_enabled", 0) == 1
      out["invert_colors_enabled"] = inverted
    } catch (_: Throwable) {
      
    }
    try {
      
      val anim = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
      out["reduced_animations_enabled"] = anim == 0f
    } catch (_: Throwable) {
      
    }
    try {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val isLowRam = am?.isLowRamDevice == true
      out["is_low_ram"] = isLowRam
    } catch (_: Throwable) {
      
    }
    return out
  }
}

private object ScoutCrashInstaller {
  @Volatile var isInstalled: Boolean = false
  private var crashDir: File? = null
  private var previousHandler: Thread.UncaughtExceptionHandler? = null

  @Synchronized
  fun installIfNeeded(context: Context) {
    if (isInstalled) return
    val dir = File(context.filesDir, "scout-crash/pending").apply { mkdirs() }
    crashDir = dir

    previousHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        writeReport(dir, thread, throwable)
      } catch (_: Throwable) {
        
      }
      
      previousHandler?.uncaughtException(thread, throwable)
    }
    isInstalled = true
  }

  fun readPendingReports(): List<Map<String, Any?>> {
    val dir = crashDir ?: return emptyList()
    if (!dir.exists()) return emptyList()
    val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".json") } ?: return emptyList()
    return files.sortedBy { it.lastModified() }.mapNotNull { f ->
      try {
        val json = JSONObject(f.readText())
        json.toMap()
      } catch (_: Throwable) {
        null
      }
    }
  }

  fun clearPendingReports() {
    val dir = crashDir ?: return
    if (!dir.exists()) return
    dir.listFiles()?.forEach { it.delete() }
  }

  private fun writeReport(dir: File, thread: Thread, throwable: Throwable) {
    val sw = StringWriter()
    throwable.printStackTrace(PrintWriter(sw))
    val obj = JSONObject().apply {
      put("crash.type", "uncaught_exception")
      put("crash.reason", throwable.message ?: throwable.javaClass.simpleName)
      put("crash.nsexception_name", throwable.javaClass.name)
      put("crash.stack_trace", sw.toString())
      put("crash.thread", thread.name ?: "unknown")
      put("crash.timestamp", System.currentTimeMillis().toString())
    }
    val out = File(dir, "java_${System.currentTimeMillis()}_${Thread.currentThread().id}.json")
    out.writeText(obj.toString())
  }

  private fun JSONObject.toMap(): Map<String, Any?> {
    val map = HashMap<String, Any?>()
    val keys = keys()
    while (keys.hasNext()) {
      val key = keys.next()
      map[key] = when (val v = get(key)) {
        is JSONObject -> v.toMap()
        is JSONArray -> v.toList()
        JSONObject.NULL -> null
        else -> v
      }
    }
    return map
  }

  private fun JSONArray.toList(): List<Any?> {
    val list = ArrayList<Any?>(length())
    for (i in 0 until length()) {
      list += when (val v = get(i)) {
        is JSONObject -> v.toMap()
        is JSONArray -> v.toList()
        JSONObject.NULL -> null
        else -> v
      }
    }
    return list
  }
}

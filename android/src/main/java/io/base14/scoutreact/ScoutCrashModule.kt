package io.base14.scoutreact

import android.content.Context
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
      ScoutCrashInstaller.installIfNeeded(appContext.reactContext ?: return@OnCreate)
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

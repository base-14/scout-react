package io.base14.scoutreact

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.security.MessageDigest
import java.util.UUID

class ScoutCrashModule : Module() {
  private var anrWatchdog: ScoutAnrWatchdog? = null

  override fun definition() = ModuleDefinition {
    Name("ScoutCrash")

    Events("ScoutAnr")

    OnCreate {
      val ctx = appContext.reactContext ?: return@OnCreate
      ScoutCrashInstaller.installIfNeeded(ctx)
      val dir = java.io.File(ctx.filesDir, "scout-crash/pending").apply { mkdirs() }
      ScoutNdkSignalHandler.installIfNeeded(dir.absolutePath)
      ScoutNativeContextPusher.install(ctx)
      ScoutExitInfoCollector.drain(ctx, dir)
    }

    OnDestroy {
      anrWatchdog?.stop()
      anrWatchdog = null
    }

    AsyncFunction("startAnrDetection") { thresholdMs: Int ->
      android.util.Log.i("ScoutAnrWatchdog", "startAnrDetection JS->native thresholdMs=$thresholdMs")
      if (thresholdMs <= 0) return@AsyncFunction
      anrWatchdog?.stop()
      val wd = ScoutAnrWatchdog(thresholdMs.toLong()) { duration, source ->
        android.util.Log.w("ScoutAnrWatchdog", "callback firing — source=$source duration=${duration}ms")
        val dump = ScoutThreadDumpCollector.capture()
        val payload = HashMap<String, Any>()
        payload["durationMs"] = duration
        payload["thresholdMs"] = thresholdMs.toLong()
        payload["source"] = source
        dump["main_thread_stack"]?.let { payload["mainThreadStack"] = it }
        dump["threads_json"]?.let { payload["threadsJson"] = it }
        dump["thread_count"]?.let { payload["threadCount"] = it }
        try {
          this@ScoutCrashModule.sendEvent("ScoutAnr", payload)
          android.util.Log.i("ScoutAnrWatchdog", "sendEvent OK source=$source")
        } catch (t: Throwable) {
          android.util.Log.e("ScoutAnrWatchdog", "sendEvent FAILED: $t")
        }
      }
      anrWatchdog = wd
      wd.start()
    }

    AsyncFunction("stopAnrDetection") { ->
      anrWatchdog?.stop()
      anrWatchdog = null
    }

    AsyncFunction("notifyJsAlive") { ->
      anrWatchdog?.notifyJsAlive()
    }

    AsyncFunction("setMaxTombstoneBytes") { bytes: Int ->
      ScoutExitInfoCollector.maxTombstoneBytes = bytes.coerceAtLeast(4096)
    }

    AsyncFunction("__debugBlockMainThread") { durationMs: Int ->
      val ms = durationMs.coerceIn(0, 30_000).toLong()
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        try {
          Thread.sleep(ms)
        } catch (_: InterruptedException) {
        }
      }
    }

    AsyncFunction("getCpuTicks") { ->
      try {
        val pid = android.os.Process.myPid()
        val statLine = java.io.File("/proc/$pid/stat").readText().trim().split(" ")
        val utime = statLine[13].toLong()
        val stime = statLine[14].toLong()
        (utime + stime).toDouble()
      } catch (_: Throwable) {
        -1.0
      }
    }

    AsyncFunction("isDeviceCompromised") { ->
      try {
        if (android.os.Build.TAGS?.contains("test-keys") == true) return@AsyncFunction true
        val rootPaths = arrayOf(
          "/system/bin/su", "/system/xbin/su", "/sbin/su",
          "/system/app/Superuser.apk", "/data/local/su",
          "/data/local/bin/su", "/data/local/xbin/su",
          "/system/sd/xbin/su", "/system/bin/failsafe/su",
          "/su/bin/su", "/sbin/.magisk", "/cache/.disable_magisk",
          "/dev/.magisk.unblock",
        )
        for (path in rootPaths) {
          if (java.io.File(path).exists()) return@AsyncFunction true
        }
        val ctx = appContext.reactContext
        if (ctx != null) {
          val pm = ctx.packageManager
          val rootPackages = arrayOf(
            "com.devadvance.rootcloak", "com.devadvance.rootcloakplus",
            "com.koushikdutta.superuser", "com.thirdparty.superuser",
            "eu.chainfire.supersu", "com.noshufou.android.su",
            "com.topjohnwu.magisk",
          )
          for (pkg in rootPackages) {
            try {
              pm.getPackageInfo(pkg, 0)
              return@AsyncFunction true
            } catch (_: Throwable) {
            }
          }
        }
        false
      } catch (_: Throwable) {
        false
      }
    }

    AsyncFunction("getBatteryDischargeRate") { ->
      try {
        val ctx = appContext.reactContext ?: return@AsyncFunction null
        val bm = ctx.getSystemService(android.content.Context.BATTERY_SERVICE)
          as? android.os.BatteryManager ?: return@AsyncFunction null
        val current = bm.getLongProperty(android.os.BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
        if (current == Long.MIN_VALUE || current == 0L) null else current
      } catch (_: Throwable) {
        null
      }
    }

    AsyncFunction("getNdkBuildId") { ->
      try {
        val ctx = appContext.reactContext ?: return@AsyncFunction null
        val abi = android.os.Build.SUPPORTED_ABIS?.firstOrNull() ?: return@AsyncFunction null
        val libDir = ctx.applicationInfo.nativeLibraryDir
        val soFile = java.io.File(libDir, "libscout_signal_handler.so")
        if (soFile.exists()) {
          val viaFile = ScoutNdkBuildId.readFile(soFile.absolutePath)
          if (viaFile != null) return@AsyncFunction viaFile
        }
        val apkPath = ctx.applicationInfo.sourceDir ?: return@AsyncFunction null
        ScoutNdkBuildId.readFromApk(apkPath, "lib/$abi/libscout_signal_handler.so")
      } catch (_: Throwable) {
        null
      }
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

    AsyncFunction("setBreadcrumbs") { json: String ->
      ScoutNdkSignalHandler.setBreadcrumbsIfLoaded(json)
    }

    AsyncFunction("notifySessionRotated") { ->
      ScoutNativeContextPusher.notifySessionRotated()
    }

    AsyncFunction("setSessionContext") { sessionId: String, sessionStartedAt: String ->
      ScoutNdkSignalHandler.setSessionContextIfLoaded(sessionId, sessionStartedAt)
    }


    AsyncFunction("getProcessStartTimeMillis") { ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        val uptimeAtStart = Process.getStartUptimeMillis()
        val bootEpoch = System.currentTimeMillis() - SystemClock.uptimeMillis()
        (bootEpoch + uptimeAtStart).toDouble()
      } else {
        System.currentTimeMillis().toDouble()
      }
    }
  }
}

private object ScoutNativeContextPusher {
  private const val PREFS = "scout_crash_state"
  private const val KEY_APP_UUID = "app_uuid"
  private const val KEY_LAUNCHES_SINCE_CRASH = "launches_since_last_crash"
  private const val KEY_SESSIONS_SINCE_CRASH = "sessions_since_last_crash"
  private const val KEY_ACTIVE_SINCE_CRASH = "active_since_last_crash_secs"
  private const val KEY_BG_SINCE_CRASH = "bg_since_last_crash_secs"
  @Volatile private var installed = false
  @Volatile private var appCtx: Context? = null

  private val activeTimeMs = java.util.concurrent.atomic.AtomicLong(0L)
  private val backgroundTimeMs = java.util.concurrent.atomic.AtomicLong(0L)
  private val activeSinceLastCrashMs = java.util.concurrent.atomic.AtomicLong(0L)
  private val backgroundSinceLastCrashMs = java.util.concurrent.atomic.AtomicLong(0L)
  private var launchesSinceLastCrash = 0
  private var sessionsSinceLaunch = 0
  private var currentlyForeground = false
  private var lastTransitionElapsedMs = 0L

  fun install(ctx: Context) {
    if (installed) return
    installed = true
    appCtx = ctx.applicationContext
    try {
      pushStaticContext(ctx)
      pushExtendedContext(ctx)
      primeLaunchCounter(ctx)
      primeSessionCounters(ctx)
      registerForegroundTracking(ctx)
    } catch (_: Throwable) {
    }
  }

  fun notifySessionRotated() {
    val ctx = appCtx ?: return
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val sinceLastCrash = prefs.getInt(KEY_SESSIONS_SINCE_CRASH, 0) + 1
    prefs.edit().putInt(KEY_SESSIONS_SINCE_CRASH, sinceLastCrash).apply()
    sessionsSinceLaunch += 1
    ScoutNdkSignalHandler.setSessionCountersIfLoaded(sessionsSinceLaunch, sinceLastCrash)
  }

  private fun primeLaunchCounter(ctx: Context) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    launchesSinceLastCrash = prefs.getInt(KEY_LAUNCHES_SINCE_CRASH, 0) + 1
    activeSinceLastCrashMs.set(prefs.getInt(KEY_ACTIVE_SINCE_CRASH, 0).toLong() * 1000L)
    backgroundSinceLastCrashMs.set(prefs.getInt(KEY_BG_SINCE_CRASH, 0).toLong() * 1000L)
    prefs.edit().putInt(KEY_LAUNCHES_SINCE_CRASH, launchesSinceLastCrash).apply()
    pushActivityTimers()
  }

  private fun primeSessionCounters(ctx: Context) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val sinceLastCrash = prefs.getInt(KEY_SESSIONS_SINCE_CRASH, 0) + 1
    prefs.edit().putInt(KEY_SESSIONS_SINCE_CRASH, sinceLastCrash).apply()
    sessionsSinceLaunch = 1
    ScoutNdkSignalHandler.setSessionCountersIfLoaded(sessionsSinceLaunch, sinceLastCrash)
  }

  private fun pushActivityTimers() {
    ScoutNdkSignalHandler.setActivityTimersIfLoaded(
      activeSecs = (activeTimeMs.get() / 1000L).toInt(),
      backgroundSecs = (backgroundTimeMs.get() / 1000L).toInt(),
      activeSinceLastCrashSecs = (activeSinceLastCrashMs.get() / 1000L).toInt(),
      backgroundSinceLastCrashSecs = (backgroundSinceLastCrashMs.get() / 1000L).toInt(),
      launchesSinceLastCrash = launchesSinceLastCrash,
    )
  }

  @Synchronized
  private fun transitionTo(foreground: Boolean) {
    val now = SystemClock.elapsedRealtime()
    val elapsed = (now - lastTransitionElapsedMs).coerceAtLeast(0)
    if (currentlyForeground) {
      activeTimeMs.addAndGet(elapsed)
      activeSinceLastCrashMs.addAndGet(elapsed)
    } else {
      backgroundTimeMs.addAndGet(elapsed)
      backgroundSinceLastCrashMs.addAndGet(elapsed)
    }
    appCtx?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()
      ?.putInt(KEY_ACTIVE_SINCE_CRASH, (activeSinceLastCrashMs.get() / 1000L).toInt())
      ?.putInt(KEY_BG_SINCE_CRASH, (backgroundSinceLastCrashMs.get() / 1000L).toInt())
      ?.apply()
    currentlyForeground = foreground
    lastTransitionElapsedMs = now
    ScoutNdkSignalHandler.setForegroundIfLoaded(foreground, foreground)
    pushActivityTimers()
  }

  private fun pushStaticContext(ctx: Context) {
    val pm = ctx.packageManager
    val pkg = ctx.packageName ?: ""
    val info = try { pm.getPackageInfo(pkg, 0) } catch (_: Throwable) { null }
    val bundleVer = info?.versionName ?: ""
    val osVer = Build.VERSION.RELEASE ?: ""
    val osBuild = Build.DISPLAY ?: Build.ID ?: ""
    val model = Build.MODEL ?: ""
    val abi = Build.SUPPORTED_ABIS?.firstOrNull() ?: ""
    val buildType = if ((ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      "debug"
    } else {
      "release"
    }
    ScoutNdkSignalHandler.setContextIfLoaded(
      model = model,
      osVersion = osVer,
      osBuild = osBuild,
      bundleVersion = bundleVer,
      packageName = pkg,
      buildType = buildType,
      abi = abi,
    )
    val fingerprint = Build.FINGERPRINT ?: ""
    if (fingerprint.isNotEmpty()) {
      ScoutNdkSignalHandler.setBuildFingerprintIfLoaded(fingerprint)
    }
  }

  private fun pushExtendedContext(ctx: Context) {
    val pm = ctx.packageManager
    val appName = try {
      pm.getApplicationLabel(ctx.applicationInfo).toString()
    } catch (_: Throwable) { "" }
    val deviceAppHash = computeDeviceAppHash(ctx)
    val appUuid = persistedAppUuid(ctx)
    val processName = try { readProcSelfCmdline() } catch (_: Throwable) { "" }
    val appExecutable = ctx.applicationInfo.processName ?: ""
    val executablePath = ctx.applicationInfo.nativeLibraryDir ?: ""
    val timeZone = try { java.util.TimeZone.getDefault().id ?: "" } catch (_: Throwable) { "" }
    val parentPid = try { android.os.Process.myPid() } catch (_: Throwable) { -1 }
    val parentProcName = ""
    val appStartTimeSecs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      (System.currentTimeMillis() - SystemClock.uptimeMillis() + android.os.Process.getStartUptimeMillis()) / 1000L
    } else {
      System.currentTimeMillis() / 1000L
    }
    val systemBootTimeSecs = (System.currentTimeMillis() / 1000L) - (SystemClock.elapsedRealtime() / 1000L)
    ScoutNdkSignalHandler.setExtendedContextIfLoaded(
      appName = appName,
      deviceAppHash = deviceAppHash,
      appUuid = appUuid,
      processName = processName,
      appExecutable = appExecutable,
      executablePath = executablePath,
      timeZone = timeZone,
      parentProcName = parentProcName,
      parentPid = parentPid,
      appStartTimeSecs = appStartTimeSecs,
      systemBootTimeSecs = systemBootTimeSecs,
    )
    pushMemoryAndStorage(ctx)
  }

  private fun readProcSelfCmdline(): String = try {
    java.io.File("/proc/self/cmdline").readBytes()
      .takeWhile { it != 0.toByte() }
      .toByteArray()
      .toString(Charsets.UTF_8)
  } catch (_: Throwable) { "" }

  private fun pushMemoryAndStorage(ctx: Context) {
    val rt = Runtime.getRuntime()
    val memorySize = try {
      rt.maxMemory()
    } catch (_: Throwable) { -1L }
    val stat = try {
      android.os.StatFs(ctx.filesDir.absolutePath)
    } catch (_: Throwable) { null }
    val storageSize = stat?.let { it.blockCountLong * it.blockSizeLong } ?: -1L
    val storageFree = stat?.let { it.availableBlocksLong * it.blockSizeLong } ?: -1L
    ScoutNdkSignalHandler.setMemoryInfoIfLoaded(memorySize, storageSize, storageFree)
  }

  private fun persistedAppUuid(ctx: Context): String {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val existing = prefs.getString(KEY_APP_UUID, null)
    if (!existing.isNullOrEmpty()) return existing
    val fresh = UUID.randomUUID().toString()
    prefs.edit().putString(KEY_APP_UUID, fresh).apply()
    return fresh
  }

  private fun computeDeviceAppHash(ctx: Context): String {
    return try {
      val androidId = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
      val seed = "${ctx.packageName}:$androidId"
      val md = MessageDigest.getInstance("SHA-256")
      val digest = md.digest(seed.toByteArray(Charsets.UTF_8))
      digest.joinToString("") { "%02x".format(it) }.substring(0, 32)
    } catch (_: Throwable) {
      ""
    }
  }

  private fun registerForegroundTracking(ctx: Context) {
    val app = ctx.applicationContext as? Application ?: return
    lastTransitionElapsedMs = SystemClock.elapsedRealtime()
    app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      private var started = 0
      override fun onActivityStarted(a: Activity) {
        started += 1
        if (started == 1) transitionTo(foreground = true)
      }
      override fun onActivityStopped(a: Activity) {
        if (started > 0) started -= 1
        if (started == 0) transitionTo(foreground = false)
      }
      override fun onActivityCreated(a: Activity, b: Bundle?) {}
      override fun onActivityResumed(a: Activity) {}
      override fun onActivityPaused(a: Activity) {}
      override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
      override fun onActivityDestroyed(a: Activity) {}
    })
  }
}

private object ScoutExitInfoCollector {
  private const val PREFS = "scout_exit_info"
  private const val KEY_LAST_TIMESTAMP = "last_timestamp"
  @Volatile var maxTombstoneBytes: Int = 131072

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
      // The watermark advances over every record, benign ones included, so a
      // dropped exit is never re-examined on the next launch.
      if (info.timestamp > newest) newest = info.timestamp
      val crashType = ScoutExitInfoClassifier.crashTypeFor(reasonName(info.reason))
        ?: continue
      try {
        writeReport(dir, info, crashType)
      } catch (_: Throwable) {

      }
    }
    if (newest > lastTs) {
      prefs.edit().putLong(KEY_LAST_TIMESTAMP, newest).apply()
    }
  }

  private fun writeReport(dir: File, info: ApplicationExitInfo, crashType: String) {
    val obj = JSONObject().apply {
      put("crash.type", crashType)
      put("crash.source", ScoutExitInfoClassifier.SOURCE)
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
          stream.readBytes().toString(Charsets.UTF_8)
        } ?: ""
      } catch (_: Throwable) {
        ""
      }
      if (trace.isNotEmpty()) {
        val cap = ScoutExitInfoCollector.maxTombstoneBytes
        put("crash.tombstone", if (cap > 0 && trace.length > cap) trace.substring(0, cap) else trace)
      }
      // ISO-8601 for parity with every other crash path (the numeric form
      // stays available as crash.death_timestamp_ms).
      put("crash.timestamp", ScoutTimeFormat.isoUtc(info.timestamp))
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

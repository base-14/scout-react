package io.base14.scoutreact

object ScoutNdkSignalHandler {
  @Volatile private var loaded = false

  fun installIfNeeded(crashDir: String) {
    if (!loaded) {
      try {
        System.loadLibrary("scout_signal_handler")
        loaded = true
      } catch (t: Throwable) {
        return
      }
    }
    try {
      install(crashDir)
    } catch (_: Throwable) {
      
    }
  }

  @JvmStatic
  external fun install(crashDir: String)

  fun setBreadcrumbsIfLoaded(json: String) {
    if (!loaded) return
    try {
      val quoted = org.json.JSONObject.quote(json)
      setBreadcrumbs(quoted)
    } catch (_: Throwable) {
    }
  }

  @JvmStatic
  external fun setBreadcrumbs(quoted: String)

  fun setContextIfLoaded(
    model: String,
    osVersion: String,
    osBuild: String,
    bundleVersion: String,
    packageName: String,
    buildType: String,
    abi: String,
  ) {
    if (!loaded) return
    try {
      setContext(model, osVersion, osBuild, bundleVersion, packageName, buildType, abi)
    } catch (_: Throwable) {
    }
  }

  fun setExtendedContextIfLoaded(
    appName: String,
    deviceAppHash: String,
    appUuid: String,
    processName: String,
    appExecutable: String,
    executablePath: String,
    timeZone: String,
    parentProcName: String,
    parentPid: Int,
    appStartTimeSecs: Long,
    systemBootTimeSecs: Long,
  ) {
    if (!loaded) return
    try {
      setExtendedContext(
        appName,
        deviceAppHash,
        appUuid,
        processName,
        appExecutable,
        executablePath,
        timeZone,
        parentProcName,
        parentPid,
        appStartTimeSecs,
        systemBootTimeSecs,
      )
    } catch (_: Throwable) {
    }
  }

  fun setMemoryInfoIfLoaded(
    memorySizeBytes: Long,
    storageSizeBytes: Long,
    storageFreeBytes: Long,
  ) {
    if (!loaded) return
    try {
      setMemoryInfo(memorySizeBytes, storageSizeBytes, storageFreeBytes)
    } catch (_: Throwable) {
    }
  }


  fun setForegroundIfLoaded(inForeground: Boolean, active: Boolean) {
    if (!loaded) return
    try {
      setForeground(inForeground, active)
    } catch (_: Throwable) {
    }
  }

  fun setActivityTimersIfLoaded(
    activeSecs: Int,
    backgroundSecs: Int,
    activeSinceLastCrashSecs: Int,
    backgroundSinceLastCrashSecs: Int,
    launchesSinceLastCrash: Int,
  ) {
    if (!loaded) return
    try {
      setActivityTimers(
        activeSecs,
        backgroundSecs,
        activeSinceLastCrashSecs,
        backgroundSinceLastCrashSecs,
        launchesSinceLastCrash,
      )
    } catch (_: Throwable) {
    }
  }

  fun setSessionCountersIfLoaded(sinceLaunch: Int, sinceLastCrash: Int) {
    if (!loaded) return
    try {
      setSessionCounters(sinceLaunch, sinceLastCrash)
    } catch (_: Throwable) {
    }
  }

  fun setSessionContextIfLoaded(sessionId: String, sessionStartedAt: String) {
    if (!loaded) return
    try {
      setSessionContext(sessionId, sessionStartedAt)
    } catch (_: Throwable) {
    }
  }

  @JvmStatic
  external fun setContext(
    model: String,
    osVersion: String,
    osBuild: String,
    bundleVersion: String,
    packageName: String,
    buildType: String,
    abi: String,
  )

  @JvmStatic
  external fun setExtendedContext(
    appName: String,
    deviceAppHash: String,
    appUuid: String,
    processName: String,
    appExecutable: String,
    executablePath: String,
    timeZone: String,
    parentProcName: String,
    parentPid: Int,
    appStartTimeSecs: Long,
    systemBootTimeSecs: Long,
  )

  @JvmStatic
  external fun setMemoryInfo(
    memorySizeBytes: Long,
    storageSizeBytes: Long,
    storageFreeBytes: Long,
  )

  @JvmStatic
  external fun setForeground(inForeground: Boolean, active: Boolean)

  @JvmStatic
  external fun setActivityTimers(
    activeSecs: Int,
    backgroundSecs: Int,
    activeSinceLastCrashSecs: Int,
    backgroundSinceLastCrashSecs: Int,
    launchesSinceLastCrash: Int,
  )

  @JvmStatic
  external fun setSessionCounters(sinceLaunch: Int, sinceLastCrash: Int)

  @JvmStatic
  external fun setSessionContext(sessionId: String, sessionStartedAt: String)
}

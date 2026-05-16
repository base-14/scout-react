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
}

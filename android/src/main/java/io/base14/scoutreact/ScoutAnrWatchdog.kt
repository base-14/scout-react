package io.base14.scoutreact

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log

class ScoutAnrWatchdog(
  private val thresholdMs: Long,
  private val onAnrDetected: (Long, String) -> Unit,
) {
  private var watchdogThread: Thread? = null
  @Volatile private var running = false
  @Volatile private var lastMainHeartbeatMs = 0L
  @Volatile private var lastJsHeartbeatMs = 0L
  private val mainHandler = Handler(Looper.getMainLooper())

  fun start() {
    running = true
    val now = SystemClock.uptimeMillis()
    lastMainHeartbeatMs = now
    lastJsHeartbeatMs = now
    val pollMs = (thresholdMs / 10).coerceAtLeast(200)
    Log.i(TAG, "start threshold=${thresholdMs}ms poll=${pollMs}ms")
    watchdogThread = Thread({
      var inHangMain = false
      var inHangJs = false
      var pendingMainHeartbeat = false
      var cycle = 0L
      while (running) {
        if (!pendingMainHeartbeat) {
          pendingMainHeartbeat = true
          mainHandler.post {
            lastMainHeartbeatMs = SystemClock.uptimeMillis()
            pendingMainHeartbeat = false
          }
        }
        try {
          Thread.sleep(pollMs)
        } catch (_: InterruptedException) {
          break
        }
        val nowMs = SystemClock.uptimeMillis()
        val elapsedMain = nowMs - lastMainHeartbeatMs
        val elapsedJs = nowMs - lastJsHeartbeatMs
        cycle++
        if (cycle % 10 == 0L || elapsedMain > pollMs * 2 || elapsedJs > pollMs * 2) {
          Log.i(
            TAG,
            "cycle=$cycle main=${elapsedMain}ms js=${elapsedJs}ms inHang(m/j)=$inHangMain/$inHangJs",
          )
        }
        if (elapsedMain >= thresholdMs) {
          if (!inHangMain) {
            inHangMain = true
            Log.w(TAG, "MAIN THREAD ANR elapsed=${elapsedMain}ms")
            fireSafe(elapsedMain, "main")
          }
        } else if (elapsedMain < pollMs) {
          if (inHangMain) Log.i(TAG, "main hang ended")
          inHangMain = false
        }
        if (elapsedJs >= thresholdMs) {
          if (!inHangJs) {
            inHangJs = true
            Log.w(TAG, "JS THREAD ANR elapsed=${elapsedJs}ms")
            fireSafe(elapsedJs, "js")
          }
        } else if (elapsedJs < pollMs * 4) {
          if (inHangJs) Log.i(TAG, "js hang ended")
          inHangJs = false
        }
      }
      Log.i(TAG, "watchdog loop exited")
    }, "scout-anr-watchdog")
    watchdogThread?.start()
  }

  fun notifyJsAlive() {
    lastJsHeartbeatMs = SystemClock.uptimeMillis()
  }

  fun stop() {
    Log.i(TAG, "stop")
    running = false
    watchdogThread?.interrupt()
    watchdogThread = null
  }

  private fun fireSafe(elapsed: Long, source: String) {
    try {
      onAnrDetected(elapsed, source)
    } catch (t: Throwable) {
      Log.e(TAG, "onAnrDetected threw: $t")
    }
  }

  companion object {
    private const val TAG = "ScoutAnrWatchdog"
  }
}

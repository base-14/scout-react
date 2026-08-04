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
    // Fixed 100ms cadence: detection lands at threshold + ~0.1s instead of
    // threshold + up to a full poll (500ms at the default 5s threshold).
    val pollMs = POLL_INTERVAL_MS.coerceAtMost(thresholdMs)
    Log.i(TAG, "start threshold=${thresholdMs}ms poll=${pollMs}ms")
    watchdogThread = Thread({
      val mainDetector = ScoutHangDetector(thresholdMs, MAIN_RECOVERY_MS)
      val jsDetector = ScoutHangDetector(thresholdMs, JS_RECOVERY_MS)
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
        // 100ms polling makes a per-cycle log far too chatty; log once a
        // second, or whenever a thread is visibly lagging.
        if (cycle % LOG_EVERY_N_CYCLES == 0L ||
          elapsedMain > MAIN_RECOVERY_MS ||
          elapsedJs > JS_RECOVERY_MS
        ) {
          Log.i(
            TAG,
            "cycle=$cycle main=${elapsedMain}ms js=${elapsedJs}ms " +
              "inHang(m/j)=${mainDetector.inHang}/${jsDetector.inHang}",
          )
        }
        if (mainDetector.onSample(elapsedMain)) {
          Log.w(TAG, "MAIN THREAD ANR elapsed=${elapsedMain}ms")
          fireSafe(elapsedMain, "main")
        }
        if (jsDetector.onSample(elapsedJs)) {
          Log.w(TAG, "JS THREAD ANR elapsed=${elapsedJs}ms")
          fireSafe(elapsedJs, "js")
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
    private const val POLL_INTERVAL_MS = 100L
    /** Elapsed-since-ping below which the main thread counts as recovered. */
    private const val MAIN_RECOVERY_MS = 500L
    /**
     * The JS thread heartbeats far less often than the main looper, so it
     * needs a slacker recovery window to avoid flapping in and out of hang.
     */
    private const val JS_RECOVERY_MS = 2000L
    /** 50 cycles × 100ms = one heartbeat log every 5s, as before. */
    private const val LOG_EVERY_N_CYCLES = 50L
  }
}

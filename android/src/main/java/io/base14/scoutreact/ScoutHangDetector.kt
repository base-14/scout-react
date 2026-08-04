package io.base14.scoutreact

/**
 * Single-fire hang detection for one thread.
 *
 * Fires once when the thread has been unresponsive for [thresholdMs] and
 * re-arms only after it recovers — a hang produces one ANR report, not one
 * per poll. Kept free of Android imports so the timing rules are unit-tested
 * on the JVM (see `android/unit-tests`) instead of by staring at a device.
 *
 * [recoveryMs] is the elapsed-since-ping value below which the thread counts
 * as healthy again. It is an absolute duration rather than a multiple of the
 * poll interval, so tightening the poll cadence cannot silently change how
 * eagerly the detector re-arms.
 */
internal class ScoutHangDetector(
  private val thresholdMs: Long,
  private val recoveryMs: Long,
) {
  var inHang: Boolean = false
    private set

  /**
   * Feeds one sample of "how long since this thread last answered".
   * Returns true exactly on the sample that opens a new hang.
   */
  fun onSample(elapsedMs: Long): Boolean {
    if (elapsedMs >= thresholdMs) {
      if (inHang) return false
      inHang = true
      return true
    }
    if (elapsedMs < recoveryMs) inHang = false
    return false
  }
}

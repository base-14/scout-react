package io.base14.scoutreact

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Timing rules of the ANR watchdog, ported from scout-flutter's
 * `AnrWatchdogTest.kt`. The watchdog samples "how long since this thread last
 * answered" every 100ms; these are the decisions it makes on each sample.
 */
class HangDetectorTest {
  private fun detector() = ScoutHangDetector(thresholdMs = 5000, recoveryMs = 500)

  @Test
  fun `does not fire below the threshold`() {
    val d = detector()
    for (elapsed in longArrayOf(0, 100, 2500, 4900, 4999)) {
      assertFalse("elapsed=$elapsed", d.onSample(elapsed))
    }
    assertFalse(d.inHang)
  }

  @Test
  fun `fires exactly at the threshold`() {
    val d = detector()
    assertTrue(d.onSample(5000))
    assertTrue(d.inHang)
  }

  @Test
  fun `fires once per hang, not once per poll`() {
    // A 3s hang at a 100ms cadence produces ~30 samples over threshold. One
    // ANR report, not thirty.
    val d = detector()
    var fires = 0
    var elapsed = 5000L
    repeat(30) {
      if (d.onSample(elapsed)) fires++
      elapsed += 100
    }
    assertTrue("expected a single report, got $fires", fires == 1)
  }

  @Test
  fun `re-arms after the thread recovers`() {
    val d = detector()
    assertTrue(d.onSample(6000))
    assertFalse("still hung", d.onSample(400)) // recovered: below recoveryMs
    assertFalse(d.inHang)
    assertTrue("a second hang must report again", d.onSample(5200))
  }

  @Test
  fun `stays armed while elapsed sits between recovery and threshold`() {
    // The grey zone: the thread answered, but sluggishly. It must not count
    // as recovered yet, or a stuttering thread would re-report repeatedly.
    val d = detector()
    assertTrue(d.onSample(5000))
    assertFalse(d.onSample(600))
    assertTrue("must still be considered hung", d.inHang)
    assertFalse("no duplicate report", d.onSample(5000))
  }

  @Test
  fun `detection latency is bounded by one poll interval`() {
    // Simulated 100ms polling across a hang that starts at t=0: the first
    // sample at or past the threshold is what fires, so detection lands
    // within one poll of the threshold.
    val d = detector()
    var firedAt = -1L
    var t = 0L
    while (t <= 6000) {
      if (d.onSample(t)) {
        firedAt = t
        break
      }
      t += 100
    }
    assertTrue("fired at ${firedAt}ms", firedAt in 5000..5100)
  }
}

package io.base14.scoutreact

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the exit-info crash classification, ported from scout-flutter's
 * `test/exit_info_filter_test.dart`.
 *
 * The benign list is the load-bearing half: swiping the app from recents,
 * Force Stop and self-exit are normal ways for a process to stop. Reporting
 * them inflates crash counts with ordinary user actions, which is what this
 * test exists to prevent regressing.
 */
class ExitInfoFilterTest {

  /** The only reasons that may ever produce a crash record. */
  private val crashClass = mapOf(
    "crash" to "jvm_crash",
    "crash_native" to "native_crash",
    "anr" to "anr",
    "low_memory" to "low_memory",
  )

  /** Every other exit reason the OS can report. None may be emitted. */
  private val benign = listOf(
    "user_requested",
    "user_stopped",
    "exit_self",
    "signaled",
    "permission_change",
    "excessive_resource_usage",
    "initialization_failure",
    "dependency_died",
    "package_updated",
    "package_state_change",
    "freezer",
    "other",
    "unknown",
  )

  @Test
  fun `crash-class reasons map to their flutter crash type`() {
    for ((reasonName, expectedType) in crashClass) {
      assertEquals(
        "reason '$reasonName' must report crash.type '$expectedType'",
        expectedType,
        ScoutExitInfoClassifier.crashTypeFor(reasonName),
      )
      assertTrue(reasonName, ScoutExitInfoClassifier.isCrashClass(reasonName))
    }
  }

  @Test
  fun `benign exits are never crashes`() {
    for (reasonName in benign) {
      assertNull(
        "benign exit '$reasonName' must not produce a crash record",
        ScoutExitInfoClassifier.crashTypeFor(reasonName),
      )
      assertFalse(reasonName, ScoutExitInfoClassifier.isCrashClass(reasonName))
    }
  }

  @Test
  fun `the crash-class set is exactly these four reasons`() {
    val classified = (crashClass.keys + benign).filter {
      ScoutExitInfoClassifier.isCrashClass(it)
    }
    assertEquals(
      setOf("crash", "crash_native", "anr", "low_memory"),
      classified.toSet(),
    )
  }

  @Test
  fun `unknown future reason names are treated as benign`() {
    // reasonName() falls back to "reason_<n>" for codes added by later
    // Android versions; an unrecognised reason must not become a crash.
    assertNull(ScoutExitInfoClassifier.crashTypeFor("reason_42"))
    assertNull(ScoutExitInfoClassifier.crashTypeFor(""))
  }

  @Test
  fun `crash source identifies the detection path`() {
    // Dashboards previously filtered crash.type = 'exit_info'; that moved to
    // crash.source so crash.type can carry the real reason.
    assertEquals("exit_info", ScoutExitInfoClassifier.SOURCE)
  }
}

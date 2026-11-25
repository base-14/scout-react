package io.base14.scoutreact

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the release a crash report names. The JS reader counts a replayed
 * crash under the report's own `crash.app_version` + `crash.application_build_version`
 * when both are present and differ from the running app's `app.version` /
 * `app.build`, so the build string here must be exactly what
 * react-native-device-info's `getBuildNumber()` gives the running app:
 * `Integer.toString(PackageInfo.versionCode)`.
 */
class CrashReleaseTest {

  @Test
  fun `build is the version code as getBuildNumber formats it`() {
    assertEquals("42", ScoutCrashRelease.buildOf(42L))
    // getBuildNumber reads the int versionCode: the low 32 bits of the long
    // version code, so a versionCodeMajor never shows up in app.build.
    assertEquals("7", ScoutCrashRelease.buildOf((3L shl 32) or 7L))
  }

  @Test
  fun `a release needs both a version and a build`() {
    assertEquals(ScoutRelease("1.2.0", "120"), ScoutCrashRelease.of("1.2.0", 120L))
    assertEquals(ScoutRelease("1.2.0", "120"), ScoutCrashRelease.of(" 1.2.0 ", 120L))
    assertNull(ScoutCrashRelease.of(null, 120L))
    assertNull(ScoutCrashRelease.of("  ", 120L))
    assertNull(ScoutCrashRelease.of("1.2.0", null))
  }

  @Test
  fun `report keys match the ones the iOS writers use`() {
    assertEquals(
      mapOf(
        "crash.app_version" to "1.2.0",
        "crash.application_version" to "1.2.0",
        "crash.application_build_version" to "120",
      ),
      ScoutCrashRelease.attributes(ScoutRelease("1.2.0", "120")),
    )
    assertTrue(ScoutCrashRelease.attributes(null).isEmpty())
  }

  // --- ApplicationExitInfo: the release of a process that is already gone ---

  private val v1 = ScoutRelease("1.0.0", "1")
  private val v2 = ScoutRelease("1.1.0", "2")
  private val main = "com.example.app"

  @Test
  fun `bookkeeping survives a round trip, odd version names included`() {
    val records = listOf(
      ScoutProcessRelease(1234, main, 1_000L, v1),
      ScoutProcessRelease(5678, "$main:remote", 2_000L, ScoutRelease("2.0 beta\t%1\nx", "9")),
    )
    assertEquals(records, ScoutProcessReleases.decode(ScoutProcessReleases.encode(records)))
  }

  @Test
  fun `garbage or missing bookkeeping decodes to nothing`() {
    assertTrue(ScoutProcessReleases.decode(null).isEmpty())
    assertTrue(ScoutProcessReleases.decode("").isEmpty())
    assertTrue(ScoutProcessReleases.decode("not\ta\trecord").isEmpty())
  }

  @Test
  fun `recording keeps only the newest records`() {
    var records = emptyList<ScoutProcessRelease>()
    for (i in 1..(ScoutProcessReleases.MAX_RECORDS + 5)) {
      records = ScoutProcessReleases.record(records, ScoutProcessRelease(i, main, i * 1_000L, v1))
    }
    assertEquals(ScoutProcessReleases.MAX_RECORDS, records.size)
    assertEquals(6, records.minOf { it.pid })
    assertEquals(ScoutProcessReleases.MAX_RECORDS + 5, records.maxOf { it.pid })
  }

  @Test
  fun `an exit gets the release its own process recorded at start`() {
    // 1.0.0 ran as pid 100 and crashed; 1.1.0 is draining the record now.
    val records = listOf(
      ScoutProcessRelease(100, main, 1_000L, v1),
      ScoutProcessRelease(200, main, 9_000L, v2),
    )
    assertEquals(v1, ScoutProcessReleases.releaseFor(records, 100, main, 5_000L, emptyList()))
  }

  @Test
  fun `an exit with no record of its own process stays unstamped`() {
    val records = listOf(ScoutProcessRelease(100, main, 1_000L, v1))
    // Different pid.
    assertNull(ScoutProcessReleases.releaseFor(records, 101, main, 5_000L, emptyList()))
    // Same pid, another process of the app.
    assertNull(ScoutProcessReleases.releaseFor(records, 100, "$main:remote", 5_000L, emptyList()))
    // Recorded after the death: a later process that reused the pid.
    assertNull(ScoutProcessReleases.releaseFor(records, 100, main, 500L, emptyList()))
  }

  @Test
  fun `a reused pid takes the newest process that started before the death`() {
    val records = listOf(
      ScoutProcessRelease(100, main, 1_000L, v1),
      ScoutProcessRelease(100, main, 6_000L, v2),
    )
    val earlierDeath = ScoutProcessReleases.Death(100, 4_000L)
    assertEquals(v2, ScoutProcessReleases.releaseFor(records, 100, main, 8_000L, listOf(earlierDeath)))
    assertEquals(v1, ScoutProcessReleases.releaseFor(records, 100, main, 4_000L, listOf(earlierDeath)))
  }

  @Test
  fun `a record whose process already died is never lent to a later process`() {
    // pid 100 ran 1.0.0 and died at 4000. A later process got pid 100 again but
    // died before it recorded anything (e.g. in Application.onCreate). Its
    // death must not be counted under 1.0.0.
    val records = listOf(ScoutProcessRelease(100, main, 1_000L, v1))
    val deaths = listOf(
      ScoutProcessReleases.Death(100, 4_000L),
      ScoutProcessReleases.Death(100, 8_000L),
    )
    assertNull(ScoutProcessReleases.releaseFor(records, 100, main, 8_000L, deaths))
    assertEquals(v1, ScoutProcessReleases.releaseFor(records, 100, main, 4_000L, deaths))
  }
}

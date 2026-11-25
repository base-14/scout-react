package io.base14.scoutreact

import java.net.URLDecoder
import java.net.URLEncoder

/** The app release a crash report was written by. */
internal data class ScoutRelease(val version: String, val build: String)

/**
 * Stamps crash reports with the release of the process that crashed.
 *
 * The JS reader counts a crash replayed on a later launch under the release
 * its report names (`crash.app_version` + `crash.application_build_version`)
 * instead of the release that happens to deliver it, so every writer has to
 * record both for the process that crashed. The keys and their format match
 * the iOS KSCrash and MetricKit writers.
 *
 * Free of Android imports so it can be unit-tested on the JVM.
 */
internal object ScoutCrashRelease {
  const val APP_VERSION = "crash.app_version"
  const val APPLICATION_VERSION = "crash.application_version"
  const val BUILD = "crash.application_build_version"

  /**
   * The build string the running app reports as `app.build`:
   * react-native-device-info's `getBuildNumber()` is
   * `Integer.toString(PackageInfo.versionCode)`, the low 32 bits of the long
   * version code. Anything else would never compare equal to it.
   */
  fun buildOf(longVersionCode: Long): String = longVersionCode.toInt().toString()

  /** Null unless both a version name and a version code are known. */
  fun of(versionName: String?, longVersionCode: Long?): ScoutRelease? {
    val version = versionName?.trim().orEmpty()
    if (version.isEmpty() || longVersionCode == null) return null
    return ScoutRelease(version, buildOf(longVersionCode))
  }

  /** The report keys for [release]; empty when it is unknown. */
  fun attributes(release: ScoutRelease?): Map<String, String> {
    if (release == null) return emptyMap()
    return mapOf(
      APP_VERSION to release.version,
      APPLICATION_VERSION to release.version,
      BUILD to release.build,
    )
  }
}

/** What a process of the app recorded about itself when it started. */
internal data class ScoutProcessRelease(
  val pid: Int,
  val processName: String,
  val startMs: Long,
  val release: ScoutRelease,
)

/**
 * `ApplicationExitInfo` describes a process that is already gone, and the OS
 * keeps no app version with it. Each process records its pid, name, start
 * time and release when the SDK starts; an exit record is matched back to the
 * process that wrote it. When there is no unambiguous match the record stays
 * unstamped (and is counted under the release that reads it, as before) rather
 * than being given a release that may not be its own.
 */
internal object ScoutProcessReleases {
  const val MAX_RECORDS = 16

  data class Death(val pid: Int, val timestampMs: Long)

  fun encode(records: List<ScoutProcessRelease>): String =
    records.joinToString("\n") { r ->
      listOf(
        r.pid.toString(),
        r.startMs.toString(),
        enc(r.processName),
        enc(r.release.version),
        enc(r.release.build),
      ).joinToString("\t")
    }

  fun decode(raw: String?): List<ScoutProcessRelease> {
    if (raw.isNullOrEmpty()) return emptyList()
    return raw.split('\n').mapNotNull { line ->
      try {
        val f = line.split('\t')
        if (f.size != 5) return@mapNotNull null
        ScoutProcessRelease(
          pid = f[0].toInt(),
          startMs = f[1].toLong(),
          processName = dec(f[2]),
          release = ScoutRelease(dec(f[3]), dec(f[4])),
        )
      } catch (_: Throwable) {
        null
      }
    }
  }

  /** Adds [entry], keeping the [MAX_RECORDS] most recently started. */
  fun record(records: List<ScoutProcessRelease>, entry: ScoutProcessRelease): List<ScoutProcessRelease> =
    (records + entry).sortedBy { it.startMs }.takeLast(MAX_RECORDS)

  /**
   * The release of the process [pid] / [processName] that died at [deathMs]:
   * the newest record for that pid and name started before the death, unless
   * [deaths] (the OS exit history) shows that recorded process dying earlier.
   * Then the one that died at [deathMs] reused the pid without recording
   * anything (it died before the SDK started), and its release is unknown.
   */
  fun releaseFor(
    records: List<ScoutProcessRelease>,
    pid: Int,
    processName: String,
    deathMs: Long,
    deaths: List<Death>,
  ): ScoutRelease? {
    val candidate = records
      .filter { it.pid == pid && it.processName == processName && it.startMs <= deathMs }
      .maxByOrNull { it.startMs }
      ?: return null
    val diedEarlier = deaths.any {
      it.pid == pid && it.timestampMs >= candidate.startMs && it.timestampMs < deathMs
    }
    return if (diedEarlier) null else candidate.release
  }

  private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")
  private fun dec(s: String): String = URLDecoder.decode(s, "UTF-8")
}

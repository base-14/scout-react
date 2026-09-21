package io.base14.scoutreact

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * ISO-8601 UTC formatting for crash timestamps.
 *
 * `java.time.Instant` would need API 26 or desugaring; the SDK ships to
 * minSdk 23, so this uses SimpleDateFormat (built fresh per call — the class
 * is not thread-safe and crash draining runs off the main thread).
 */
internal object ScoutTimeFormat {
  fun isoUtc(epochMillis: Long): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    fmt.timeZone = TimeZone.getTimeZone("UTC")
    return fmt.format(Date(epochMillis))
  }
}

/**
 * Decides which `ApplicationExitInfo` records are crashes.
 *
 * Deliberately free of Android imports so it can be unit-tested on the JVM
 * (see `android/unit-tests`). The caller maps the platform's `reason` int to
 * a name via [ScoutExitInfoCollector.reasonName]; this object owns the policy.
 *
 * Only {anr, jvm_crash, native_crash} are crash-class. Everything else is a
 * normal way for a process to stop — swiping the app from recents, Force
 * Stop, a self-exit — and reporting those inflates crash counts with user
 * actions. `low_memory` (the OS reclaiming a cached background process) is
 * not a crash either: Play Console and Crashlytics don't count it, and on
 * aggressive OEMs it outnumbers real crashes several times over. It is still
 * worth seeing, so it goes out as an `app_exit` span via [exitReasonFor].
 * Matches scout-flutter's `isCrashClassExitInfo` / `isReportedExitInfo`.
 */
internal object ScoutExitInfoClassifier {
  /** `crash.source` for records that came from the exit-info path. */
  const val SOURCE = "exit_info"

  /**
   * Key in a pending report naming the span the JS side must emit. Absent
   * (the default) means `native_crash`; [APP_EXIT] means an `app_exit` span
   * whose `crash.*` keys are renamed to `exit.*`.
   */
  const val SPAN_KEY = "scout.span"
  const val APP_EXIT = "app_exit"

  /**
   * The `crash.type` to report for an OS exit reason name, or null when the
   * exit was not a crash.
   */
  fun crashTypeFor(reasonName: String): String? = when (reasonName) {
    "crash" -> "jvm_crash"
    "crash_native" -> "native_crash"
    "anr" -> "anr"
    else -> null
  }

  /**
   * The `exit.reason` to report as an `app_exit` span for a non-crash exit,
   * or null when the exit is neither a crash nor worth a diagnostic span.
   */
  fun exitReasonFor(reasonName: String): String? = when (reasonName) {
    "low_memory" -> "low_memory"
    else -> null
  }

  /** True when a record describes a crash rather than a normal process exit. */
  fun isCrashClass(reasonName: String): Boolean = crashTypeFor(reasonName) != null
}

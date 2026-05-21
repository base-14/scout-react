# platform-design-web

A multi-tab music app — Songs / News / Profile / Settings — modeled on Flutter's
`platform_design` sample. Used to manually drive every `@base-14/scout-react`
signal type and verify it lands in a local OpenTelemetry collector.

## Run

From the package root (`scout-react/`):

```bash
make demo            # start collector + this app on http://127.0.0.1:5174
make demo-watch      # same, plus tail -f the collector log
make demo-open       # same, plus open the URL in your default browser
make demo-stop       # stop everything
```

The collector writes detailed export logs to `dev/collector.log`. Tail it while
you click around in Chrome:

```bash
tail -f dev/collector.log
```

## What's wired

| Surface | Signal |
|---|---|
| Initial load | `app_startup` span (cold) |
| Tab change | `screen_view`, `screen_load`, `view_session` spans |
| Tap a song / news article | `user_interaction` span, custom event |
| Diagnostics → log* | OTLP logs (DEBUG/INFO/WARN/ERROR) |
| Diagnostics → fetch buttons | `http.request` spans, `http.error` attribute on failures |
| Diagnostics → throw async / reject | `error` span, `error.count` metric, `error.handled=false` |
| Diagnostics → reportError | `error` span, `error.handled=true` |
| Diagnostics → long task / frozen frame | `long_task`, `frozen_frame` spans |
| Diagnostics → simulate crash | Hard reload — next load emits `app_crash` from the prior session marker |
| Tab away (visibilitychange) | `app_paused` span |
| Returning after 30 min | session rotation + `app_resumed` |
| Web vitals (LCP, CLS, INP, etc.) | `web.vital.*` histograms |

## Verify a "crash"

1. Open the app in Chrome at <http://127.0.0.1:5174>.
2. Click around — let Scout buffer breadcrumbs.
3. Click **simulate crash (reload)** in the Profile tab, OR:
   - Cmd-Q the browser entirely, OR
   - Use Chrome DevTools → Application → Service Workers → "kill" the page.
4. Reopen the URL. Watch `dev/collector.log` for an `app_crash` span whose
   `crash.previous_session_id` matches the previous run.

## Verify in Chrome DevTools

Open DevTools → Network → filter by `34318`. Every interaction should produce
`POST /v1/traces`, `/v1/metrics`, or `/v1/logs` with a `200 No Content` from the
collector.

# platform-design-mobile

Same UX as `platform-design-web`, but built with React Native + Expo so you can
run it on an iOS simulator and on an Android phone over USB. Uses
`@base14/scout-react/native`.

## One-time setup

```bash
cd examples/platform-design-mobile
npm install
```

You need an iOS toolchain for the iOS path and the Android SDK platform-tools
(`adb`) for the Android path. Standard React Native / Expo requirements.

## iOS simulator

The simulator shares the host network, so `http://localhost:34318` reaches the
collector directly.

```bash
# from scout_react/
make collector
make mobile-ios
```

Or manually:

```bash
cd examples/platform-design-mobile
npx expo run:ios
```

## Android device via USB

`localhost` on the device refers to the device itself, so you need to forward
the collector port back to the dev machine using `adb reverse`. The Makefile
target does this for you:

```bash
make collector
make mobile-android
```

Or manually:

```bash
adb reverse tcp:34318 tcp:34318
cd examples/platform-design-mobile
npx expo run:android --device
```

## What's wired

| Surface | Signal |
|---|---|
| App boot | `app_startup` (via `Scout.initialize`) |
| Tab change / nested push | `screen_view`, `view_session` spans (via `attachNavigationContainer`) |
| Pressable taps | `user_interaction` span, custom event |
| Diagnostics → log* / breadcrumb | OTLP logs + breadcrumb buffer |
| Diagnostics → fetch | `http.request` spans (RN fetch wrap) |
| Diagnostics → reportError | `error` span, `handled=true` |
| Diagnostics → throw async / unhandled rejection / fatal | `error` span, `handled=false`, attached breadcrumbs |
| AppState transitions | `app_paused`, `app_resumed`, session rotation |
| Force-kill the app | `app_crash` on next launch (via AsyncStorage session marker) |

## Verify a crash

1. Open the app on simulator or device.
2. Click around → breadcrumbs build up.
3. Force-kill the app:
   - **iOS Simulator:** Device → Erase All Content, or swipe up + kill from the
     app switcher.
   - **Android USB:** `adb shell am force-stop io.base14.platformdesign`.
4. Relaunch. Watch the dev machine's `dev/collector.log` for an `app_crash`
   span carrying the prior session's `crash.previous_session_id` and the
   `breadcrumbs` JSON attribute.

## Troubleshooting

- **iOS build fails on M-series Mac**: run `cd ios && pod install` before
  `expo run:ios` if you've prebuilt.
- **Android can't reach collector**: confirm `adb reverse --list` shows
  `tcp:34318 tcp:34318`. Re-run after every USB reconnect.
- **`Module not found: @base14/scout-react/native`**: from the package root run
  `make build` first — Metro is wired to watch `../../dist`.

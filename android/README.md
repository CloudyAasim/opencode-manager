# Android client

A WebView pointed at a loopback proxy, and the proxy that makes that work.

## Why there is a proxy at all

The WebView is loaded from `http://127.0.0.1:<port>`, and **everything** - the
app's HTML, JS and CSS included - is forwarded to whichever server the person
chose. Two things make this necessary rather than decorative:

- **Cookies.** better-auth's session cookie is `SameSite=Lax`. A WebView loaded
  straight from a remote origin drops it on every authenticated XHR: the
  request passes the CORS layer and comes back 401, with nothing in the UI saying
  why. Being same-origin makes the cookie first-party.
- **Origin checks.** The upstream has two independent ones - the CORS layer and
  better-auth's own `trustedOrigins` - and neither is satisfied by loopback.

Nothing is served out of the APK. A bundled frontend would be a multi-megabyte
copy of the app that is stale the moment the server is updated.

## Modules

| Module | What it is | Why it is that |
|---|---|---|
| `proxy` | A plain JVM module, zero runtime dependencies | It is the part that has to be provably correct. Keeping it out of Android means `./gradlew :proxy:test` runs on a bare JDK - no emulator, no device, no SDK - which is what makes it affordable to run on every push. |
| `app` | The WebView shell, the server address dialog, the preferences | Deliberately no AndroidX. One WebView, one dialog, one proxy. |

## Building

```sh
./gradlew :app:assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :proxy:test            # proxy unit and end-to-end tests
```

The debug APK is signed with the standard debug key, so it installs on a device
without a release keystore existing.

## Regenerating the normalization golden file

`proxy/src/test/resources/server-url-golden.tsv` is a recording of what
`shared/src/utils/server-url.ts` actually returns, not a snapshot of what the
Kotlin does. If the two implementations ever disagree, that file is what notices:

```sh
node --experimental-strip-types android/tools/gen-server-url-cases.mjs
```

## CI

`.github/workflows/ci.yml` runs the proxy tests with
`--settings-file settings-proxy-only.gradle.kts`, which excludes `:app`. The
proxy is a plain JVM module and its 58 tests need no Android SDK; making every
push download one to run them would mean either skipping them or not running
them often.

Building the APK in CI is a separate job that is not wired up yet: it needs the
SDK, and until it exists the APK is built locally and its contents verified by
hand rather than by a machine.
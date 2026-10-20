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

## Building and testing locally

Two JDKs are involved, which is not obvious and fails in ways that do not say so.

```sh
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk   # any JDK 21
export ANDROID_HOME="$HOME/Android/Sdk"
cd android
```

- **The JDK that launches Gradle** cannot be newer than 21. Kotlin 2.0.21 parses
  the running JVM's version and gives up on anything past it, with
  `IllegalArgumentException: 17` or `27` as the entire error message.
- **A JDK 17 toolchain must be discoverable**, because `proxy/build.gradle.kts`
  pins `jvmToolchain(17)` and `:app` depends on `:proxy`. Gradle finds installed
  JDKs on its own, so an installed 17 is enough; otherwise point it at one:

  ```properties
  # ~/.gradle/gradle.properties
  org.gradle.java.installations.paths=/path/to/jdk-17,/usr/lib/jvm/java-21-openjdk
  ```

  That is a *Gradle* property. `-Dorg.gradle.java.installations.paths=...` on the
  command line is silently ignored.

| Command | Needs |
|---|---|
| `./gradlew :proxy:test` | a JDK 17 toolchain only - no SDK |
| `./gradlew :app:assembleDebug` | the above, plus `ANDROID_HOME` |
| `./gradlew :app:connectedDebugAndroidTest` | the above, plus a running device or emulator |

`connectedDebugAndroidTest` is not in the *push* pipeline: the Android job
there deliberately runs `--settings-file settings-proxy-only.gradle.kts`,
which excludes `:app` so that no push has to download an SDK. It runs in
its own workflow instead - see below.

## CI

`.github/workflows/ci.yml` runs the proxy tests with
`--settings-file settings-proxy-only.gradle.kts`, which excludes `:app`. The
proxy is a plain JVM module and its 58 tests need no Android SDK; making every
push download one to run them would mean either skipping them or not running
them often.

`.github/workflows/android-app.yml` builds the APK and runs the instrumented
tests, on a schedule and on demand rather than on every push - for the same
reason: an SDK and an emulator are a multi-gigabyte download, and paying it on
every push would mean running these rarely or not at all.

It runs the two commands above, with two things it checks that a green run
otherwise would not tell you:

- the APK **file** exists, because a build that says `BUILD SUCCESSFUL` and
  produces no file is a failure worth catching;
- the instrumented **test count** is read out of the XML reports, because a
  green run that executed zero tests is the failure mode this repository has
  already been bitten by once, on the Electron job.

The APK is uploaded as a build artefact.

> The Gradle commands are the same ones that run locally. The CI wiring around
> them - the emulator, the licences, KVM - is not something a local run can
> prove, so the first scheduled run is the first time that part is exercised.
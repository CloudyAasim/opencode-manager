plugins {
    id("org.jetbrains.kotlin.jvm")
}

// Deliberately a plain JVM module, not an Android library. The proxy is the
// part that has to be provably correct, and it is the part with no business
// knowing about Android: keeping it here means `./gradlew :proxy:test` runs on a
// plain JDK with no emulator, no device and no SDK, which is what makes it
// affordable to run on every push.
//
// There are no runtime dependencies on purpose. The HTTP client is raw sockets
// because `HttpURLConnection` downgrades PATCH to POST and buffers streams, and
// every added dependency to get those two things back is one more thing that can
// be upgraded underneath a proxy that carries session cookies.
dependencies {
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnit()
    // The streaming assertions are about ordering and timing, so a shared JVM
    // with a hundred other classes in it is only a source of flakiness.
    maxParallelForks = 1
    testLogging {
        // `standardOut` and `standardError` are here because the fake upstream
        // runs on daemon threads and would otherwise fail in silence: Gradle
        // swallows a test's output unless it is asked for, and a fixture that
        // throws in a thread the test never joins looks exactly like a proxy
        // that never sent anything.
        events("failed", "standardOut", "standardError")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
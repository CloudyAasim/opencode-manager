// The proxy module on its own, with no Android SDK anywhere in sight.
//
// `:proxy` is a plain JVM module with no Android dependency, and it is the part
// of this client that has to be provably correct. Requiring every push to
// download a multi-gigabyte SDK in order to run its unit tests would mean either
// skipping them or not running them often, so CI points `--settings-file` here
// instead. The full build is in `settings.gradle.kts`.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "opencode-manager-android"

include(":proxy")
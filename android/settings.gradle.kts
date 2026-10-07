pluginManagement {
    repositories {
        // A self-hoster behind a firewall can point this at a mirror without
        // editing the build. Left empty, the canonical repositories are used.
        val mirror = providers.gradleProperty("ocmMavenMirror").orNull
        if (!mirror.isNullOrBlank()) {
            maven(url = uri(mirror))
        }
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        val mirror = providers.gradleProperty("ocmMavenMirror").orNull
        if (!mirror.isNullOrBlank()) {
            maven(url = uri(mirror))
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "opencode-manager-android"

include(":proxy")
include(":app")
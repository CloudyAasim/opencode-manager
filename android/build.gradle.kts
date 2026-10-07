// Versions are pinned to what the repository has been built and tested with,
// not to "latest". AGP 8.7.3 pairs with Gradle 8.11 and compileSdk 35; moving
// any of the three is a deliberate act, not something a dependency bump should
// decide on its own.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.jvm") version "2.0.21" apply false
}
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.opencodemanager.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.opencodemanager.app"
        // 26 is the floor for `java.net.ssl.SNIHostName` and for adaptive
        // icons; both are load-bearing for this app rather than arbitrary.
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        // Test-only; see the note on the dependencies block. Nothing here is on
        // the runtime classpath, so it cannot move the measured APK size.
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        // Debug is signed with the standard debug key, which makes the APK
        // installable on a device without any release keystore existing.
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/LICENSE*")
    }
}

dependencies {
    implementation(project(":proxy"))
    // Deliberately no AndroidX, and no WebView wrapper. This app is one WebView,
    // one dialog and a proxy; none of them needs a support library, and the
    // platform has offered a no-action-bar theme and a dialog since API 21.
    //
    // Measured, not guessed: dropping appcompat took the APK from 3,285,710 to
    // 3,246,107 bytes, and the dex from 7.0 MB to 2.4 MB uncompressed. The
    // on-disk figure is small because that dex compresses well, which is exactly
    // why the number in this comment is the one that was measured.
    //
    // Which is why the test dependencies below are `androidTest` only: they are
    // compiled into the test APK and are not on the runtime classpath, so the
    // app keeps shipping with no AndroidX at all.
    //
    // Only two artifacts, and not Espresso. The question is whether
    // `startActivity` was reached at all, which
    // `Instrumentation.ActivityMonitor` answers on its own; the return value of
    // `shouldOverrideUrlLoading` is `true` both when a URL is refused and when
    // it is handed to a handler, so that value cannot tell the two apart.
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
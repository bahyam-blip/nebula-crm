plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Must be applied AFTER the Android + Flutter plugins.
    id("com.google.gms.google-services")
}

android {
    namespace = "com.nebula.nebula_crm"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    defaultConfig {
        applicationId = "com.nebula.nebula_crm"
        minSdk = 23
        targetSdk = 35
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        multiDexEnabled = true
    }

    signingConfigs {
        // A committed debug keystore so every build — local and CI — is signed
        // with the SAME certificate. Without this, Gradle auto-generates a
        // throwaway ~/.android/debug.keystore on each CI runner, the SHA-1
        // changes every build, and Google Sign-In fails with
        // ApiException: 10 (DEVELOPER_ERROR).
        //
        // SHA-1: F1:1C:8F:A4:D3:F2:D3:48:87:DC:B6:65:63:F1:58:C5:15:3C:2E:CF
        // This is a DEBUG key only — it is not secret and must never sign a
        // Play Store release.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
            // Debug APKs carry unstripped symbols and no shrinking, which is
            // why the installed app felt so large. R8 + resource shrinking
            // typically removes well over half the payload.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        debug {
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }

    // NOTE: no `splits { abi { ... } }` block here on purpose.
    // `flutter build apk --split-per-abi` already configures ABI splitting
    // through the Flutter Gradle plugin, including the per-ABI versionCode
    // offsets Play requires. Declaring splits manually as well makes the two
    // mechanisms fight and can emit APKs the package installer rejects with
    // "You can't install this app on this device".

    packaging {
        resources {
            excludes += setOf(
                "META-INF/*.kotlin_module",
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*",
                "**/*.proto",
            )
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

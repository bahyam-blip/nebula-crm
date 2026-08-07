# ── Flutter ────────────────────────────────────────────────────
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# ── Firebase / Google Play services ────────────────────────────
# The Firebase SDKs ship their own consumer rules; these cover the
# reflection-based model deserialisation the shrinker cannot see.
-keepattributes Signature,*Annotation*,EnclosingMethod,InnerClasses
-keepclassmembers class * {
    @com.google.firebase.firestore.PropertyName <fields>;
}
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ── Misc plugins ───────────────────────────────────────────────
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Keep annotated native/JS interop entry points.
-keepclasseswithmembernames class * {
    native <methods>;
}

# ── Play Core / deferred components ────────────────────────────
# Flutter's engine references Play Core split-install classes that are not
# on the classpath for a plain APK build. Without these, R8 aborts with
# "Missing class com.google.android.play.core...".
-dontwarn com.google.android.play.core.**
-keep class com.google.android.play.core.** { *; }
-dontwarn io.flutter.embedding.engine.deferredcomponents.**
-keep class io.flutter.embedding.android.FlutterPlayStoreSplitApplication { *; }

# ── Plugins that use reflection / optional deps ────────────────
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.lang.model.**
-dontwarn org.slf4j.**
-dontwarn kotlinx.**
-keep class androidx.lifecycle.** { *; }

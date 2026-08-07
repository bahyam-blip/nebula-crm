import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:timeago/timeago.dart' as timeago;

import 'app.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // ── Firebase ────────────────────────────────────────────────
  // Init is wrapped in try/catch so the app still launches with the
  // bundled placeholder firebase_options.dart. Replace with real
  // config via `flutterfire configure` for production use.
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (e) {
    if (kDebugMode) {
      debugPrint('Firebase init failed (expected with placeholder config): '
          '$e');
    }
  }

  // ── Hive (offline cache) ────────────────────────────────────
  try {
    await Hive.initFlutter();
  } catch (_) {
    // Hive is optional — fail silently.
  }

  // ── timeago locale (defaults to en) ─────────────────────────
  timeago.setLocaleMessages('en', timeago.EnMessages());

  // ── Flutter web extra ───────────────────────────────────────
  if (kDebugMode) {
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message == null) return;
      if (message.contains('DAMPING') || message.contains('Binding')) return;
      debugPrintSynchronously(message, wrapWidth: wrapWidth);
    };
  }

  runApp(const ProviderScope(child: NebulaCrmApp()));
}

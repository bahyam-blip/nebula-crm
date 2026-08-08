import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:timeago/timeago.dart' as timeago;

import 'app.dart';
import 'core/services/firebase_boot.dart';
import 'core/services/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // ── Firebase ────────────────────────────────────────────────
  // Failures are recorded rather than swallowed, so a broken init shows a
  // real message instead of leaking out later as `unavailable`.
  await bootFirebase();

  // Reminders are scheduled on-device, so the plugin has to be ready
  // before any screen tries to book one.
  await NotificationService().init();

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

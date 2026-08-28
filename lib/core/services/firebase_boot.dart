import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'remote/data_api.dart';
import '../../firebase_options.dart';

/// Outcome of Firebase startup.
///
/// Firebase is still initialised for Google Sign-In and FCM push — but no
/// Firestore: the CRM database is Cloudflare D1 behind the Worker.
enum FirebaseBootState { ok, failed }

class FirebaseBootResult {
  const FirebaseBootResult(this.state, {this.error});

  final FirebaseBootState state;
  final String? error;

  bool get isOk => state == FirebaseBootState.ok;
}

/// Set once by [bootFirebase] before `runApp`.
FirebaseBootResult firebaseBoot =
    const FirebaseBootResult(FirebaseBootState.failed, error: 'not started');

final firebaseBootProvider =
    Provider<FirebaseBootResult>((ref) => firebaseBoot);

/// Initialise Firebase (auth + messaging only — no Firestore).
Future<FirebaseBootResult> bootFirebase() async {
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    firebaseBoot = const FirebaseBootResult(FirebaseBootState.ok);
  } catch (e) {
    if (kDebugMode) debugPrint('Firebase init failed: $e');
    firebaseBoot = FirebaseBootResult(
      FirebaseBootState.failed,
      error: e.toString(),
    );
  }
  return firebaseBoot;
}

/// Retry a data-API operation on transient errors.
///
/// 429 and 5xx replies are retryable; everything else fails fast — retrying
/// a 403 just delays the real error. (Name kept from the Firestore days so
/// call sites did not have to change.)
Future<T> withFirestoreRetry<T>(
  Future<T> Function() operation, {
  int maxAttempts = 4,
  Duration initialDelay = const Duration(milliseconds: 400),
}) async {
  var delay = initialDelay;
  Object? lastError;

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } on DataApiException catch (e) {
      lastError = e;
      final retryable = e.status == 429 || e.status >= 500;
      if (!retryable || attempt == maxAttempts) rethrow;
      await Future<void>.delayed(delay);
      delay *= 2;
    }
  }
  throw lastError ?? Exception('data operation failed');
}

/// Human-readable explanation for a data error.
///
/// The raw SDK strings are unhelpful to end users.
String describeFirestoreError(Object error) {
  if (error is DataApiException) {
    switch (error.status) {
      case 401:
      case 403:
        return 'You do not have permission to view this. Ask an admin to '
            'check your role.';
      case 409:
        return 'Your account is still being set up. Try again in a moment.';
      case 429:
        return 'The server is busy. Please try again shortly.';
      case >= 500:
        return 'The server hit a temporary problem. Please try again.';
      default:
        return error.message;
    }
  }
  return 'Something went wrong. Please try again.';
}

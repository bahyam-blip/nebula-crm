import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../firebase_options.dart';

/// Outcome of Firebase startup.
///
/// Previously `main()` swallowed initialisation failures, so the app would
/// launch in a half-dead state and every Firestore read surfaced as the
/// misleading `[cloud_firestore/unavailable]`. We now record what actually
/// happened so the UI can say something true.
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

/// Initialise Firebase and configure Firestore for real-world networks.
Future<FirebaseBootResult> bootFirebase() async {
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );

    // Offline persistence means a dropped connection serves cached data
    // instead of throwing `unavailable`.
    FirebaseFirestore.instance.settings = const Settings(
      persistenceEnabled: true,
      cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
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

/// Retry a Firestore operation on transient errors.
///
/// `unavailable` and `deadline-exceeded` are explicitly documented by
/// Firestore as retryable. Everything else fails fast — retrying a
/// `permission-denied` just delays the real error.
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
    } on FirebaseException catch (e) {
      lastError = e;
      final retryable =
          e.code == 'unavailable' || e.code == 'deadline-exceeded';
      if (!retryable || attempt == maxAttempts) rethrow;
      await Future<void>.delayed(delay);
      delay *= 2;
    }
  }
  throw lastError ?? Exception('Firestore operation failed');
}

/// Human-readable explanation for a Firestore error code.
///
/// The raw SDK strings are unhelpful to end users and actively misleading
/// for `unavailable`, which usually means the database was never created
/// rather than a passing network blip.
String describeFirestoreError(Object error) {
  if (error is FirebaseException) {
    switch (error.code) {
      case 'unavailable':
        return 'Cannot reach the database. Check your connection — if this '
            'persists, the Cloud Firestore database may not be set up yet.';
      case 'permission-denied':
        return 'You do not have permission to view this. Ask an admin to '
            'check your role.';
      case 'unauthenticated':
        return 'Your session expired. Please sign in again.';
      case 'failed-precondition':
        return 'This view needs a database index that is still building. '
            'Try again shortly.';
      case 'not-found':
        return 'That record no longer exists.';
      default:
        return error.message ?? 'Something went wrong (${error.code}).';
    }
  }
  return 'Something went wrong. Please try again.';
}

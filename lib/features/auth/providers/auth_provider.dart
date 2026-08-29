import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/auth_service.dart';
import '../../../core/services/push_service.dart';
import '../../../core/services/remote/data_api.dart';
import '../models/app_user.dart';

/// Current Firebase [User], refreshed on auth state changes.
final currentFirebaseUserProvider = StreamProvider<User?>((ref) {
  return FirebaseAuth.instance.authStateChanges();
});

/// Current [AppUser] (D1 `users/{uid}` via the Worker) for the signed-in user.
///
/// The first emission runs the idempotent bootstrap (profile create, invite
/// adoption, workspace claim — all server-side), then the profile is polled
/// so role/team changes made by an admin show up without a restart.
///
/// Two hard-won rules keep this stream healthy (a stall here cascades into
/// EVERYTHING — profile screen, AI assistant, team scoping):
///   • Push registration NEVER blocks a value: requestPermission/getToken
///     can take seconds (or hang without Play services), and awaiting it
///     inside the fetch kept the first emission hostage.
///   • Every fetch is timeout-bounded, and a failed tick returns the last
///     known good profile instead of erroring the stream out — the next
///     tick self-heals.
final currentAppUserProvider = StreamProvider<AppUser?>((ref) {
  final user = ref.watch(currentFirebaseUserProvider).valueOrNull;
  if (user == null) return Stream.value(null);

  final ds = ref.watch(remoteDataServiceProvider);
  var pushRegistered = false;
  var bootstrapped = false;
  AppUser? lastGood;

  Future<AppUser?> guarded(Future<AppUser?> Function() body) =>
      body().timeout(const Duration(seconds: 20));

  return ds.watch<AppUser?>(() async {
    try {
      return await guarded(() async {
        if (!bootstrapped) {
          bootstrapped = true;
          await ds.bootstrap();
        }
        final doc = await ds.get('users', user.uid);
        final parsed = doc == null ? null : AppUser.fromFirestore(doc);
        if (parsed != null) lastGood = parsed;

        // Fire-and-forget: record this handset so teammates can reach it.
        // Idempotent; runs at most once per stream subscription.
        if (!pushRegistered) {
          pushRegistered = true;
          Future<void>(() => ref.read(pushServiceProvider).registerDevice())
              .timeout(const Duration(seconds: 45))
              .catchError((_) {});
        }
        return parsed;
      });
    } catch (_) {
      // Self-heal: surface the last known profile and retry on the next
      // tick. Erroring the stream here froze the profile page and the AI
      // assistant on a spinner for the whole session.
      return lastGood;
    }
  }, interval: const Duration(seconds: 60));
});

/// Convenience: synchronous access to the current [AppUser] (or null).
final currentAppUserValueProvider = Provider<AppUser?>((ref) {
  return ref.watch(currentAppUserProvider).valueOrNull;
});

/// Convenience: current user's UID (or empty string).
final currentUserIdProvider = Provider<String>((ref) {
  final user = ref.watch(currentFirebaseUserProvider).valueOrNull;
  return user?.uid ?? '';
});

/// Convenience: current user's teamId (or empty string).
final currentTeamIdProvider = Provider<String>((ref) {
  final user = ref.watch(currentAppUserValueProvider);
  return user?.teamId ?? '';
});

/// Async notifier that wraps [AuthService] for use in the auth UI.
class AuthController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  AuthService get _auth => ref.read(authServiceProvider);

  Future<AuthResult> signIn({
    required String email,
    required String password,
  }) async {
    state = const AsyncLoading();
    final result = await _auth.signInWithEmail(email: email, password: password);
    state = const AsyncData(null);
    return result;
  }

  Future<AuthResult> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    state = const AsyncLoading();
    final result = await _auth.registerWithEmail(
      email: email,
      password: password,
      displayName: displayName,
    );
    state = const AsyncData(null);
    return result;
  }

  Future<AuthResult> signInWithGoogle() async {
    state = const AsyncLoading();
    final result = await _auth.signInWithGoogle();
    state = const AsyncData(null);
    return result;
  }

  Future<AuthResult> resetPassword(String email) async {
    return _auth.sendPasswordReset(email);
  }

  Future<void> signOut() async {
    state = const AsyncLoading();
    await _auth.signOut();
    state = const AsyncData(null);
  }
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, void>(AuthController.new);

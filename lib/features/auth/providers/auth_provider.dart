import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/auth_service.dart';
import '../models/app_user.dart';

/// Current Firebase [User], refreshed on auth state changes.
final currentFirebaseUserProvider = StreamProvider<User?>((ref) {
  return FirebaseAuth.instance.authStateChanges();
});

/// Current [AppUser] (Firestore doc) for the signed-in user.
final currentAppUserProvider = StreamProvider<AppUser?>((ref) {
  final user = ref.watch(currentFirebaseUserProvider).valueOrNull;
  if (user == null) return Stream.value(null);
  return FirebaseFirestore.instance
      .collection(AppConstants.colUsers)
      .doc(user.uid)
      .snapshots()
      .map((d) => d.exists ? AppUser.fromFirestore(d) : null);
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

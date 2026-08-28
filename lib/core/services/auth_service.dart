import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:logger/logger.dart';

import '../../features/auth/models/app_user.dart';
import '../auth/capabilities.dart';
import 'remote/data_api.dart';
import 'remote/data_codec.dart';

final logger = Logger(printer: PrettyPrinter(methodCount: 0));

/// FirebaseAuth instance provider.
final firebaseAuthProvider = Provider<FirebaseAuth>((ref) {
  return FirebaseAuth.instance;
});

/// GoogleSignIn instance provider.
final googleSignInProvider = Provider<GoogleSignIn>((ref) {
  return GoogleSignIn(scopes: const ['email', 'profile', 'openid']);
});

/// Auth state changes stream — emits null when signed out.
final authStateChangesProvider = StreamProvider<User?>((ref) {
  return ref.watch(firebaseAuthProvider).authStateChanges();
});

/// Whether a user is currently signed in.
final isLoggedInProvider = Provider<bool>((ref) {
  final user = ref.watch(authStateChangesProvider).valueOrNull;
  return user != null;
});

/// Result type for auth operations.
sealed class AuthResult {
  const AuthResult();
}

class AuthSuccess extends AuthResult {
  const AuthSuccess(this.user);
  final User user;
}

class AuthFailure extends AuthResult {
  const AuthFailure(this.message, {this.code});
  final String message;
  final String? code;
}

/// Centralized authentication service.
///
/// Identity lives on Firebase (Google Sign-In / email+password); the CRM
/// profile lives in Cloudflare D1 behind the Worker. Everything the old
/// Firestore signup dance did — bootstrap claim, invite adoption, team
/// ensure, capability seeding, audit entry — now happens server-side in
/// one idempotent call (POST /v1/data/bootstrap), and this service just
/// invokes it and keeps the profile fresh.
class AuthService {
  AuthService(this._ref);

  final Ref _ref;

  FirebaseAuth get _auth => _ref.read(firebaseAuthProvider);
  GoogleSignIn get _google => _ref.read(googleSignInProvider);
  RemoteDataSource get _ds => _ref.read(remoteDataServiceProvider);

  /// Sign in with email + password.
  Future<AuthResult> signInWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      final cred = await _auth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      await _syncUserDoc(cred.user!);
      return AuthSuccess(cred.user!);
    } on FirebaseAuthException catch (e) {
      return AuthFailure(_friendlyMessage(e.code), code: e.code);
    } catch (e) {
      return AuthFailure('An unexpected error occurred: $e');
    }
  }

  /// Register with email + password.
  Future<AuthResult> registerWithEmail({
    required String email,
    required String password,
    required String displayName,
  }) async {
    try {
      final cred = await _auth.createUserWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      await cred.user!.updateDisplayName(displayName);
      await _syncUserDoc(cred.user!);
      return AuthSuccess(cred.user!);
    } on FirebaseAuthException catch (e) {
      return AuthFailure(_friendlyMessage(e.code), code: e.code);
    } catch (e) {
      return AuthFailure('An unexpected error occurred: $e');
    }
  }

  /// Sign in with Google.
  Future<AuthResult> signInWithGoogle() async {
    try {
      final account = await _google.signIn();
      if (account == null) {
        return const AuthFailure('Google sign-in cancelled');
      }
      final googleAuth = await account.authentication;
      final credential = GoogleAuthProvider.credential(
        idToken: googleAuth.idToken,
        accessToken: googleAuth.accessToken,
      );
      final cred = await _auth.signInWithCredential(credential);
      await _syncUserDoc(cred.user!);
      return AuthSuccess(cred.user!);
    } on FirebaseAuthException catch (e) {
      return AuthFailure(_friendlyMessage(e.code), code: e.code);
    } catch (e) {
      return AuthFailure('Google sign-in failed: $e');
    }
  }

  /// Send a password reset email.
  Future<AuthResult> sendPasswordReset(String email) async {
    try {
      await _auth.sendPasswordResetEmail(email: email.trim());
      return AuthSuccess(_auth.currentUser!);
    } on FirebaseAuthException catch (e) {
      return AuthFailure(_friendlyMessage(e.code), code: e.code);
    } catch (e) {
      return AuthFailure('Failed to send reset email: $e');
    }
  }

  /// Sign out from all providers.
  Future<void> signOut() async {
    try {
      await _google.signOut();
    } catch (_) {}
    await _auth.signOut();
  }

  /// Update the user's profile (D1 `users/{uid}`).
  Future<void> updateProfile({
    String? displayName,
    String? phone,
    String? title,
    String? photoUrl,
  }) async {
    final user = _auth.currentUser;
    if (user == null) return;

    final updates = <String, dynamic>{};
    if (displayName != null) {
      updates['displayName'] = displayName;
      await user.updateDisplayName(displayName);
    }
    if (phone != null) updates['phone'] = phone;
    if (title != null) updates['title'] = title;
    if (photoUrl != null) {
      updates['photoUrl'] = photoUrl;
      await user.updatePhotoURL(photoUrl);
    }
    if (updates.isNotEmpty) {
      updates['lastActiveAt'] = const ServerTimestamp();
      await _ds.update('users', user.uid, updates);
    }
  }

  /// Update the user's lastActive timestamp.
  Future<void> pingActivity() async {
    final user = _auth.currentUser;
    if (user == null) return;
    await _ds.update('users', user.uid, {'lastActiveAt': const ServerTimestamp()});
  }

  /// Create-or-refresh the profile server-side. Idempotent, so this is all
  /// signup, repair, and invite adoption ever need.
  Future<void> _syncUserDoc(User user) async {
    await _ds.bootstrap();
  }

  /// Kept for API compatibility: the bootstrap claim (and any promotion it
  /// implies) is enforced server-side now — calling bootstrap again is the
  /// complete repair. Returns true when the profile is a super admin.
  Future<bool> claimSuperAdminIfUnowned(User user) async {
    try {
      final doc = await _ds.bootstrap();
      return (doc.data['role'] ?? '') == UserRole.superAdmin.name;
    } catch (_) {
      return false;
    }
  }

  /// Repair an account that authenticated but has no profile yet.
  Future<void> ensureUserDoc(User user) async {
    try {
      await _ds.bootstrap();
    } catch (_) {
      // Surfaced to the user by whichever screen needs the profile.
    }
  }

  /// Translate Firebase error codes to user-friendly messages.
  String _friendlyMessage(String code) {
    return switch (code) {
      'user-not-found' => 'No account found with that email.',
      'wrong-password' => 'Incorrect password. Please try again.',
      'invalid-email' => 'That email address looks invalid.',
      'user-disabled' => 'This account has been disabled.',
      'too-many-requests' => 'Too many attempts. Try again later.',
      'operation-not-allowed' => 'This sign-in method is not enabled.',
      'email-already-in-use' => 'An account already exists with that email.',
      'weak-password' => 'Please choose a stronger password.',
      'network-request-failed' => 'Network error. Check your connection.',
      'invalid-credential' => 'Invalid email or password.',
      _ => 'Authentication failed. Please try again.',
    };
  }
}

/// Provider for [AuthService].
final authServiceProvider = Provider<AuthService>((ref) => AuthService(ref));

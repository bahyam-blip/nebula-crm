import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:logger/logger.dart';

import '../../features/auth/models/app_user.dart';
import '../constants/app_constants.dart';

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
/// Wraps FirebaseAuth + GoogleSignIn + Firestore user sync. All auth
/// failures return [AuthFailure] with a user-friendly message — never
/// throw. UI can `switch` on the result type.
class AuthService {
  AuthService(this._ref);

  final Ref _ref;

  FirebaseAuth get _auth => _ref.read(firebaseAuthProvider);
  GoogleSignIn get _google => _ref.read(googleSignInProvider);
  FirebaseFirestore get _firestore => FirebaseFirestore.instance;

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
      await _createUserDoc(cred.user!, displayName);
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
      await _syncUserDoc(cred.user!, defaultDisplayName: account.displayName);
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

  /// Update the user's profile (Firestore `users/{uid}`).
  Future<void> updateProfile({
    String? displayName,
    String? phone,
    String? title,
    String? photoUrl,
  }) async {
    final user = _auth.currentUser;
    if (user == null) return;

    final ref = _firestore.collection(AppConstants.colUsers).doc(user.uid);
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
      updates['lastActiveAt'] = FieldValue.serverTimestamp();
      await ref.set(updates, SetOptions(merge: true));
    }
  }

  /// Update the user's lastActive timestamp.
  Future<void> pingActivity() async {
    final user = _auth.currentUser;
    if (user == null) return;
    await _firestore.collection(AppConstants.colUsers).doc(user.uid).set({
      'lastActiveAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  Future<void> _syncUserDoc(User user, {String? defaultDisplayName}) async {
    final ref = _firestore.collection(AppConstants.colUsers).doc(user.uid);
    final snap = await ref.get();
    if (!snap.exists) {
      await _createUserDoc(user, defaultDisplayName ?? user.displayName ?? 'User');
    } else {
      await ref.set({
        'lastActiveAt': FieldValue.serverTimestamp(),
        'email': user.email,
        if (user.photoURL != null) 'photoUrl': user.photoURL,
      }, SetOptions(merge: true));
    }
  }

  Future<void> _createUserDoc(User user, String displayName) async {
    final ref = _firestore.collection(AppConstants.colUsers).doc(user.uid);

    // Determine if this is the first user ever — if so, make them superAdmin.
    // Otherwise default to salesRep (employee role).
    final usersSnapshot = await _firestore
        .collection(AppConstants.colUsers)
        .limit(1)
        .get();
    final isFirstUser = usersSnapshot.docs.isEmpty;

    // Each new user gets their own team (so signups are isolated).
    // The superAdmin can later move users between teams / promote them.
    final teamId = isFirstUser ? 'default-team' : 'team-${user.uid}';
    final teamName = isFirstUser ? 'Default Team' : '${displayName}s Team';

    final role = isFirstUser ? UserRole.superAdmin : UserRole.salesRep;

    // Create the team doc (if it doesn't exist)
    final teamRef = _firestore.collection(AppConstants.colTeams).doc(teamId);
    final teamSnap = await teamRef.get();
    if (!teamSnap.exists) {
      await teamRef.set({
        'id': teamId,
        'name': teamName,
        'ownerId': user.uid,
        'createdAt': FieldValue.serverTimestamp(),
        'plan': 'free',
      });
    }

    final appUser = AppUser(
      id: user.uid,
      email: user.email ?? '',
      displayName: displayName,
      photoUrl: user.photoURL,
      role: role,
      teamId: teamId,
      createdAt: DateTime.now(),
      lastActiveAt: DateTime.now(),
    );
    await ref.set(appUser.toFirestore());

    // Log the role assignment for audit
    await _firestore.collection(AppConstants.colActivities).add({
      'type': 'user_signed_up',
      'ownerId': user.uid,
      'title': 'New user signed up',
      'description': '$displayName joined as ${role.label}',
      'metadata': {
        'role': role.name,
        'teamId': teamId,
        'isFirstUser': isFirstUser,
        'email': user.email,
      },
      'timestamp': FieldValue.serverTimestamp(),
    });
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

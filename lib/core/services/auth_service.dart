import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:logger/logger.dart';

import '../../features/auth/models/app_user.dart';
import '../../features/auth/services/invite_service.dart';
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

  /// Create the Firestore profile for a newly authenticated user.
  ///
  /// This used to query the whole `users` collection to decide whether the
  /// signup was the first one. Security rules only ever permit reading your
  /// OWN user document, so that query was always denied -- and because it
  /// threw before the write, the profile was never created at all. Every
  /// later read then failed with permission-denied, since every rule
  /// resolves the caller's role through their (missing) user document.
  ///
  /// Instead we claim a single `system/bootstrap` document. Firestore
  /// `create` fails if the document already exists, so exactly one account
  /// can ever win the race and become superAdmin.
  Future<void> _createUserDoc(User user, String displayName) async {
    final userRef = _firestore.collection(AppConstants.colUsers).doc(user.uid);

    // Don't clobber an existing profile (e.g. a repaired or invited user).
    final existing = await userRef.get();
    if (existing.exists) return;

    final bootstrapRef =
        _firestore.collection(AppConstants.colSystem).doc('bootstrap');

    var isFirstUser = false;
    try {
      await bootstrapRef.set({
        'ownerId': user.uid,
        'claimedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: false));
      isFirstUser = true;
    } catch (_) {
      // Already claimed by someone else: this is a normal, later signup.
      isFirstUser = false;
    }

    // Everyone lands in one shared workspace so a team can actually see the
    // same pipeline. A super admin can move people between teams later.
    var teamId = AppConstants.defaultTeamId;
    var role = isFirstUser ? UserRole.superAdmin : UserRole.salesRep;

    // A super admin can pre-assign a role by email. Honour it here, so an
    // invited telecaller lands with the right permissions on first login
    // instead of needing to be promoted afterwards.
    if (!isFirstUser) {
      final invite =
          await InviteService(_firestore).lookup(user.email ?? '');
      if (invite != null && !invite.isAccepted) {
        role = invite.role;
        teamId = invite.teamId;
        await InviteService(_firestore)
            .markAccepted(user.email ?? '', user.uid);
      }
    }

    final teamRef = _firestore.collection(AppConstants.colTeams).doc(teamId);
    try {
      final teamSnap = await teamRef.get();
      if (!teamSnap.exists) {
        await teamRef.set({
          'id': teamId,
          'name': 'Default Team',
          'ownerId': user.uid,
          'createdAt': FieldValue.serverTimestamp(),
          'plan': 'free',
        });
      }
    } catch (_) {
      // A non-admin may not be allowed to touch the team doc. Not fatal:
      // the profile below is what actually matters.
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
    await userRef.set(appUser.toFirestore());

    // Audit entry is best-effort; never block signup on it.
    try {
      await _firestore.collection(AppConstants.colActivities).add({
        'type': 'user_signed_up',
        'ownerId': user.uid,
        'teamId': teamId,
        'title': 'New user signed up',
        'description': '$displayName joined as ${role.label}',
        'metadata': {'role': role.name, 'isFirstUser': isFirstUser},
        'timestamp': FieldValue.serverTimestamp(),
      });
    } catch (_) {}
  }

  /// Make the workspace creator a super admin.
  ///
  /// Accounts created before the bootstrap logic existed were written as
  /// salesRep, which left nobody able to open Super Admin -- and nobody to
  /// promote them, since promotion requires a super admin. If system/bootstrap
  /// has never been claimed, the signed-in user claims it and promotes
  /// themselves. Create-once semantics mean only one account can ever do this.
  Future<bool> claimSuperAdminIfUnowned(User user) async {
    try {
      final bootstrapRef =
          _firestore.collection(AppConstants.colSystem).doc('bootstrap');
      final snap = await bootstrapRef.get();

      if (snap.exists) {
        final owner = (snap.data() ?? const {})['ownerId'];
        if (owner != user.uid) return false; // someone else owns it
      } else {
        await bootstrapRef.set({
          'ownerId': user.uid,
          'claimedAt': FieldValue.serverTimestamp(),
        });
      }

      final userRef =
          _firestore.collection(AppConstants.colUsers).doc(user.uid);
      final me = await userRef.get();
      if (!me.exists) return false;
      if ((me.data() ?? const {})['role'] == UserRole.superAdmin.name) {
        return false; // already there
      }

      await userRef.update({
        'role': UserRole.superAdmin.name,
        'teamId': AppConstants.defaultTeamId,
        'updatedAt': FieldValue.serverTimestamp(),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Repair an account that authenticated but has no Firestore profile.
  ///
  /// Accounts created before the bootstrap fix are in exactly that state:
  /// signed in, but every read denied. Called on startup so they heal
  /// themselves instead of needing to be deleted and recreated.
  Future<void> ensureUserDoc(User user) async {
    try {
      final ref = _firestore.collection(AppConstants.colUsers).doc(user.uid);
      final snap = await ref.get();
      if (snap.exists) return;
      await _createUserDoc(
        user,
        user.displayName ?? user.email?.split('@').first ?? 'User',
      );
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

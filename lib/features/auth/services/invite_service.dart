import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/remote/data_api.dart';
import '../../../core/services/remote/data_codec.dart';
import '../models/app_user.dart';

/// A pending invitation to join the workspace with a given role.
///
/// A mobile client cannot create Firebase Auth accounts for other people --
/// that needs the Admin SDK on a server. So instead of creating the user,
/// the super admin records the email and role here; when that person signs
/// up themselves, the WORKER's bootstrap reads the invite and applies the
/// role and team. The document id IS the lowercased email.
class Invite {
  const Invite({
    required this.email,
    required this.role,
    required this.teamId,
    this.invitedBy = '',
    this.invitedByName = '',
    this.acceptedBy,
    this.createdAt,
  });

  final String email;
  final UserRole role;
  final String teamId;
  final String invitedBy;
  final String invitedByName;
  final String? acceptedBy;
  final DateTime? createdAt;

  bool get isAccepted => acceptedBy != null;

  static String docId(String email) => email.trim().toLowerCase();

  factory Invite.fromFirestore(DataDoc doc) {
    final d = doc.data;
    return Invite(
      email: d['email'] as String? ?? doc.id,
      role: UserRole.values.firstWhere(
        (r) => r.name == d['role'],
        orElse: () => UserRole.salesRep,
      ),
      teamId: d['teamId'] as String? ?? AppConstants.defaultTeamId,
      invitedBy: d['invitedBy'] as String? ?? '',
      invitedByName: d['invitedByName'] as String? ?? '',
      acceptedBy: d['acceptedBy'] as String?,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'email': email.trim().toLowerCase(),
        'role': role.name,
        'teamId': teamId,
        'invitedBy': invitedBy,
        'invitedByName': invitedByName,
        'acceptedBy': acceptedBy,
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : const ServerTimestamp(),
      };
}

class InviteService {
  InviteService(this._ds);

  final RemoteDataSource _ds;

  Future<void> invite({
    required String email,
    required UserRole role,
    required AppUser actor,
  }) async {
    final id = Invite.docId(email);
    if (id.isEmpty || !id.contains('@')) {
      throw ArgumentError('Enter a valid email address.');
    }
    await _ds.set(
      AppConstants.colInvites,
      id,
      Invite(
        email: id,
        role: role,
        teamId: actor.teamId ?? AppConstants.defaultTeamId,
        invitedBy: actor.id,
        invitedByName: actor.displayName,
      ).toFirestore(),
    );
  }

  Future<void> revoke(String email) =>
      _ds.delete(AppConstants.colInvites, Invite.docId(email));

  /// Look up an invite (admin view). Signup-time adoption happens
  /// server-side inside the bootstrap endpoint — the caller may not even
  /// have a profile yet, so this lookup is for the invites screen only.
  Future<Invite?> lookup(String email) async {
    try {
      final doc = await _ds.get(AppConstants.colInvites, Invite.docId(email));
      if (doc == null) return null;
      return Invite.fromFirestore(doc);
    } catch (_) {
      return null;
    }
  }

  Future<void> markAccepted(String email, String uid) async {
    try {
      await _ds.update(AppConstants.colInvites, Invite.docId(email), {
        'acceptedBy': uid,
        'acceptedAt': const ServerTimestamp(),
      });
    } catch (_) {}
  }
}

final inviteServiceProvider = Provider<InviteService>((ref) {
  return InviteService(ref.watch(remoteDataServiceProvider));
});

final pendingInvitesProvider = StreamProvider<List<Invite>>((ref) {
  final ds = ref.watch(remoteDataServiceProvider);
  return ds.watchList(
    () => ds
        .list(AppConstants.colInvites, limit: 200)
        .then((docs) => docs.map(Invite.fromFirestore).toList()),
  );
});

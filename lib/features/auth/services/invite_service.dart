import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/firestore_service.dart';
import '../models/app_user.dart';

/// A pending invitation to join the workspace with a given role.
///
/// A mobile client cannot create Firebase Auth accounts for other people --
/// that needs the Admin SDK on a server. So instead of creating the user,
/// the super admin records the email and role here; when that person signs
/// up themselves, signup reads the invite and applies the role and team.
/// The document id IS the lowercased email, which makes the lookup a single
/// permitted `get` rather than a query.
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

  factory Invite.fromFirestore(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>? ?? {};
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
            : FieldValue.serverTimestamp(),
      };
}

class InviteService {
  InviteService(this._db);

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> get _col =>
      _db.collection(AppConstants.colInvites);

  Future<void> invite({
    required String email,
    required UserRole role,
    required AppUser actor,
  }) async {
    final id = Invite.docId(email);
    if (id.isEmpty || !id.contains('@')) {
      throw ArgumentError('Enter a valid email address.');
    }
    await _col.doc(id).set(
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
      _col.doc(Invite.docId(email)).delete();

  /// Look up an invite during signup. Returns null when there isn't one.
  Future<Invite?> lookup(String email) async {
    try {
      final doc = await _col.doc(Invite.docId(email)).get();
      if (!doc.exists) return null;
      return Invite.fromFirestore(doc);
    } catch (_) {
      return null;
    }
  }

  Future<void> markAccepted(String email, String uid) async {
    try {
      await _col.doc(Invite.docId(email)).update({
        'acceptedBy': uid,
        'acceptedAt': FieldValue.serverTimestamp(),
      });
    } catch (_) {}
  }
}

final inviteServiceProvider = Provider<InviteService>((ref) {
  return InviteService(ref.watch(firestoreProvider));
});

final pendingInvitesProvider = StreamProvider<List<Invite>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colInvites)
      .snapshots()
      .map((s) => s.docs.map(Invite.fromFirestore).toList());
});

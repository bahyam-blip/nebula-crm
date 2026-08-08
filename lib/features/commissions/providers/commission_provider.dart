import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/firestore_service.dart';
import '../../auth/models/app_user.dart';
import '../../auth/providers/auth_provider.dart';
import '../../telecalling/providers/telecalling_provider.dart';
import '../models/commission.dart';

class CommissionService {
  CommissionService(this._db);
  final FirebaseFirestore _db;

  DocumentReference<Map<String, dynamic>> _settingsRef(String teamId) =>
      _db.collection(AppConstants.colSettings).doc(teamId);

  Future<CommissionSettings> loadSettings(String teamId) async {
    try {
      final doc = await _settingsRef(teamId).get();
      return CommissionSettings.fromMap(doc.data());
    } catch (_) {
      return const CommissionSettings();
    }
  }

  Future<void> saveSettings(
    String teamId,
    CommissionSettings settings,
    String actorId,
  ) async {
    await _settingsRef(teamId).set(
      {...settings.toMap(), 'updatedBy': actorId},
      SetOptions(merge: true),
    );
  }

  /// Record a commission for a closed subscription.
  ///
  /// The payout is written onto the record rather than derived later, so a
  /// future rate change never silently rewrites what someone already earned.
  Future<void> recordSale({
    required AppUser salesPerson,
    required String contactId,
    required String contactName,
    String? note,
  }) async {
    final teamId = salesPerson.teamId ?? '';
    if (teamId.isEmpty) return;

    // One commission per contact: re-marking a lead converted must not pay
    // twice.
    final existing = await _db
        .collection(AppConstants.colCommissions)
        .where('contactId', isEqualTo: contactId)
        .limit(1)
        .get();
    if (existing.docs.isNotEmpty) return;

    final settings = await loadSettings(teamId);

    await _db.collection(AppConstants.colCommissions).add(
          Commission(
            id: '',
            teamId: teamId,
            salesPersonId: salesPerson.id,
            salesPersonName: salesPerson.displayName,
            amount: settings.payoutPerSale,
            subscriptionPrice: settings.subscriptionPrice,
            contactId: contactId,
            contactName: contactName,
            note: note,
          ).toFirestore(),
        );
  }

  Future<void> setStatus(String id, CommissionStatus status) =>
      _db.collection(AppConstants.colCommissions).doc(id).update({
        'status': status.name,
        'settledAt': status == CommissionStatus.paid
            ? FieldValue.serverTimestamp()
            : null,
      });
}

final commissionServiceProvider = Provider<CommissionService>((ref) {
  return CommissionService(ref.watch(firestoreProvider));
});

final commissionSettingsProvider =
    FutureProvider<CommissionSettings>((ref) async {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return const CommissionSettings();
  return ref.watch(commissionServiceProvider).loadSettings(teamId);
});

/// Every commission in the team. Single where, sorted client-side.
final teamCommissionsProvider = StreamProvider<List<Commission>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <Commission>[]);
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colCommissions)
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((s) {
    final list = s.docs.map(Commission.fromFirestore).toList()
      ..sort((a, b) =>
          (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
    return list;
  });
});

/// Just mine, for the earnings screen.
final myCommissionsProvider = Provider<List<Commission>>((ref) {
  final uid = ref.watch(currentUserIdProvider);
  final all = ref.watch(teamCommissionsProvider).valueOrNull ??
      const <Commission>[];
  return all.where((c) => c.salesPersonId == uid).toList();
});

/// Leaderboard: who sold what, and what they are owed.
final earningsLeaderboardProvider = Provider<List<EarningsRow>>((ref) {
  final members =
      ref.watch(teamMembersListProvider).valueOrNull ?? const <AppUser>[];
  final commissions = ref.watch(teamCommissionsProvider).valueOrNull ??
      const <Commission>[];

  final rows = <String, EarningsRow>{
    for (final m in members)
      m.id: EarningsRow(userId: m.id, name: m.displayName),
  };

  for (final c in commissions) {
    if (!c.status.counts) continue;
    final row = rows.putIfAbsent(
      c.salesPersonId,
      () => EarningsRow(userId: c.salesPersonId, name: c.salesPersonName),
    );
    row.sales++;
    row.earned += c.amount;
    row.revenue += c.subscriptionPrice;
    if (c.status == CommissionStatus.paid) row.paid += c.amount;
  }

  final list = rows.values.toList()
    ..sort((a, b) => b.earned.compareTo(a.earned));
  return list;
});

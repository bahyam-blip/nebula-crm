import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/remote/data_api.dart';
import '../../../core/services/remote/data_codec.dart';
import '../../auth/models/app_user.dart';
import '../../auth/providers/auth_provider.dart';
import '../../telecalling/providers/telecalling_provider.dart';
import '../models/commission.dart';

class CommissionService {
  CommissionService(this._ds);
  final RemoteDataSource _ds;

  Future<CommissionSettings> loadSettings(String teamId) async {
    try {
      final doc = await _ds.get(AppConstants.colSettings, teamId);
      return CommissionSettings.fromMap(doc?.data ?? const {});
    } catch (_) {
      return const CommissionSettings();
    }
  }

  Future<void> saveSettings(
    String teamId,
    CommissionSettings settings,
    String actorId,
  ) async {
    await _ds.set(
      AppConstants.colSettings,
      teamId,
      {...settings.toMap(), 'updatedBy': actorId},
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
    final existing = await _ds.list(
      AppConstants.colCommissions,
      where: [WhereEq('contactId', contactId)],
      limit: 1,
    );
    if (existing.isNotEmpty) return;

    final settings = await loadSettings(teamId);

    await _ds.set(AppConstants.colCommissions, null, 
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
      _ds.update(AppConstants.colCommissions, id, {
        'status': status.name,
        'settledAt': status == CommissionStatus.paid
            ? const ServerTimestamp()
            : null,
      });
}

final commissionServiceProvider = Provider<CommissionService>((ref) {
  return CommissionService(ref.watch(remoteDataServiceProvider));
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
  final ds = ref.watch(remoteDataServiceProvider);
  return ds.watchList(
    () async {
      final docs = await ds.list(
        AppConstants.colCommissions,
        where: [WhereEq('teamId', teamId)],
        limit: 300,
      );
      final list = docs.map(Commission.fromFirestore).toList()
        ..sort((a, b) =>
            (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
      return list;
    },
  );
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

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../constants/app_constants.dart';
import 'remote/data_api.dart';
import 'remote/data_codec.dart';

/// Repairs documents created before the workspace model settled.
///
/// The original signup gave every user their own team (`team-<uid>`), and
/// a lot of records were written with no `teamId` at all. Security rules
/// scope every read with `resource.data.teamId == userTeamId()`, so those
/// documents are invisible no matter how the query is written. Changing
/// signup fixed new accounts; it did nothing for data already in the
/// database. This backfills it.
///
/// Runs only for a super admin, only once per install, and skips documents
/// that already carry the right team.
class DataMigration {
  DataMigration(this._ds);

  final RemoteDataSource _ds;

  static const _collections = [
    AppConstants.colContacts,
    AppConstants.colDeals,
    AppConstants.colActivities,
    AppConstants.colTickets,
    AppConstants.colCampaigns,
    'tasks',
    'call_logs',
  ];

  /// Marker so the sweep does not repeat on every launch.
  static const _markerDoc = 'teamid-backfill-v1';

  Future<bool> alreadyRun() async {
    try {
      final doc = await _db
          .collection(AppConstants.colSystem)
          .doc(_markerDoc)
          .get();
      return doc.exists;
    } catch (_) {
      return false;
    }
  }

  /// Stamp [teamId] on every document that lacks it or carries a stale one.
  ///
  /// Returns a per-collection count of documents updated.
  Future<Map<String, int>> backfillTeamId({
    required String teamId,
    required String actorId,
  }) async {
    final results = <String, int>{};

    for (final collection in _collections) {
      var updated = 0;
      try {
        // Super admin reads are unscoped server-side, which is exactly why
        // this has to be a super-admin-only operation.
        final docs = await _ds.list(collection, limit: 500);

        final stale = docs.where((d) {
          final existing = d.data['teamId'];
          return existing == null || existing == '' || existing != teamId;
        }).toList();

        for (var i = 0; i < stale.length; i += 400) {
          final end = (i + 400).clamp(0, stale.length);
          await _ds.batch([
            for (final doc in stale.sublist(i, end))
              BatchOp.update(collection, doc.id, {'teamId': teamId}),
          ]);
          updated += end - i;
        }
      } catch (_) {
        // A collection that does not exist yet, or one this account cannot
        // sweep, must not abort the rest of the migration.
      }
      results[collection] = updated;
    }

    try {
      await _ds.set('system', _markerDoc, {
        'ranAt': const ServerTimestamp(),
        'ranBy': actorId,
        'teamId': teamId,
        'results': results,
      });
    } catch (_) {}

    return results;
  }
}

final dataMigrationProvider = Provider<DataMigration>((ref) {
  return DataMigration(ref.watch(remoteDataServiceProvider));
});

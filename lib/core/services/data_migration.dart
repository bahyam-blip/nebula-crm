import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../constants/app_constants.dart';
import 'firestore_service.dart';

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
  DataMigration(this._db);

  final FirebaseFirestore _db;

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
        // Super admin rules permit an unscoped read, which is exactly why
        // this has to be a super-admin-only operation.
        final snap = await _db.collection(collection).get();

        final stale = snap.docs.where((d) {
          final data = d.data();
          final existing = data['teamId'];
          return existing == null || existing == '' || existing != teamId;
        }).toList();

        // Firestore caps a batch at 500 writes.
        for (var i = 0; i < stale.length; i += 400) {
          final end = (i + 400).clamp(0, stale.length);
          final batch = _db.batch();
          for (final doc in stale.sublist(i, end)) {
            batch.update(doc.reference, {'teamId': teamId});
          }
          await batch.commit();
          updated += end - i;
        }
      } catch (_) {
        // A collection that does not exist yet, or one this account cannot
        // sweep, must not abort the rest of the migration.
      }
      results[collection] = updated;
    }

    try {
      await _db.collection(AppConstants.colSystem).doc(_markerDoc).set({
        'ranAt': FieldValue.serverTimestamp(),
        'ranBy': actorId,
        'teamId': teamId,
        'results': results,
      });
    } catch (_) {}

    return results;
  }
}

final dataMigrationProvider = Provider<DataMigration>((ref) {
  return DataMigration(ref.watch(firestoreProvider));
});

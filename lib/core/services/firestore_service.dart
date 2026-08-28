import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/assistant/models/insight.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/contacts/models/contact.dart';
import '../../features/marketing/models/campaign.dart';
import '../../features/pipeline/models/deal.dart';
import '../../features/service/models/ticket.dart';
import '../constants/app_constants.dart';
import 'remote/data_api.dart';
import 'remote/data_codec.dart';

/// Centralized data access layer — now served by Cloudflare D1 through the
/// Worker (see remote/data_api.dart), not Firestore.
///
/// Every method keeps the exact signature it had in the Firestore days, so
/// providers and screens did not have to change. The realtime `snapshots()`
/// streams became polling streams with the same shapes.
class FirestoreService {
  FirestoreService(this._ds, {this.teamId = ''});

  final RemoteDataSource _ds;

  /// Team the signed-in user belongs to. The Worker ALSO scopes every query
  /// to the caller's team — this stays as belt-and-braces on the client.
  final String teamId;

  Map<String, dynamic> _withTeam(Map<String, dynamic> data) {
    if (teamId.isEmpty) return data;
    return {...data, 'teamId': teamId};
  }

  /// Sort documents newest-first on [field] without any server index.
  List<T> _sortDesc<T>(
    List<DataDoc> docs,
    String field,
    T Function(DataDoc) parse,
  ) {
    final sorted = [...docs]..sort((a, b) {
        final av = a.data[field];
        final bv = b.data[field];
        if (av is Timestamp && bv is Timestamp) return bv.compareTo(av);
        if (bv == null) return -1;
        if (av == null) return 1;
        return 0;
      });
    return sorted.map(parse).toList();
  }

  // ────────────────────────────────────────────────────────────
  // CONTACTS
  // ────────────────────────────────────────────────────────────

  /// Stream contacts owned by [ownerId] or all team contacts if null.
  Stream<List<Contact>> watchContacts({
    String? ownerId,
    int limit = 50,
  }) {
    return _ds.watchList(
      () => _ds
          .list(AppConstants.colContacts,
              where: ownerId != null ? [WhereEq('ownerId', ownerId)] : null, limit: limit)
          .then((docs) => _sortDesc(docs, 'updatedAt', Contact.fromFirestore)),
    );
  }

  Future<Contact?> getContact(String id) async {
    final doc = await _ds.get(AppConstants.colContacts, id);
    if (doc == null) return null;
    return Contact.fromFirestore(doc);
  }

  Future<String> createContact(Contact contact) async {
    return _ds.set(AppConstants.colContacts, null, _withTeam(contact.toFirestore()));
  }

  Future<void> updateContact(Contact contact) async {
    await _ds.set(AppConstants.colContacts, contact.id, contact.toFirestore(), merge: true);
  }

  Future<void> deleteContact(String id) async {
    await _ds.delete(AppConstants.colContacts, id);
  }

  // ────────────────────────────────────────────────────────────
  // ACTIVITIES (timeline)
  // ────────────────────────────────────────────────────────────

  Stream<List<Activity>> watchActivities({
    String? contactId,
    String? dealId,
    int limit = 30,
  }) {
    final where = [
      if (contactId != null) WhereEq('contactId', contactId),
      if (dealId != null) WhereEq('dealId', dealId),
    ];
    return _ds.watchList(
      () => _ds
          .list(AppConstants.colActivities, where: where, limit: limit)
          .then((docs) => _sortDesc(docs, 'timestamp', Activity.fromFirestore)),
    );
  }

  Future<void> logActivity(Activity activity) async {
    await _ds.set(AppConstants.colActivities, null, _withTeam(activity.toFirestore()));
  }

  // ────────────────────────────────────────────────────────────
  // DEALS
  // ────────────────────────────────────────────────────────────

  Stream<List<Deal>> watchDeals({
    String? ownerId,
    String? stage,
    int limit = 100,
  }) {
    final where = [
      if (ownerId != null) WhereEq('ownerId', ownerId),
      if (stage != null) WhereEq('stage', stage),
    ];
    return _ds.watchList(
      () => _ds
          .list(AppConstants.colDeals, where: where, limit: limit)
          .then((docs) => _sortDesc(docs, 'updatedAt', Deal.fromFirestore)),
    );
  }

  Stream<Deal?> watchDeal(String id) {
    return _ds.watchList<Deal?>(
      () async {
        final doc = await _ds.get(AppConstants.colDeals, id);
        return doc == null ? null : Deal.fromFirestore(doc);
      },
      interval: const Duration(seconds: 30),
    );
  }

  Future<Deal?> getDeal(String id) async {
    final doc = await _ds.get(AppConstants.colDeals, id);
    if (doc == null) return null;
    return Deal.fromFirestore(doc);
  }

  Future<String> createDeal(Deal deal) async {
    return _ds.set(AppConstants.colDeals, null, _withTeam(deal.toFirestore()));
  }

  Future<void> updateDeal(Deal deal) async {
    await _ds.set(AppConstants.colDeals, deal.id, deal.toFirestore(), merge: true);
  }

  Future<void> updateDealStage(String dealId, String newStage) async {
    await _ds.update(AppConstants.colDeals, dealId, {
      'stage': newStage,
      'probability': AppConstants.stageProbabilities[newStage],
      'updatedAt': const ServerTimestamp(),
      if (newStage == 'won') 'actualCloseDate': const ServerTimestamp(),
    });
  }

  Future<void> deleteDeal(String id) async {
    await _ds.delete(AppConstants.colDeals, id);
  }

  // ────────────────────────────────────────────────────────────
  // CAMPAIGNS
  // ────────────────────────────────────────────────────────────

  Stream<List<Campaign>> watchCampaigns({String? ownerId, int limit = 50}) {
    return _ds.watchList(
      () => _ds
          .list(AppConstants.colCampaigns,
              where: ownerId != null ? [WhereEq('ownerId', ownerId)] : null, limit: limit)
          .then((docs) => _sortDesc(docs, 'updatedAt', Campaign.fromFirestore)),
    );
  }

  Future<String> createCampaign(Campaign c) async {
    return _ds.set(AppConstants.colCampaigns, null, _withTeam(c.toFirestore()));
  }

  Future<void> updateCampaign(Campaign c) async {
    await _ds.set(AppConstants.colCampaigns, c.id, c.toFirestore(), merge: true);
  }

  // ────────────────────────────────────────────────────────────
  // TICKETS
  // ────────────────────────────────────────────────────────────

  Stream<List<Ticket>> watchTickets({
    String? assigneeId,
    String? status,
    int limit = 50,
  }) {
    final where = [
      if (assigneeId != null) WhereEq('assigneeId', assigneeId),
      if (status != null) WhereEq('status', status),
    ];
    return _ds.watchList(
      () => _ds
          .list(AppConstants.colTickets, where: where, limit: limit)
          .then((docs) => _sortDesc(docs, 'createdAt', Ticket.fromFirestore)),
    );
  }

  Future<String> createTicket(Ticket t) async {
    return _ds.set(AppConstants.colTickets, null, _withTeam(t.toFirestore()));
  }

  Future<void> updateTicket(Ticket t) async {
    await _ds.set(AppConstants.colTickets, t.id, t.toFirestore(), merge: true);
  }

  Future<Ticket?> getTicket(String id) async {
    final doc = await _ds.get(AppConstants.colTickets, id);
    if (doc == null) return null;
    return Ticket.fromFirestore(doc);
  }

  // ────────────────────────────────────────────────────────────
  // KNOWLEDGE BASE ARTICLES
  // ────────────────────────────────────────────────────────────

  Stream<List<Article>> watchArticles({String? category, int limit = 50}) {
    final where = [
      if (category != null) WhereEq('category', category),
      const WhereEq('published', true),
    ];
    return _ds.watchList(
      () => _ds
          .list(AppConstants.colArticles, where: where, limit: limit)
          .then((docs) => _sortDesc(docs, 'updatedAt', Article.fromFirestore)),
    );
  }

  Future<Article?> getArticle(String id) async {
    final doc = await _ds.get(AppConstants.colArticles, id);
    if (doc == null) return null;
    return Article.fromFirestore(doc);
  }

  // ────────────────────────────────────────────────────────────
  // INSIGHTS
  // ────────────────────────────────────────────────────────────

  Stream<List<Insight>> watchInsights({
    required String userId,
    bool includeDismissed = false,
    int limit = 20,
  }) {
    final where = [
      WhereEq('userId', userId),
      if (!includeDismissed) const WhereEq('dismissed', false),
    ];
    return _ds.watchList(
      () => _ds
          .list(AppConstants.colInsights, where: where, limit: limit)
          .then((docs) => _sortDesc(docs, 'generatedAt', Insight.fromFirestore)),
      interval: const Duration(seconds: 45),
    );
  }

  Future<void> dismissInsight(String id) async {
    await _ds.update(AppConstants.colInsights, id, {'dismissed': true});
  }

  Future<void> markInsightActedOn(String id) async {
    await _ds.update(AppConstants.colInsights, id, {'actedOn': true});
  }

  // ────────────────────────────────────────────────────────────
  // AGGREGATIONS (for dashboard KPIs)
  // ────────────────────────────────────────────────────────────

  /// Aggregate pipeline value by stage. Returns map stage→totalValue.
  Future<Map<String, double>> aggregatePipelineByStage(String ownerId) async {
    final docs = await _ds.list(
      AppConstants.colDeals,
      where: [WhereEq('ownerId', ownerId)],
      limit: 500,
    );
    final result = <String, double>{};
    for (final stage in AppConstants.pipelineStages) {
      result[stage] = 0;
    }
    result['lost'] = 0;
    for (final doc in docs) {
      final deal = Deal.fromFirestore(doc);
      result[deal.stage] = (result[deal.stage] ?? 0) + deal.value;
    }
    return result;
  }
}

final firestoreServiceProvider = Provider<FirestoreService>((ref) {
  // Rebuilds when the user's team resolves, so queries are always scoped.
  return FirestoreService(
    ref.watch(remoteDataServiceProvider),
    teamId: ref.watch(currentTeamIdProvider),
  );
});

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/assistant/models/insight.dart';
import '../../features/contacts/models/contact.dart';
import '../../features/marketing/models/campaign.dart';
import '../../features/pipeline/models/deal.dart';
import '../../features/service/models/ticket.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../constants/app_constants.dart';

/// Firestore instance provider.
final firestoreProvider = Provider<FirebaseFirestore>((ref) {
  return FirebaseFirestore.instance;
});

/// Generic paginated query result.
class PaginatedResult<T> {
  const PaginatedResult({required this.items, this.lastDoc, this.hasMore = true});
  final List<T> items;
  final DocumentSnapshot? lastDoc;
  final bool hasMore;
}

/// Centralized Firestore data access layer.
///
/// Each method returns parsed model objects (never raw snapshots) so
/// the UI stays clean. Errors propagate as exceptions — wrap in
/// `try/catch` or use `AsyncValue.guard` in providers.
class FirestoreService {
  FirestoreService(this._db, {this.teamId = ''});

  final FirebaseFirestore _db;

  /// Team the signed-in user belongs to.
  ///
  /// Every rule scopes reads with `resource.data.teamId == userTeamId()`.
  /// Firestore does not filter a query down to the documents you may see -
  /// it rejects the whole query unless the query itself proves it only asks
  /// for permitted documents. So an unscoped `.collection('contacts')` is
  /// denied outright, which is why the app showed permission-denied
  /// everywhere. Every collection query below must carry this filter.
  final String teamId;

  /// Stamp teamId on every write so the document is readable afterwards.
  Map<String, dynamic> _withTeam(Map<String, dynamic> data) {
    if (teamId.isEmpty) return data;
    return {...data, 'teamId': teamId};
  }

  Query _scoped(String collection) {
    final Query q = _db.collection(collection);
    return teamId.isEmpty ? q : q.where('teamId', isEqualTo: teamId);
  }

  // ────────────────────────────────────────────────────────────
  // CONTACTS
  // ────────────────────────────────────────────────────────────

  /// Stream contacts owned by [ownerId] or all team contacts if null.
  Stream<List<Contact>> watchContacts({
    String? ownerId,
    int limit = 50,
  }) {
    Query query = _scoped(AppConstants.colContacts);
    if (ownerId != null) query = query.where('ownerId', isEqualTo: ownerId);
    query = query.orderBy('updatedAt', descending: true).limit(limit);
    return query.snapshots().map((snap) =>
        snap.docs.map((d) => Contact.fromFirestore(d)).toList());
  }

  Future<Contact?> getContact(String id) async {
    final doc = await _db.collection(AppConstants.colContacts).doc(id).get();
    if (!doc.exists) return null;
    return Contact.fromFirestore(doc);
  }

  Future<String> createContact(Contact contact) async {
    final ref = await _db
        .collection(AppConstants.colContacts)
        .add(_withTeam(contact.toFirestore()));
    return ref.id;
  }

  Future<void> updateContact(Contact contact) async {
    await _db
        .collection(AppConstants.colContacts)
        .doc(contact.id)
        .set(contact.toFirestore(), SetOptions(merge: true));
  }

  Future<void> deleteContact(String id) async {
    await _db.collection(AppConstants.colContacts).doc(id).delete();
  }

  // ────────────────────────────────────────────────────────────
  // ACTIVITIES (timeline)
  // ────────────────────────────────────────────────────────────

  Stream<List<Activity>> watchActivities({
    String? contactId,
    String? dealId,
    int limit = 30,
  }) {
    Query query = _scoped(AppConstants.colActivities);
    if (contactId != null) {
      query = query.where('contactId', isEqualTo: contactId);
    } else if (dealId != null) {
      query = query.where('dealId', isEqualTo: dealId);
    }
    query = query.orderBy('timestamp', descending: true).limit(limit);
    return query.snapshots().map((snap) =>
        snap.docs.map((d) => Activity.fromFirestore(d)).toList());
  }

  Future<void> logActivity(Activity activity) async {
    await _db.collection(AppConstants.colActivities).add(_withTeam(activity.toFirestore()));
  }

  // ────────────────────────────────────────────────────────────
  // DEALS
  // ────────────────────────────────────────────────────────────

  Stream<List<Deal>> watchDeals({
    String? ownerId,
    String? stage,
    int limit = 100,
  }) {
    Query query = _scoped(AppConstants.colDeals);
    if (ownerId != null) query = query.where('ownerId', isEqualTo: ownerId);
    if (stage != null) query = query.where('stage', isEqualTo: stage);
    query = query.orderBy('updatedAt', descending: true).limit(limit);
    return query.snapshots().map((snap) =>
        snap.docs.map((d) => Deal.fromFirestore(d)).toList());
  }

  Stream<Deal?> watchDeal(String id) {
    return _db.collection(AppConstants.colDeals).doc(id).snapshots().map(
          (d) => d.exists ? Deal.fromFirestore(d) : null,
        );
  }

  Future<Deal?> getDeal(String id) async {
    final doc = await _db.collection(AppConstants.colDeals).doc(id).get();
    if (!doc.exists) return null;
    return Deal.fromFirestore(doc);
  }

  Future<String> createDeal(Deal deal) async {
    final ref =
        await _db.collection(AppConstants.colDeals).add(_withTeam(deal.toFirestore()));
    return ref.id;
  }

  Future<void> updateDeal(Deal deal) async {
    await _db
        .collection(AppConstants.colDeals)
        .doc(deal.id)
        .set(deal.toFirestore(), SetOptions(merge: true));
  }

  Future<void> updateDealStage(String dealId, String newStage) async {
    await _db.collection(AppConstants.colDeals).doc(dealId).update({
      'stage': newStage,
      'probability': AppConstants.stageProbabilities[newStage],
      'updatedAt': FieldValue.serverTimestamp(),
      if (newStage == 'won') ...{
        'actualCloseDate': FieldValue.serverTimestamp(),
      },
    });
  }

  Future<void> deleteDeal(String id) async {
    await _db.collection(AppConstants.colDeals).doc(id).delete();
  }

  // ────────────────────────────────────────────────────────────
  // CAMPAIGNS
  // ────────────────────────────────────────────────────────────

  Stream<List<Campaign>> watchCampaigns({String? ownerId, int limit = 50}) {
    Query query = _scoped(AppConstants.colCampaigns);
    if (ownerId != null) query = query.where('ownerId', isEqualTo: ownerId);
    query = query.orderBy('updatedAt', descending: true).limit(limit);
    return query.snapshots().map((snap) =>
        snap.docs.map((d) => Campaign.fromFirestore(d)).toList());
  }

  Future<String> createCampaign(Campaign c) async {
    final ref =
        await _db.collection(AppConstants.colCampaigns).add(_withTeam(c.toFirestore()));
    return ref.id;
  }

  Future<void> updateCampaign(Campaign c) async {
    await _db
        .collection(AppConstants.colCampaigns)
        .doc(c.id)
        .set(c.toFirestore(), SetOptions(merge: true));
  }

  // ────────────────────────────────────────────────────────────
  // TICKETS
  // ────────────────────────────────────────────────────────────

  Stream<List<Ticket>> watchTickets({
    String? assigneeId,
    String? status,
    int limit = 50,
  }) {
    Query query = _scoped(AppConstants.colTickets);
    if (assigneeId != null) {
      query = query.where('assigneeId', isEqualTo: assigneeId);
    }
    if (status != null) {
      query = query.where('status', isEqualTo: status);
    }
    query = query.orderBy('createdAt', descending: true).limit(limit);
    return query.snapshots().map((snap) =>
        snap.docs.map((d) => Ticket.fromFirestore(d)).toList());
  }

  Future<String> createTicket(Ticket t) async {
    final ref =
        await _db.collection(AppConstants.colTickets).add(_withTeam(t.toFirestore()));
    return ref.id;
  }

  Future<void> updateTicket(Ticket t) async {
    await _db
        .collection(AppConstants.colTickets)
        .doc(t.id)
        .set(t.toFirestore(), SetOptions(merge: true));
  }

  Future<Ticket?> getTicket(String id) async {
    final doc = await _db.collection(AppConstants.colTickets).doc(id).get();
    if (!doc.exists) return null;
    return Ticket.fromFirestore(doc);
  }

  // ────────────────────────────────────────────────────────────
  // KNOWLEDGE BASE ARTICLES
  // ────────────────────────────────────────────────────────────

  Stream<List<Article>> watchArticles({String? category, int limit = 50}) {
    Query query = _scoped(AppConstants.colArticles);
    if (category != null) query = query.where('category', isEqualTo: category);
    query = query
        .where('published', isEqualTo: true)
        .orderBy('updatedAt', descending: true)
        .limit(limit);
    return query.snapshots().map((snap) =>
        snap.docs.map((d) => Article.fromFirestore(d)).toList());
  }

  Future<Article?> getArticle(String id) async {
    final doc = await _db.collection(AppConstants.colArticles).doc(id).get();
    if (!doc.exists) return null;
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
    Query query = _db
        .collection(AppConstants.colInsights)
        .where('userId', isEqualTo: userId);
    if (!includeDismissed) {
      query = query.where('dismissed', isEqualTo: false);
    }
    query = query.orderBy('generatedAt', descending: true).limit(limit);
    return query.snapshots().map((snap) =>
        snap.docs.map((d) => Insight.fromFirestore(d)).toList());
  }

  Future<void> dismissInsight(String id) async {
    await _db.collection(AppConstants.colInsights).doc(id).update({
      'dismissed': true,
    });
  }

  Future<void> markInsightActedOn(String id) async {
    await _db.collection(AppConstants.colInsights).doc(id).update({
      'actedOn': true,
    });
  }

  // ────────────────────────────────────────────────────────────
  // AGGREGATIONS (for dashboard KPIs)
  // ────────────────────────────────────────────────────────────

  /// Aggregate pipeline value by stage. Returns map stage→totalValue.
  Future<Map<String, double>> aggregatePipelineByStage(String ownerId) async {
    final snap = await _db
        .collection(AppConstants.colDeals)
        .where('ownerId', isEqualTo: ownerId)
        .get();
    final result = <String, double>{};
    for (final stage in AppConstants.pipelineStages) {
      result[stage] = 0;
    }
    result['lost'] = 0;
    for (final doc in snap.docs) {
      final deal = Deal.fromFirestore(doc);
      result[deal.stage] = (result[deal.stage] ?? 0) + deal.value;
    }
    return result;
  }
}

final firestoreServiceProvider = Provider<FirestoreService>((ref) {
  // Rebuilds when the user's team resolves, so queries are always scoped.
  return FirestoreService(
    ref.watch(firestoreProvider),
    teamId: ref.watch(currentTeamIdProvider),
  );
});

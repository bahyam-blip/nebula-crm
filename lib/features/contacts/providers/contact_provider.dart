import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/firestore_service.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/contact.dart';
import '../../pipeline/models/deal.dart';

// ────────────────────────────────────────────────────────────────
// CONTACTS
// ────────────────────────────────────────────────────────────────

/// Stream of contacts owned by the current user.
final contactsProvider = StreamProvider<List<Contact>>((ref) {
  final ownerId = ref.watch(currentUserIdProvider);
  final db = ref.watch(firestoreServiceProvider);
  return db.watchContacts(ownerId: ownerId);
});

/// Search query for the contacts list.
final contactSearchProvider = StateProvider<String>((ref) => '');

/// Filtered contacts (search query applied client-side for snappy UX).
final filteredContactsProvider = Provider<List<Contact>>((ref) {
  final contacts = ref.watch(contactsProvider).valueOrNull ?? [];
  final query = ref.watch(contactSearchProvider).trim().toLowerCase();
  if (query.isEmpty) return contacts;
  return contacts.where((c) {
    return c.name.toLowerCase().contains(query) ||
        (c.email?.toLowerCase().contains(query) ?? false) ||
        (c.company?.toLowerCase().contains(query) ?? false) ||
        (c.phone?.toLowerCase().contains(query) ?? false);
  }).toList();
});

/// Active contact detail (pushed screen).
final contactByIdProvider =
    FutureProvider.family<Contact?, String>((ref, id) async {
  final db = ref.watch(firestoreServiceProvider);
  return db.getContact(id);
});

/// Activities timeline for a given contact.
final contactActivitiesProvider =
    StreamProvider.family<List<Activity>, String>((ref, contactId) {
  final db = ref.watch(firestoreServiceProvider);
  return db.watchActivities(contactId: contactId);
});

// ────────────────────────────────────────────────────────────────
// DEALS / PIPELINE
// ────────────────────────────────────────────────────────────────

/// All open deals for the current user.
final dealsProvider = StreamProvider<List<Deal>>((ref) {
  final ownerId = ref.watch(currentUserIdProvider);
  final db = ref.watch(firestoreServiceProvider);
  return db.watchDeals(ownerId: ownerId);
});

/// Deals grouped by stage — ready for Kanban rendering.
final dealsByStageProvider = Provider<Map<String, List<Deal>>>((ref) {
  final deals = ref.watch(dealsProvider).valueOrNull ?? [];
  final map = <String, List<Deal>>{};
  for (final stage in const ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']) {
    map[stage] = [];
  }
  for (final d in deals) {
    map.putIfAbsent(d.stage, () => []).add(d);
  }
  return map;
});

/// Pipeline summary: total open value, weighted forecast, count.
final pipelineSummaryProvider = Provider<PipelineSummary>((ref) {
  final deals = ref.watch(dealsProvider).valueOrNull ?? [];
  var openValue = 0.0;
  var weightedValue = 0.0;
  var wonValue = 0.0;
  var openCount = 0;
  var wonCount = 0;
  for (final d in deals) {
    if (d.isWon) {
      wonValue += d.value;
      wonCount++;
    } else if (d.isOpen) {
      openValue += d.value;
      openCount++;
      weightedValue += d.effectiveWeighted;
    }
  }
  return PipelineSummary(
    openValue: openValue,
    weightedValue: weightedValue,
    wonValue: wonValue,
    openCount: openCount,
    wonCount: wonCount,
  );
});

class PipelineSummary {
  const PipelineSummary({
    required this.openValue,
    required this.weightedValue,
    required this.wonValue,
    required this.openCount,
    required this.wonCount,
  });
  final double openValue;
  final double weightedValue;
  final double wonValue;
  final int openCount;
  final int wonCount;
}

/// Single deal by id (detail screen).
final dealByIdProvider =
    StreamProvider.family<Deal?, String>((ref, id) {
  final db = ref.watch(firestoreServiceProvider);
  return db.watchDeal(id);
});

/// Activities timeline for a given deal.
final dealActivitiesProvider =
    StreamProvider.family<List<Activity>, String>((ref, dealId) {
  final db = ref.watch(firestoreServiceProvider);
  return db.watchActivities(dealId: dealId);
});

/// All recent activities for the current user (across all contacts/deals).
/// Used by the dashboard and RecentActivity widget.
final recentActivitiesProvider = StreamProvider<List<Activity>>((ref) {
  // For now, just pull the most recent activities globally. Production
  // would filter by `ownerId == currentUserId` via Firestore query.
  final db = ref.watch(firestoreServiceProvider);
  return db.watchActivities();
});

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/firestore_service.dart';
import '../../../core/utils/extensions.dart';
import '../../contacts/providers/contact_provider.dart';
import '../../auth/providers/auth_provider.dart';
import '../../assistant/models/insight.dart';

// ────────────────────────────────────────────────────────────────
// DASHBOARD DATA
// ────────────────────────────────────────────────────────────────

/// Top-level dashboard provider — combines multiple streams into a
/// single snapshot for the dashboard screen.
///
/// WATCHES (not reads) the underlying streams: with `ref.read` the KPIs
/// froze at whatever happened to be loaded on first build (usually zeros)
/// and never refreshed. Deriving from watched values means the dashboard
/// recomputes the moment contacts/deals streams emit.
final dashboardDataProvider = FutureProvider.autoDispose<DashboardData>((ref) async {
  final userId = ref.watch(currentUserIdProvider);
  final db = ref.watch(firestoreServiceProvider);

  final contacts = ref.watch(contactsProvider).valueOrNull ?? const [];
  final summary = ref.watch(pipelineSummaryProvider);
  final insights = await _fetchInsights(ref, db, userId);

  return DashboardData(
    contactsCount: contacts.length,
    newContactsThisWeek:
        contacts.where((c) => c.createdAt?.isThisWeek ?? false).length,
    openPipelineValue: summary.openValue,
    weightedForecast: summary.weightedValue,
    wonThisMonth: summary.wonValue,
    openDeals: summary.openCount,
    wonDeals: summary.wonCount,
    insights: insights,
  );
});

Future<List<Insight>> _fetchInsights(
  Ref ref,
  FirestoreService db,
  String userId,
) async {
  try {
    final stream = db.watchInsights(userId: userId);
    return await stream.first.timeout(const Duration(seconds: 15),
        onTimeout: () => const []);
  } catch (_) {
    return const [];
  }
}

/// Snapshot of dashboard KPIs.
class DashboardData {
  const DashboardData({
    required this.contactsCount,
    required this.newContactsThisWeek,
    required this.openPipelineValue,
    required this.weightedForecast,
    required this.wonThisMonth,
    required this.openDeals,
    required this.wonDeals,
    required this.insights,
  });

  final int contactsCount;
  final int newContactsThisWeek;
  final double openPipelineValue;
  final double weightedForecast;
  final double wonThisMonth;
  final int openDeals;
  final int wonDeals;
  final List<Insight> insights;

  double get winRate => (openDeals + wonDeals) > 0
      ? (wonDeals / (openDeals + wonDeals)) * 100
      : 0;
}

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/firestore_service.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/campaign.dart';

final campaignsProvider = StreamProvider<List<Campaign>>((ref) {
  final ownerId = ref.watch(currentUserIdProvider);
  final db = ref.watch(firestoreServiceProvider);
  return db.watchCampaigns(ownerId: ownerId);
});

final campaignByIdProvider =
    StreamProvider.family<Campaign?, String>((ref, id) async* {
  // Stream from the full list (cached) — production would use a direct doc stream.
  final db = ref.watch(firestoreServiceProvider);
  final all = ref.watch(campaignsProvider).valueOrNull ?? [];
  Campaign? match = all.where((c) => c.id == id).firstOrNull;
  yield match;
  await for (final list in db.watchCampaigns()) {
    yield list.where((c) => c.id == id).firstOrNull;
  }
});

/// Filter: status (null = all).
final campaignStatusFilterProvider =
    StateProvider<String?>((ref) => null);

final filteredCampaignsProvider = Provider<List<Campaign>>((ref) {
  final all = ref.watch(campaignsProvider).valueOrNull ?? [];
  final status = ref.watch(campaignStatusFilterProvider);
  if (status == null) return all;
  return all.where((c) => c.status == status).toList();
});

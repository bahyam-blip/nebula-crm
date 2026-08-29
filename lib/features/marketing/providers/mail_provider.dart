import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/mail_api_service.dart';

/// Mailer configuration + health. Refresh after config changes or a run.
final mailStatusProvider =
    FutureProvider.autoDispose<MailStatus>((ref) {
  return ref.watch(mailApiProvider).status();
});

/// All AI mail tasks (newest first, returned by the Worker).
final mailTasksProvider =
    FutureProvider.autoDispose<List<MailTask>>((ref) {
  return ref.watch(mailApiProvider).tasks();
});

/// Latest analytics snapshot (cached server-side; [refresh] pulls fresh).
final mailAnalyticsProvider =
    FutureProvider.autoDispose<MailAnalytics?>((ref) {
  return ref.watch(mailApiProvider).analytics(refresh: false);
});

/// True while any task is pending/planning/active — screens use this to
/// poll the task list until the AI finishes.
final mailHasActiveTasksProvider = Provider<bool>((ref) {
  final tasks = ref.watch(mailTasksProvider).valueOrNull ?? const [];
  return tasks.any((t) => t.isActive);
});

/// What the AI knows about the business (facts + creative playbook).
final mailMemoryProvider =
    FutureProvider.autoDispose<MailMemory>((ref) {
  return ref.watch(mailApiProvider).memory();
});

/// The business profile every email is branded with (name, logo, colors,
/// signature, website) — edited on the Business Profile screen.
final mailBusinessProvider =
    FutureProvider.autoDispose<BusinessProfile>((ref) {
  return ref.watch(mailApiProvider).businessProfile();
});

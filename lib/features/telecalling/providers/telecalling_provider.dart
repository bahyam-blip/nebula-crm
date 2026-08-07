import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/firestore_service.dart';
import '../../auth/models/app_user.dart';
import '../../auth/providers/auth_provider.dart';
import '../../contacts/models/call_status.dart';
import '../../contacts/models/contact.dart';
import '../models/call_log.dart';
import '../services/telecalling_service.dart';

final telecallingServiceProvider = Provider<TelecallingService>((ref) {
  return TelecallingService(ref.watch(firestoreProvider));
});

/// Everyone on the current user's team.
final teamMembersListProvider = StreamProvider<List<AppUser>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <AppUser>[]);
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colUsers)
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((s) => s.docs.map(AppUser.fromFirestore).toList());
});

/// Leads assigned to the signed-in telecaller.
///
/// Deliberately a single `where` with no `orderBy`: combining them would
/// demand a composite index, and sorting a personal queue client-side is
/// cheap. Ordering happens in [myQueueProvider].
final myLeadsProvider = StreamProvider<List<Contact>>((ref) {
  final uid = ref.watch(currentUserIdProvider);
  if (uid.isEmpty) return Stream.value(const <Contact>[]);
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colContacts)
      .where('assignedTo', isEqualTo: uid)
      .snapshots()
      .map((s) => s.docs.map(Contact.fromFirestore).toList());
});

/// All leads belonging to the team (managers and above).
final teamLeadsProvider = StreamProvider<List<Contact>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <Contact>[]);
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colContacts)
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((s) => s.docs.map(Contact.fromFirestore).toList());
});

/// How the telecaller's queue is filtered.
enum QueueFilter { due, open, all, closed }

extension QueueFilterX on QueueFilter {
  String get label {
    switch (this) {
      case QueueFilter.due:
        return 'Due now';
      case QueueFilter.open:
        return 'Open';
      case QueueFilter.all:
        return 'All';
      case QueueFilter.closed:
        return 'Closed';
    }
  }
}

final queueFilterProvider =
    StateProvider<QueueFilter>((ref) => QueueFilter.due);

/// The telecaller's working queue: filtered, then ordered by urgency.
///
/// Priority: overdue callbacks first (a broken promise is the most
/// expensive thing in the queue), then never-called leads, then the rest
/// oldest-touched first so nothing rots at the bottom.
final myQueueProvider = Provider<List<Contact>>((ref) {
  final leads = ref.watch(myLeadsProvider).valueOrNull ?? const <Contact>[];
  final filter = ref.watch(queueFilterProvider);

  final filtered = leads.where((c) {
    switch (filter) {
      case QueueFilter.due:
        return c.isFollowUpDue || c.callStatus == CallStatus.notCalled;
      case QueueFilter.open:
        return c.callStatus.isOpen;
      case QueueFilter.closed:
        return !c.callStatus.isOpen;
      case QueueFilter.all:
        return true;
    }
  }).toList();

  int rank(Contact c) {
    if (c.isFollowUpDue) return 0;
    if (c.callStatus == CallStatus.notCalled) return 1;
    if (c.callStatus == CallStatus.callback) return 2;
    if (c.callStatus.isOpen) return 3;
    return 4;
  }

  filtered.sort((a, b) {
    final r = rank(a).compareTo(rank(b));
    if (r != 0) return r;
    final at = a.lastCallAt ?? DateTime.fromMillisecondsSinceEpoch(0);
    final bt = b.lastCallAt ?? DateTime.fromMillisecondsSinceEpoch(0);
    return at.compareTo(bt);
  });
  return filtered;
});

/// Call history for one contact, newest first.
final contactCallLogsProvider =
    StreamProvider.family<List<CallLog>, String>((ref, contactId) {
  return ref
      .watch(firestoreProvider)
      .collection(TeleCollections.callLogs)
      .where('contactId', isEqualTo: contactId)
      .snapshots()
      .map((s) {
    final logs = s.docs.map(CallLog.fromFirestore).toList()
      ..sort((a, b) => (b.createdAt ?? DateTime(0))
          .compareTo(a.createdAt ?? DateTime(0)));
    return logs;
  });
});

/// Team-wide call logs, used by the manager dashboard.
final teamCallLogsProvider = StreamProvider<List<CallLog>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <CallLog>[]);
  return ref
      .watch(firestoreProvider)
      .collection(TeleCollections.callLogs)
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((s) => s.docs.map(CallLog.fromFirestore).toList());
});

/// How far back the dashboard looks.
final dashboardRangeDaysProvider = StateProvider<int>((ref) => 7);

/// Per-caller performance for the selected window.
final callerStatsProvider = Provider<List<CallerStats>>((ref) {
  final members =
      ref.watch(teamMembersListProvider).valueOrNull ?? const <AppUser>[];
  final leads = ref.watch(teamLeadsProvider).valueOrNull ?? const <Contact>[];
  final logs =
      ref.watch(teamCallLogsProvider).valueOrNull ?? const <CallLog>[];
  final days = ref.watch(dashboardRangeDaysProvider);

  final cutoff = DateTime.now().subtract(Duration(days: days));
  final windowed = logs
      .where((l) => l.createdAt == null || l.createdAt!.isAfter(cutoff))
      .toList();

  return TelecallingService.buildStats(
    callers: members,
    contacts: leads,
    logs: windowed,
  );
});

/// Daily call counts for the selected window, oldest day first.
final callsPerDayProvider = Provider<List<int>>((ref) {
  final logs =
      ref.watch(teamCallLogsProvider).valueOrNull ?? const <CallLog>[];
  final days = ref.watch(dashboardRangeDaysProvider);
  final today = DateTime.now();
  final buckets = List<int>.filled(days, 0);

  for (final l in logs) {
    final t = l.createdAt;
    if (t == null) continue;
    final delta = DateTime(today.year, today.month, today.day)
        .difference(DateTime(t.year, t.month, t.day))
        .inDays;
    if (delta >= 0 && delta < days) buckets[days - 1 - delta]++;
  }
  return buckets;
});

// ── Super admin ──────────────────────────────────────────────────

/// Every user across every team. Super admin only.
final allUsersGlobalProvider = StreamProvider<List<AppUser>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colUsers)
      .snapshots()
      .map((s) => s.docs.map(AppUser.fromFirestore).toList());
});

/// Recent privileged actions, newest first.
final auditLogProvider = StreamProvider<List<AuditEntry>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection(TeleCollections.auditLogs)
      .orderBy('createdAt', descending: true)
      .limit(100)
      .snapshots()
      .map((s) => s.docs.map(AuditEntry.fromFirestore).toList());
});

/// Lead totals per team, for the cross-team overview.
final allContactsGlobalProvider = StreamProvider<List<Contact>>((ref) {
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colContacts)
      .snapshots()
      .map((s) => s.docs.map(Contact.fromFirestore).toList());
});

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/firestore_service.dart';
import '../../auth/models/app_user.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/task.dart';

const String kTasksCollection = 'tasks';

class TaskService {
  TaskService(this._db);

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> get _col =>
      _db.collection(kTasksCollection);

  Future<String> create(CrmTask task) async {
    final ref = await _col.add(task.toFirestore());
    return ref.id;
  }

  Future<void> setStatus(String id, TaskStatus status) {
    return _col.doc(id).update({
      'status': status.name,
      'completedAt': status == TaskStatus.completed
          ? FieldValue.serverTimestamp()
          : null,
      // Completing a task settles its reminder too, so it stops nagging.
      if (status == TaskStatus.completed) 'acknowledged': true,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> acknowledge(String id) {
    return _col.doc(id).update({
      'acknowledged': true,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> reassign(String id, String? userId, String userName) {
    return _col.doc(id).update({
      'assignedTo': userId,
      'assignedToName': userName,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> snooze(String id, Duration by) {
    return _col.doc(id).update({
      'remindAt': Timestamp.fromDate(DateTime.now().add(by)),
      'acknowledged': false,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> delete(String id) => _col.doc(id).delete();
}

final taskServiceProvider = Provider<TaskService>((ref) {
  return TaskService(ref.watch(firestoreProvider));
});

/// All tasks for the current team.
///
/// One `where` and no `orderBy`, so no composite index is required;
/// ordering happens in [visibleTasksProvider].
final teamTasksProvider = StreamProvider<List<CrmTask>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <CrmTask>[]);
  return ref
      .watch(firestoreProvider)
      .collection(kTasksCollection)
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((s) => s.docs.map(CrmTask.fromFirestore).toList());
});

enum TaskScope { mine, all }

enum TaskFilter { open, today, overdue, completed, all }

extension TaskFilterX on TaskFilter {
  String get label {
    switch (this) {
      case TaskFilter.open:
        return 'Open';
      case TaskFilter.today:
        return 'Today';
      case TaskFilter.overdue:
        return 'Overdue';
      case TaskFilter.completed:
        return 'Done';
      case TaskFilter.all:
        return 'All';
    }
  }
}

final taskScopeProvider = StateProvider<TaskScope>((ref) => TaskScope.mine);
final taskFilterProvider = StateProvider<TaskFilter>((ref) => TaskFilter.open);

/// Tasks after scope + filter, ordered by urgency.
///
/// Overdue first, then due-today, then by priority, then by due date.
/// A task with no due date sinks below dated ones rather than blocking
/// the top of the list.
final visibleTasksProvider = Provider<List<CrmTask>>((ref) {
  final all = ref.watch(teamTasksProvider).valueOrNull ?? const <CrmTask>[];
  final uid = ref.watch(currentUserIdProvider);
  final scope = ref.watch(taskScopeProvider);
  final filter = ref.watch(taskFilterProvider);

  var list = all.where((t) {
    if (scope == TaskScope.mine && t.assignedTo != uid) return false;
    switch (filter) {
      case TaskFilter.open:
        return t.status.isOpen;
      case TaskFilter.today:
        return t.status.isOpen && (t.isDueToday || t.isOverdue);
      case TaskFilter.overdue:
        return t.isOverdue;
      case TaskFilter.completed:
        return t.status == TaskStatus.completed;
      case TaskFilter.all:
        return t.status != TaskStatus.archived;
    }
  }).toList();

  int rank(CrmTask t) {
    if (t.isOverdue) return 0;
    if (t.isDueToday) return 1;
    if (t.status.isOpen) return 2;
    return 3;
  }

  list.sort((a, b) {
    final r = rank(a).compareTo(rank(b));
    if (r != 0) return r;
    final p = b.priority.weight.compareTo(a.priority.weight);
    if (p != 0) return p;
    final ad = a.dueAt ?? DateTime(9999);
    final bd = b.dueAt ?? DateTime(9999);
    return ad.compareTo(bd);
  });
  return list;
});

/// Reminders that have fired and nobody has dismissed (spec §15).
final dueRemindersProvider = Provider<List<CrmTask>>((ref) {
  final all = ref.watch(teamTasksProvider).valueOrNull ?? const <CrmTask>[];
  final uid = ref.watch(currentUserIdProvider);
  return all
      .where((t) => t.assignedTo == uid && t.needsAttention)
      .toList()
    ..sort((a, b) => (a.remindAt ?? DateTime(0))
        .compareTo(b.remindAt ?? DateTime(0)));
});

/// Counts for the dashboard.
final taskCountsProvider = Provider<({int open, int overdue, int today})>((ref) {
  final all = ref.watch(teamTasksProvider).valueOrNull ?? const <CrmTask>[];
  final uid = ref.watch(currentUserIdProvider);
  final mine = all.where((t) => t.assignedTo == uid);
  return (
    open: mine.where((t) => t.status.isOpen).length,
    overdue: mine.where((t) => t.isOverdue).length,
    today: mine.where((t) => t.isDueToday && t.status.isOpen).length,
  );
});

/// Tasks attached to one contact, for the customer timeline (spec §7).
final contactTasksProvider =
    StreamProvider.family<List<CrmTask>, String>((ref, contactId) {
  return ref
      .watch(firestoreProvider)
      .collection(kTasksCollection)
      .where('relatedContactId', isEqualTo: contactId)
      .snapshots()
      .map((s) {
    final list = s.docs.map(CrmTask.fromFirestore).toList()
      ..sort((a, b) =>
          (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
    return list;
  });
});

/// Teammates available as assignees.
final assignableUsersProvider = Provider<List<AppUser>>((ref) {
  return ref.watch(teamMembersForTasksProvider).valueOrNull ?? const <AppUser>[];
});

final teamMembersForTasksProvider = StreamProvider<List<AppUser>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <AppUser>[]);
  return ref
      .watch(firestoreProvider)
      .collection('users')
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((s) => s.docs.map(AppUser.fromFirestore).toList());
});

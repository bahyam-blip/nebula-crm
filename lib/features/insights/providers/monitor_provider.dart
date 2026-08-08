import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/models/app_user.dart';
import '../../auth/providers/auth_provider.dart';
import '../../commissions/providers/commission_provider.dart';
import '../../contacts/models/call_status.dart';
import '../../contacts/models/contact.dart';
import '../../tasks/models/task.dart';
import '../../tasks/providers/task_provider.dart';
import '../../telecalling/providers/telecalling_provider.dart';

/// How much attention a signal deserves.
enum SignalLevel { critical, warning, info, good }

/// Something the app noticed without being asked.
class Signal {
  const Signal({
    required this.level,
    required this.title,
    required this.detail,
    this.action,
    this.route,
  });

  final SignalLevel level;
  final String title;
  final String detail;
  final String? action;
  final String? route;
}

/// Watches the pipeline and surfaces what needs attention.
///
/// Computed on-device from data already loaded, not by asking the model.
/// Counting overdue callbacks is arithmetic; sending it to a language
/// model would make it slower, cost money and occasionally get the number
/// wrong. The AI's job is to explain and prioritise these, not to derive
/// them - which is why [monitorSignalsProvider] is the source of truth and
/// the assistant is handed its output.
final monitorSignalsProvider = Provider<List<Signal>>((ref) {
  final me = ref.watch(currentAppUserValueProvider);
  if (me == null) return const [];

  final isManager = me.role.canManageTeam;
  final leads = ref.watch(teamLeadsProvider).valueOrNull ?? const <Contact>[];
  final tasks = ref.watch(teamTasksProvider).valueOrNull ?? const <CrmTask>[];
  final members =
      ref.watch(teamMembersListProvider).valueOrNull ?? const <AppUser>[];
  final logs = ref.watch(teamCallLogsProvider).valueOrNull ?? const [];

  final now = DateTime.now();
  final todayStart = DateTime(now.year, now.month, now.day);
  final mine = leads.where((c) => c.assignedTo == me.id).toList();
  final scope = isManager ? leads : mine;

  final out = <Signal>[];

  // ── Broken promises first. Nothing costs more trust than a missed
  // callback the customer was told to expect.
  final overdue = scope.where((c) => c.isFollowUpDue).length;
  if (overdue > 0) {
    out.add(Signal(
      level: SignalLevel.critical,
      title: '$overdue callback${overdue == 1 ? '' : 's'} overdue',
      detail: 'These customers were promised a call that has not happened.',
      action: 'Open queue',
      route: '/my-leads',
    ));
  }

  // ── Overdue tasks.
  final lateTasks = tasks
      .where((t) =>
          t.status != TaskStatus.completed &&
          t.dueAt != null &&
          t.dueAt!.isBefore(now) &&
          (isManager || t.assignedTo == me.id))
      .length;
  if (lateTasks > 0) {
    out.add(Signal(
      level: SignalLevel.warning,
      title: '$lateTasks task${lateTasks == 1 ? '' : 's'} overdue',
      detail: 'Past their due date and still open.',
      action: 'Open tasks',
      route: '/tasks',
    ));
  }

  // ── Leads nobody owns cannot be worked by anyone.
  if (isManager) {
    final unassigned =
        leads.where((c) => c.assignedTo == null && c.callStatus.isOpen).length;
    if (unassigned > 0) {
      out.add(Signal(
        level: unassigned > 50 ? SignalLevel.warning : SignalLevel.info,
        title: '$unassigned leads unassigned',
        detail: 'Nobody is working these. Share them out to start calling.',
        action: 'Distribute',
        route: '/leads/distribute',
      ));
    }
  }

  // ── Leads going stale. Untouched for a fortnight is effectively cold.
  final stale = scope.where((c) {
    if (!c.callStatus.isOpen) return false;
    final last = c.lastActivityAt ?? c.createdAt;
    if (last == null) return false;
    return now.difference(last).inDays >= 14;
  }).length;
  if (stale > 0) {
    out.add(Signal(
      level: SignalLevel.warning,
      title: '$stale leads going cold',
      detail: 'No contact in over two weeks. Call or close them out.',
      action: 'Open contacts',
      route: '/contacts',
    ));
  }

  // ── Never called at all.
  final untouched =
      scope.where((c) => c.callStatus == CallStatus.notCalled).length;
  if (untouched > 0) {
    out.add(Signal(
      level: SignalLevel.info,
      title: '$untouched leads never called',
      detail: 'Fresh leads waiting for a first attempt.',
      action: 'Open queue',
      route: '/my-leads',
    ));
  }

  // ── Silent callers. A manager needs to know before the day is gone.
  if (isManager) {
    final activeToday = logs
        .where((l) => l.createdAt != null && l.createdAt!.isAfter(todayStart))
        .map((l) => l.callerId)
        .toSet();
    final idle = members
        .where((m) =>
            m.id != me.id &&
            m.role != UserRole.viewer &&
            !activeToday.contains(m.id) &&
            leads.any((c) => c.assignedTo == m.id && c.callStatus.isOpen))
        .map((m) => m.displayName)
        .toList();
    if (idle.isNotEmpty && now.hour >= 11) {
      out.add(Signal(
        level: SignalLevel.warning,
        title: '${idle.length} with no calls today',
        detail: '${idle.take(3).join(', ')}'
            '${idle.length > 3 ? ' and others' : ''} have open leads but '
            'no logged calls.',
        action: 'See performance',
        route: '/calling-performance',
      ));
    }
  }

  // ── Something to feel good about, so the list is not purely nagging.
  final callsToday = logs
      .where((l) =>
          l.createdAt != null &&
          l.createdAt!.isAfter(todayStart) &&
          (isManager || l.callerId == me.id))
      .length;
  if (callsToday > 0) {
    out.add(Signal(
      level: SignalLevel.good,
      title: '$callsToday call${callsToday == 1 ? '' : 's'} logged today',
      detail: isManager ? 'Across the team.' : 'Keep going.',
    ));
  }

  if (isManager) {
    final commissions =
        ref.watch(teamCommissionsProvider).valueOrNull ?? const [];
    final pending = commissions.where((c) => c.status.name == 'pending').length;
    if (pending > 0) {
      out.add(Signal(
        level: SignalLevel.info,
        title: '$pending commission${pending == 1 ? '' : 's'} to approve',
        detail: 'Sales closed but not yet signed off.',
        action: 'Review',
        route: '/commissions',
      ));
    }
  }

  return out;
});

/// Compact form for the assistant, so it can prioritise rather than count.
final monitorSummaryProvider = Provider<Map<String, dynamic>>((ref) {
  final signals = ref.watch(monitorSignalsProvider);
  return {
    'signals': signals
        .map((s) => {
              'level': s.level.name,
              'title': s.title,
              'detail': s.detail,
            })
        .toList(),
  };
});

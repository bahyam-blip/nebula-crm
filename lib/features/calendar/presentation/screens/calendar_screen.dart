import 'dart:ui' show FontFeature;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/firebase_boot.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../contacts/models/contact.dart';
import '../../../tasks/models/task.dart';
import '../../../tasks/providers/task_provider.dart';
import '../../../telecalling/providers/telecalling_provider.dart';

/// One dated thing, whatever its source.
class _Entry {
  _Entry({
    required this.when,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.colour,
  });

  final DateTime when;
  final String title;
  final String subtitle;
  final IconData icon;
  final Color colour;
}

/// Tasks, reminders and promised callbacks on one timeline.
///
/// Callbacks live on contacts and tasks live in their own collection, but a
/// user's day does not care which collection something came from.
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key});

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  int _rangeDays = 7;

  List<_Entry> _entries(List<CrmTask> tasks, List<Contact> leads) {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(Duration(days: _rangeDays));
    final out = <_Entry>[];

    for (final t in tasks) {
      final at = t.dueAt ?? t.remindAt;
      if (at == null) continue;
      if (at.isBefore(start.subtract(const Duration(days: 30)))) continue;
      if (at.isAfter(end)) continue;
      final overdue = at.isBefore(now) && t.status != TaskStatus.completed;
      out.add(_Entry(
        when: at,
        title: t.title,
        subtitle: overdue
            ? 'Overdue · ${t.assignedToName}'
            : '${t.kind.name} · ${t.assignedToName}',
        icon: Icons.check_circle_outline,
        colour: overdue ? AppColors.danger : AppColors.primary,
      ));
    }

    for (final c in leads) {
      final at = c.followUpAt;
      if (at == null) continue;
      if (at.isAfter(end)) continue;
      final overdue = at.isBefore(now);
      out.add(_Entry(
        when: at,
        title: 'Callback: ${c.name}',
        subtitle: overdue ? 'Overdue' : (c.company ?? 'Scheduled call'),
        icon: Icons.phone_callback,
        colour: overdue ? AppColors.warning : AppColors.info,
      ));
    }

    out.sort((a, b) => a.when.compareTo(b.when));
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final tasksAsync = ref.watch(teamTasksProvider);
    final leads = ref.watch(teamLeadsProvider).valueOrNull ?? const <Contact>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calendar'),
        actions: [
          PopupMenuButton<int>(
            initialValue: _rangeDays,
            onSelected: (v) => setState(() => _rangeDays = v),
            itemBuilder: (_) => const [
              PopupMenuItem(value: 1, child: Text('Today')),
              PopupMenuItem(value: 7, child: Text('This week')),
              PopupMenuItem(value: 30, child: Text('This month')),
            ],
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Center(
                child: Text(
                  _rangeDays == 1
                      ? 'Day'
                      : _rangeDays == 7
                          ? 'Week'
                          : 'Month',
                  style: context.textTheme.bodyMedium,
                ),
              ),
            ),
          ),
        ],
      ),
      body: tasksAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(
          message: describeFirestoreError(e),
          onRetry: () => ref.invalidate(teamTasksProvider),
        ),
        data: (tasks) {
          final items = _entries(tasks, leads);
          if (items.isEmpty) {
            return const EmptyState(
              icon: Icons.event_available,
              title: 'Nothing scheduled',
              subtitle: 'Tasks, reminders and callbacks appear here.',
            );
          }

          String? lastDay;
          final widgets = <Widget>[];
          for (final e in items) {
            final day = Formatters.date(e.when);
            final isToday = day == Formatters.date(DateTime.now());
            if (day != lastDay) {
              lastDay = day;
              widgets.add(Padding(
                padding: const EdgeInsets.fromLTRB(6, 16, 6, 6),
                child: Row(
                  children: [
                    Text(day,
                        style: context.textTheme.labelMedium?.copyWith(
                          color: isToday
                              ? AppColors.primary
                              : AppColors.textTertiary,
                          fontWeight: isToday
                              ? FontWeight.w700
                              : FontWeight.w500,
                        )),
                    if (isToday) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppColors.primary.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text('TODAY',
                            style: context.textTheme.labelSmall?.copyWith(
                              color: AppColors.primary,
                              fontSize: 9,
                              letterSpacing: 0.8,
                              fontWeight: FontWeight.w700,
                            )),
                      ),
                    ],
                  ],
                ),
              ));
            }
            widgets.add(_row(e));
          }

          return ListView(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
            children: widgets,
          );
        },
      ),
    );
  }

  Widget _row(_Entry e) => Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border, width: 0.5),
        ),
        child: Row(
          children: [
            // Source-tinted icon chip — the timeline reads by colour first.
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: e.colour.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(e.icon, size: 16, color: e.colour),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(e.title,
                      style: context.textTheme.bodyMedium,
                      overflow: TextOverflow.ellipsis),
                  Text(e.subtitle,
                      style: context.textTheme.bodySmall
                          ?.copyWith(color: AppColors.textTertiary),
                      overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            Text(Formatters.time(e.when),
                style: context.textTheme.labelMedium?.copyWith(
                  color: AppColors.textSecondary,
                  fontFeatures: [const FontFeature.tabularFigures()],
                )),
          ],
        ),
      );
}

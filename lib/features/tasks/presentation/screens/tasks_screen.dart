import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/firebase_boot.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../auth/models/app_user.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../models/task.dart';
import '../../providers/task_provider.dart';

Color priorityColor(TaskPriority p) {
  switch (p) {
    case TaskPriority.low:
      return AppColors.textTertiary;
    case TaskPriority.medium:
      return AppColors.info;
    case TaskPriority.high:
      return AppColors.warning;
    case TaskPriority.urgent:
      return AppColors.danger;
  }
}

class TasksScreen extends ConsumerWidget {
  const TasksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasksAsync = ref.watch(teamTasksProvider);
    final visible = ref.watch(visibleTasksProvider);
    final reminders = ref.watch(dueRemindersProvider);
    final scope = ref.watch(taskScopeProvider);
    final filter = ref.watch(taskFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tasks'),
        actions: [
          PopupMenuButton<TaskScope>(
            initialValue: scope,
            onSelected: (v) =>
                ref.read(taskScopeProvider.notifier).state = v,
            itemBuilder: (_) => const [
              PopupMenuItem(value: TaskScope.mine, child: Text('My tasks')),
              PopupMenuItem(value: TaskScope.all, child: Text('Whole team')),
            ],
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Center(
                child: Text(
                  scope == TaskScope.mine ? 'Mine' : 'Team',
                  style: context.textTheme.bodyMedium,
                ),
              ),
            ),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: TaskFilter.values
                  .map((f) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(f.label),
                          selected: filter == f,
                          onSelected: (_) => ref
                              .read(taskFilterProvider.notifier)
                              .state = f,
                        ),
                      ))
                  .toList(),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => showTaskComposer(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('New task'),
      ),
      body: tasksAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(
          message: describeFirestoreError(e),
          onRetry: () => ref.invalidate(teamTasksProvider),
        ),
        data: (_) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
          children: [
            if (reminders.isNotEmpty) ...[
              _ReminderBanner(reminders: reminders),
              const SizedBox(height: 16),
            ],
            if (visible.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 60),
                child: EmptyState(
                  icon: Icons.task_alt,
                  title: 'Nothing here',
                  subtitle: 'Tap New task to add one.',
                ),
              )
            else
              ...visible.map((t) => _TaskCard(task: t)),
          ],
        ),
      ),
    );
  }
}

/// Reminders keep showing until acknowledged, per spec §15.
class _ReminderBanner extends ConsumerWidget {
  const _ReminderBanner({required this.reminders});

  final List<CrmTask> reminders;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.notifications_active,
                  size: 18, color: AppColors.warning),
              const SizedBox(width: 8),
              Text(
                '${reminders.length} reminder'
                '${reminders.length == 1 ? '' : 's'} due',
                style: context.textTheme.titleSmall
                    ?.copyWith(color: AppColors.warning),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ...reminders.take(3).map((t) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text('${t.kind.label}: ${t.title}',
                          overflow: TextOverflow.ellipsis,
                          style: context.textTheme.bodyMedium),
                    ),
                    TextButton(
                      onPressed: () => ref
                          .read(taskServiceProvider)
                          .snooze(t.id, const Duration(hours: 1)),
                      child: const Text('1h'),
                    ),
                    TextButton(
                      onPressed: () =>
                          ref.read(taskServiceProvider).acknowledge(t.id),
                      child: const Text('Dismiss'),
                    ),
                  ],
                ),
              )),
        ],
      ),
    );
  }
}

class _TaskCard extends ConsumerWidget {
  const _TaskCard({required this.task});

  final CrmTask task;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done = task.status == TaskStatus.completed;
    final accent = task.isOverdue
        ? AppColors.danger
        : priorityColor(task.priority);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: task.isOverdue
              ? AppColors.danger.withValues(alpha: 0.6)
              : AppColors.border,
        ),
      ),
      // Priority accent strip — urgency is scannable without reading a word.
      foregroundDecoration: BoxDecoration(
        border: Border(left: BorderSide(color: accent, width: 3)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Opacity(
        opacity: done ? 0.55 : 1.0,
        child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Checkbox(
            value: done,
            onChanged: (v) => ref.read(taskServiceProvider).setStatus(
                  task.id,
                  (v ?? false) ? TaskStatus.completed : TaskStatus.pending,
                ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  task.title,
                  style: context.textTheme.titleSmall?.copyWith(
                    decoration: done ? TextDecoration.lineThrough : null,
                    color: done ? AppColors.textTertiary : null,
                  ),
                ),
                if (task.description != null &&
                    task.description!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(task.description!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodySmall
                          ?.copyWith(color: AppColors.textSecondary)),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StatusBadge(
                      label: task.priority.label,
                      color: priorityColor(task.priority),
                      outlined: true,
                    ),
                    if (task.dueAt != null)
                      Text(
                        task.isOverdue
                            ? 'Overdue · ${Formatters.date(task.dueAt!)}'
                            : 'Due ${Formatters.date(task.dueAt!)}',
                        style: context.textTheme.bodySmall?.copyWith(
                          color: task.isOverdue
                              ? AppColors.danger
                              : AppColors.textTertiary,
                        ),
                      ),
                    if (task.relatedContactName != null)
                      Text('· ${task.relatedContactName}',
                          style: context.textTheme.bodySmall
                              ?.copyWith(color: AppColors.accent)),
                    if (task.assignedToName.isNotEmpty)
                      Text('· ${task.assignedToName}',
                          style: context.textTheme.bodySmall
                              ?.copyWith(color: AppColors.textTertiary)),
                  ],
                ),
              ],
            ),
          ),
        ],
        ),
      ),
    );
  }
}

Future<void> showTaskComposer(
  BuildContext context,
  WidgetRef ref, {
  String? contactId,
  String? contactName,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) =>
        _TaskComposer(contactId: contactId, contactName: contactName),
  );
}

class _TaskComposer extends ConsumerStatefulWidget {
  const _TaskComposer({this.contactId, this.contactName});

  final String? contactId;
  final String? contactName;

  @override
  ConsumerState<_TaskComposer> createState() => _TaskComposerState();
}

class _TaskComposerState extends ConsumerState<_TaskComposer> {
  final _title = TextEditingController();
  final _desc = TextEditingController();
  TaskPriority _priority = TaskPriority.medium;
  ReminderKind _kind = ReminderKind.other;
  DateTime? _dueAt;
  bool _remind = true;
  String? _assignee;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _assignee = ref.read(currentUserIdProvider);
  }

  @override
  void dispose() {
    _title.dispose();
    _desc.dispose();
    super.dispose();
  }

  Future<void> _pickDue() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 730)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 10, minute: 0),
    );
    if (!mounted) return;
    setState(() => _dueAt = DateTime(date.year, date.month, date.day,
        time?.hour ?? 10, time?.minute ?? 0));
  }

  Future<void> _save() async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;
    if (_title.text.trim().isEmpty) {
      context.showError('Give the task a title.');
      return;
    }

    final members = ref.read(assignableUsersProvider);
    AppUser? assignee;
    for (final m in members) {
      if (m.id == _assignee) assignee = m;
    }

    setState(() => _saving = true);
    try {
      await withFirestoreRetry(
        () => ref.read(taskServiceProvider).create(
              CrmTask(
                id: '',
                title: _title.text.trim(),
                teamId: me.teamId ?? '',
                description:
                    _desc.text.trim().isEmpty ? null : _desc.text.trim(),
                priority: _priority,
                kind: _kind,
                assignedTo: _assignee,
                assignedToName: assignee?.displayName ?? me.displayName,
                createdBy: me.id,
                createdByName: me.displayName,
                relatedContactId: widget.contactId,
                relatedContactName: widget.contactName,
                dueAt: _dueAt,
                // Remind at the due time unless the user opts out.
                remindAt: _remind ? _dueAt : null,
              ),
            ),
      );
      if (!mounted) return;
      Navigator.of(context).pop();
      context.showSuccess('Task created');
    } catch (e) {
      if (mounted) context.showError(describeFirestoreError(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final members = ref.watch(teamMembersForTasksProvider).valueOrNull ??
        const <AppUser>[];

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              widget.contactName == null
                  ? 'New task'
                  : 'New task · ${widget.contactName}',
              style: context.textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _title,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Title'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _desc,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Details'),
            ),
            const SizedBox(height: 16),
            Text('Type', style: context.textTheme.titleSmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: ReminderKind.values
                  .map((k) => ChoiceChip(
                        label: Text(k.label),
                        selected: _kind == k,
                        onSelected: (_) => setState(() => _kind = k),
                      ))
                  .toList(),
            ),
            const SizedBox(height: 16),
            Text('Priority', style: context.textTheme.titleSmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: TaskPriority.values
                  .map((p) => ChoiceChip(
                        label: Text(p.label),
                        selected: _priority == p,
                        selectedColor:
                            priorityColor(p).withValues(alpha: 0.25),
                        onSelected: (_) => setState(() => _priority = p),
                      ))
                  .toList(),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _pickDue,
              icon: const Icon(Icons.event, size: 16),
              label: Text(_dueAt == null
                  ? 'Set due date'
                  : 'Due ${Formatters.dateTime(_dueAt!)}'),
            ),
            if (_dueAt != null)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _remind,
                onChanged: (v) => setState(() => _remind = v),
                title: const Text('Remind me'),
                subtitle: Text('Keeps showing until dismissed',
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textTertiary)),
              ),
            if (members.isNotEmpty) ...[
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _assignee,
                decoration: const InputDecoration(labelText: 'Assign to'),
                items: members
                    .map((m) => DropdownMenuItem(
                          value: m.id,
                          child: Text(m.displayName),
                        ))
                    .toList(),
                onChanged: (v) => setState(() => _assignee = v),
              ),
            ],
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Create task'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

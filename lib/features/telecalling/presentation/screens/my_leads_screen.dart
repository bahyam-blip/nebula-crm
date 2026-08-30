import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/services/firebase_boot.dart';
import '../../../../core/services/notification_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../../contacts/models/call_status.dart';
import '../../../contacts/models/contact.dart';
import '../../models/call_log.dart';
import '../../../commissions/providers/commission_provider.dart';
import '../../providers/telecalling_provider.dart';

/// Colour coding for a call outcome. Green means progress, red means stop.
Color callStatusColor(CallStatus s) {
  switch (s) {
    case CallStatus.notCalled:
      return AppColors.textTertiary;
    case CallStatus.attempted:
      return AppColors.warning;
    case CallStatus.connected:
      return AppColors.info;
    case CallStatus.callback:
      return AppColors.stageNegotiation;
    case CallStatus.interested:
      return AppColors.accent;
    case CallStatus.notInterested:
      return AppColors.textSecondary;
    case CallStatus.wrongNumber:
      return AppColors.danger;
    case CallStatus.doNotCall:
      return AppColors.danger;
    case CallStatus.converted:
      return AppColors.success;
  }
}

class MyLeadsScreen extends ConsumerWidget {
  const MyLeadsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final leadsAsync = ref.watch(myLeadsProvider);
    final queue = ref.watch(myQueueProvider);
    final filter = ref.watch(queueFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My leads'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: QueueFilter.values.map((f) {
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(f.label),
                    selected: filter == f,
                    onSelected: (_) =>
                        ref.read(queueFilterProvider.notifier).state = f,
                  ),
                );
              }).toList(),
            ),
          ),
        ),
      ),
      body: leadsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(
          message: describeFirestoreError(e),
          onRetry: () => ref.invalidate(myLeadsProvider),
        ),
        data: (_) {
          if (queue.isEmpty) {
            return EmptyState(
              icon: Icons.check_circle,
              title: filter == QueueFilter.due
                  ? 'Nothing due right now'
                  : 'No leads here',
              subtitle: filter == QueueFilter.due
                  ? 'Callbacks and fresh leads will appear here.'
                  : 'Ask your manager to assign you some leads.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: queue.length + 1,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (_, i) {
              if (i == 0) return _QueueSummary(leads: queue);
              return _LeadCard(contact: queue[i - 1]);
            },
          );
        },
      ),
    );
  }
}

class _QueueSummary extends StatelessWidget {
  const _QueueSummary({required this.leads});

  final List<Contact> leads;

  @override
  Widget build(BuildContext context) {
    final due = leads.where((c) => c.isFollowUpDue).length;
    final fresh =
        leads.where((c) => c.callStatus == CallStatus.notCalled).length;

    return Container(
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        gradient: AppColors.primaryGradient,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${leads.length} in queue',
                    style: context.textTheme.titleLarge
                        ?.copyWith(color: Colors.white)),
                const SizedBox(height: 4),
                Text(
                  '$due callback${due == 1 ? '' : 's'} overdue · '
                  '$fresh never called',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: Colors.white70),
                ),
              ],
            ),
          ),
          const Icon(Icons.headset_mic, color: Colors.white, size: 32),
        ],
      ),
    );
  }
}

class _LeadCard extends ConsumerWidget {
  const _LeadCard({required this.contact});

  final Contact contact;

  Future<void> _dial(BuildContext context, String phone) async {
    final uri = Uri(scheme: 'tel', path: phone.replaceAll(' ', ''));
    if (!await launchUrl(uri)) {
      if (context.mounted) context.showError('Could not open the dialer.');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overdue = contact.isFollowUpDue;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: overdue ? AppColors.warning : AppColors.border,
          width: overdue ? 1.2 : 1,
        ),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(1.5),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      AppColors.primary.withValues(alpha: 0.5),
                      AppColors.primary.withValues(alpha: 0.1),
                    ],
                  ),
                ),
                child: CircleAvatar(
                  radius: 20,
                  backgroundColor: AppColors.surfaceHigh,
                  child: Text(
                    Formatters.initials(contact.name),
                    style: context.textTheme.bodySmall?.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w700),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(contact.name,
                        style: context.textTheme.titleSmall,
                        overflow: TextOverflow.ellipsis),
                    if (contact.company != null)
                      Text(contact.company!,
                          style: context.textTheme.bodySmall
                              ?.copyWith(color: AppColors.textSecondary),
                          overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              StatusBadge(
                label: contact.callStatus.label,
                color: callStatusColor(contact.callStatus),
                outlined: true,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              if (contact.callAttempts > 0)
                Padding(
                  padding: const EdgeInsets.only(right: 12),
                  child: Text(
                    '${contact.callAttempts} attempt'
                    '${contact.callAttempts == 1 ? '' : 's'}',
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textTertiary),
                  ),
                ),
              if (contact.followUpAt != null)
                Text(
                  overdue
                      ? 'Callback overdue · ${Formatters.timeAgo(contact.followUpAt!)}'
                      : 'Callback ${Formatters.date(contact.followUpAt!)}',
                  style: context.textTheme.bodySmall?.copyWith(
                    color:
                        overdue ? AppColors.warning : AppColors.textSecondary,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              if ((contact.phone ?? '').isNotEmpty)
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => _dial(context, contact.phone!),
                    icon: const Icon(Icons.phone, size: 16),
                    label: const Text('Call'),
                  ),
                ),
              if ((contact.phone ?? '').isNotEmpty) const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => showDispositionSheet(context, ref, contact),
                  icon: const Icon(Icons.edit_note, size: 16),
                  label: const Text('Log result'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Bottom sheet for recording what happened on a call.
Future<void> showDispositionSheet(
  BuildContext context,
  WidgetRef ref,
  Contact contact,
) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _DispositionSheet(contact: contact),
  );
}

class _DispositionSheet extends ConsumerStatefulWidget {
  const _DispositionSheet({required this.contact});

  final Contact contact;

  @override
  ConsumerState<_DispositionSheet> createState() => _DispositionSheetState();
}

class _DispositionSheetState extends ConsumerState<_DispositionSheet> {
  CallStatus _outcome = CallStatus.connected;
  final _notes = TextEditingController();
  DateTime? _followUp;
  bool _saving = false;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  /// Callbacks are the one outcome that is meaningless without a time.
  bool get _needsFollowUp => _outcome == CallStatus.callback;

  Future<void> _pickFollowUp() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 10, minute: 0),
    );
    if (!mounted) return;
    setState(() {
      _followUp = DateTime(
        date.year,
        date.month,
        date.day,
        time?.hour ?? 10,
        time?.minute ?? 0,
      );
    });
  }

  Future<void> _save() async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;

    if (_needsFollowUp && _followUp == null) {
      context.showError('Pick a callback time.');
      return;
    }

    setState(() => _saving = true);
    try {
      await withFirestoreRetry(
        () => ref.read(telecallingServiceProvider).logCall(
              contact: widget.contact,
              caller: me,
              outcome: _outcome,
              notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
              followUpAt: _followUp,
            ),
      );
      // A conversion is a subscription sale, so credit the commission in
      // the same action rather than making anyone record it separately.
      if (_outcome == CallStatus.converted) {
        await ref.read(commissionServiceProvider).recordSale(
              salesPerson: me,
              contactId: widget.contact.id,
              contactName: widget.contact.name,
              note: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
            );
      }

      // The whole point of writing "call back at 4" is being reminded at 4.
      if (_followUp != null) {
        await ref.read(notificationServiceProvider).scheduleCallback(
              contactId: widget.contact.id,
              contactName: widget.contact.name,
              at: _followUp!,
              note: _notes.text.trim(),
            );
      } else {
        await ref
            .read(notificationServiceProvider)
            .cancel('callback:${widget.contact.id}');
      }

      if (!mounted) return;
      Navigator.of(context).pop();
      context.showSuccess(_outcome == CallStatus.converted
          ? 'Sale recorded. Commission credited to you.'
          : 'Logged: ${_outcome.label}');
    } catch (e) {
      if (mounted) context.showError(describeFirestoreError(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final logs = ref.watch(contactCallLogsProvider(widget.contact.id));

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
            Text(widget.contact.name, style: context.textTheme.titleLarge),
            const SizedBox(height: 16),
            Text('Outcome', style: context.textTheme.titleSmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: CallStatus.values
                  .where((s) => s != CallStatus.notCalled)
                  .map(
                    (s) => ChoiceChip(
                      label: Text(s.label),
                      selected: _outcome == s,
                      selectedColor: callStatusColor(s).withValues(alpha: 0.25),
                      onSelected: (_) => setState(() {
                        _outcome = s;
                        if (!_needsFollowUp) _followUp = null;
                      }),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 16),
            if (_needsFollowUp || _followUp != null) ...[
              OutlinedButton.icon(
                onPressed: _pickFollowUp,
                icon: const Icon(Icons.schedule, size: 16),
                label: Text(
                  _followUp == null
                      ? 'Schedule callback'
                      : 'Callback: ${Formatters.dateTime(_followUp!)}',
                ),
              ),
              const SizedBox(height: 16),
            ],
            TextField(
              controller: _notes,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Notes',
                hintText: 'What did they say?',
              ),
            ),
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
                    : const Text('Save result'),
              ),
            ),
            const SizedBox(height: 24),
            Text('History', style: context.textTheme.titleSmall),
            const SizedBox(height: 8),
            logs.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text(
                describeFirestoreError(e),
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.danger),
              ),
              data: (items) => items.isEmpty
                  ? Text('No calls logged yet.',
                      style: context.textTheme.bodySmall
                          ?.copyWith(color: AppColors.textTertiary))
                  : Column(
                      children: items
                          .take(8)
                          .map((l) => _TimelineTile(log: l))
                          .toList(),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One entry in a contact's call history.
class _TimelineTile extends StatelessWidget {
  const _TimelineTile({required this.log});

  final CallLog log;

  @override
  Widget build(BuildContext context) {
    final CallStatus outcome = log.outcome;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.only(top: 6, right: 12),
            decoration: BoxDecoration(
              color: callStatusColor(outcome),
              shape: BoxShape.circle,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${outcome.label} · ${log.callerName}',
                  style: context.textTheme.bodyMedium,
                ),
                if (log.notes != null)
                  Text(log.notes!,
                      style: context.textTheme.bodySmall
                          ?.copyWith(color: AppColors.textSecondary)),
                if (log.createdAt != null)
                  Text(
                    Formatters.timeAgo(log.createdAt!),
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textTertiary),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

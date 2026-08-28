import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../providers/mail_provider.dart';
import '../../services/mail_api_service.dart';

/// AI Email — give the owner's instruction to the AI, it plans, writes,
/// syncs CRM contacts to MailerCloud and schedules real campaigns. Every
/// created campaign appears in the normal Campaigns screen with live
/// opens/clicks written back by the analytics loop.
class AiEmailerScreen extends ConsumerStatefulWidget {
  const AiEmailerScreen({super.key});

  @override
  ConsumerState<AiEmailerScreen> createState() => _AiEmailerScreenState();
}

class _AiEmailerScreenState extends ConsumerState<AiEmailerScreen> {
  final _instruction = TextEditingController();
  Timer? _poll;
  bool _busy = false;

  static const _examples = [
    'Send 3 emails this week to leads about our monsoon sale — build urgency, keep it classy',
    'Introduce our business to new subscribers in 2 friendly emails',
    'One re-engagement email to customers who have not bought in a month',
  ];

  @override
  void dispose() {
    _poll?.cancel();
    _instruction.dispose();
    super.dispose();
  }

  void _startPollingIfNeeded() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 8), (_) {
      if (!mounted) return;
      final active = ref.read(mailHasActiveTasksProvider);
      ref.invalidate(mailTasksProvider);
      if (!active) ref.invalidate(mailStatusProvider);
    });
  }

  Future<void> _launch() async {
    final text = _instruction.text.trim();
    if (text.length < 8) {
      _toast('Describe what the AI should email about.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).createTask(text);
      _instruction.clear();
      ref.invalidate(mailTasksProvider);
      _startPollingIfNeeded();
      _toast('AI is planning your campaign — watch the task below.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleDryRun(bool live) async {
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).setDryRun(!live);
      ref.invalidate(mailStatusProvider);
      _toast(live ? 'Safety mode ON — nothing will send.' : 'Live mode — scheduled emails will send.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _refreshAnalytics() async {
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).analytics(refresh: true);
      ref.invalidate(mailAnalyticsProvider);
      _toast('Analytics refreshed from MailerCloud.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _syncContacts() async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(mailApiProvider).syncContacts();
      _toast('Synced ${r['crmContacts'] ?? '?'} CRM contact(s) to MailerCloud.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runNow() async {
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).run(force: true);
      ref.invalidate(mailTasksProvider);
      _startPollingIfNeeded();
      _toast('Pipeline executed.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteTask(MailTask t) async {
    try {
      await ref.read(mailApiProvider).deleteTask(t.id);
      ref.invalidate(mailTasksProvider);
    } catch (e) {
      _toast(e.toString());
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating));
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(mailStatusProvider);
    final tasks = ref.watch(mailTasksProvider);
    final analytics = ref.watch(mailAnalyticsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Email'),
        actions: [
          IconButton(
            tooltip: 'Sync contacts to MailerCloud',
            onPressed: _busy ? null : _syncContacts,
            icon: const Icon(Icons.cloud_sync_outlined, size: 20),
          ),
          IconButton(
            tooltip: 'Run pipeline now',
            onPressed: _busy ? null : _runNow,
            icon: const Icon(Icons.play_circle_outline, size: 20),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(mailStatusProvider);
          ref.invalidate(mailTasksProvider);
          ref.invalidate(mailAnalyticsProvider);
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
          children: [
            status.when(
              loading: () => const Center(
                  child: Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(strokeWidth: 2),
              )),
              error: (e, _) => ErrorState(
                message: '$e',
                onRetry: () => ref.invalidate(mailStatusProvider),
              ),
              data: (s) => _StatusCard(status: s, onToggle: _toggleDryRun),
            ),
            const SizedBox(height: 14),

            // ── Composer ──
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Give the AI a task', style: context.textTheme.titleSmall),
                  const SizedBox(height: 4),
                  Text(
                    'Plain language. Say how many emails, to whom, and about what. The AI decides timing, audience and copy.',
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _instruction,
                    minLines: 3,
                    maxLines: 6,
                    maxLength: 4000,
                    style: context.textTheme.bodyMedium,
                    decoration: InputDecoration(
                      hintText:
                          'e.g. Send 2 emails this week to leads about our 20% monsoon discount. Friendly but premium tone.',
                      filled: true,
                      fillColor: AppColors.surfaceElevated,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final ex in _examples)
                        ActionChip(
                          label: Text(ex.split(' ').take(5).join(' ') + '…',
                              style: context.textTheme.labelSmall),
                          onPressed: () => _instruction.text = ex,
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _busy ? null : _launch,
                      icon: const Icon(Icons.auto_awesome, size: 18),
                      label: const Text('Launch AI campaign'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // ── Analytics ──
            analytics.when(
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
              data: (a) => a == null
                  ? const SizedBox.shrink()
                  : _AnalyticsCard(a: a, onRefresh: _refreshAnalytics),
            ),

            // ── Tasks ──
            SectionHeader(
              title: 'Campaign tasks',
              subtitle: 'Plan → write → schedule. Completed emails appear in Campaigns.',
              actionLabel: 'Refresh',
              onAction: () => ref.invalidate(mailTasksProvider),
            ),
            tasks.when(
              loading: () => const Center(
                  child: Padding(
                padding: EdgeInsets.all(16),
                child: CircularProgressIndicator(strokeWidth: 2),
              )),
              error: (e, _) => ErrorState(
                message: '$e',
                onRetry: () => ref.invalidate(mailTasksProvider),
              ),
              data: (list) {
                if (list.isEmpty) {
                  return const EmptyState(
                    icon: Icons.forward_to_inbox,
                    title: 'No AI tasks yet',
                    subtitle:
                        'Type an instruction above — the AI plans the emails, targets your CRM audience and schedules everything on MailerCloud.',
                  );
                }
                return Column(
                  children: [
                    for (final i in list.indexed)
                      _TaskCard(
                        task: i.$2,
                        onDelete: () => _deleteTask(i.$2),
                      ).animate().fadeIn(duration: 220.ms, delay: (i.$1 * 40).ms),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/* ── Status card ── */

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status, required this.onToggle});
  final MailStatus status;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    final missing = status.missing;
    final live = !status.dryRun;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.primary.withValues(alpha: 0.16),
            AppColors.accent.withValues(alpha: 0.10),
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: (status.configured ? AppColors.success : AppColors.warning)
                      .withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  status.configured ? Icons.mark_email_read_outlined : Icons.mark_email_unread_outlined,
                  color: status.configured ? AppColors.success : AppColors.warning,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      status.configured ? 'Email engine ready' : 'Email engine needs setup',
                      style: context.textTheme.titleSmall,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      status.configured
                          ? (status.businessType != null
                              ? 'AI understands: ${status.businessType}'
                              : 'AI learns your business from your tasks & CRM')
                          : 'Missing: ${missing.join(", ")}',
                      style: context.textTheme.labelSmall
                          ?.copyWith(color: AppColors.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (missing.contains('MAILERCLOUD_API_KEY') ||
              missing.contains('MAILERCLOUD_SENDER_EMAIL')) ...[
            const SizedBox(height: 10),
            Text(
              'Add the MailerCloud secrets in the repo (Settings → Secrets → Actions), then re-run the Deploy Worker workflow. Everything else is already wired.',
              style: context.textTheme.labelSmall
                  ?.copyWith(color: AppColors.textTertiary),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Switch(
                value: live,
                activeColor: AppColors.success,
                onChanged: (v) => onToggle(v),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  live ? 'LIVE — scheduled emails really send' : 'Safety mode — drafts only, nothing sends',
                  style: context.textTheme.labelMedium?.copyWith(
                    color: live ? AppColors.success : AppColors.textSecondary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/* ── Analytics card ── */

class _AnalyticsCard extends StatelessWidget {
  const _AnalyticsCard({required this.a, required this.onRefresh});
  final MailAnalytics a;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('Performance', style: context.textTheme.titleSmall)),
              IconButton(
                onPressed: onRefresh,
                icon: const Icon(Icons.refresh, size: 18, color: AppColors.textSecondary),
                tooltip: 'Pull fresh numbers from MailerCloud',
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _Stat(label: 'Campaigns', value: '${a.campaigns}', color: AppColors.info),
              _Stat(
                label: 'Avg open',
                value: '${a.avgOpenRate.toStringAsFixed(1)}%',
                color: AppColors.success,
              ),
              _Stat(
                label: 'Avg click',
                value: '${a.avgClickRate.toStringAsFixed(1)}%',
                color: AppColors.accent,
              ),
              if (a.bestSendHour != null)
                _Stat(label: 'Best hour', value: '${a.bestSendHour}:00', color: AppColors.warning),
            ],
          ),
          if (a.recommendations.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final r in a.recommendations.take(3))
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.tips_and_updates_outlined,
                        size: 14, color: AppColors.primary),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(r,
                          style: context.textTheme.labelSmall
                              ?.copyWith(color: AppColors.textSecondary)),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.color});
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value,
              style: context.textTheme.titleMedium?.copyWith(color: color)),
          const SizedBox(height: 2),
          Text(label,
              style: context.textTheme.labelSmall
                  ?.copyWith(color: AppColors.textTertiary)),
        ],
      ),
    );
  }
}

/* ── Task card ── */

class _TaskCard extends StatelessWidget {
  const _TaskCard({required this.task, required this.onDelete});
  final MailTask task;
  final VoidCallback onDelete;

  Color _statusColor(String s) => switch (s) {
        'done' => AppColors.success,
        'active' || 'planning' || 'pending' => AppColors.info,
        'failed' => AppColors.danger,
        _ => AppColors.textTertiary,
      };

  String _time(String iso) {
    final t = DateTime.tryParse(iso);
    if (t == null) return '';
    final local = t.toLocal();
    return '${local.day}/${local.month} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    task.instruction,
                    style: context.textTheme.bodyMedium,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                StatusBadge(
                  label: task.status.toUpperCase(),
                  color: _statusColor(task.status),
                  outlined: true,
                ),
                PopupMenuButton<String>(
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.more_vert, size: 18, color: AppColors.textTertiary),
                  onSelected: (v) {
                    if (v == 'delete') onDelete();
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'delete', child: Text('Delete task')),
                  ],
                ),
              ],
            ),
            if (task.emails.isNotEmpty) ...[
              const SizedBox(height: 10),
              for (final e in task.emails)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: [
                      Icon(
                        switch (e.status) {
                          'scheduled' => Icons.schedule_send,
                          'dry_run' => Icons.mark_email_read_outlined,
                          'failed' => Icons.error_outline,
                          'planned' => Icons.schedule,
                          _ => Icons.mail_outline,
                        },
                        size: 15,
                        color: e.status == 'failed'
                            ? AppColors.danger
                            : e.status == 'scheduled'
                                ? AppColors.success
                                : AppColors.info,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          e.subject ?? 'Email ${e.seq} — waiting for the AI',
                          style: context.textTheme.labelMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        _time(e.sendAt),
                        style: context.textTheme.labelSmall
                            ?.copyWith(color: AppColors.textTertiary),
                      ),
                    ],
                  ),
                ),
            ],
            if (task.error != null) ...[
              const SizedBox(height: 6),
              Text('Error: ${task.error}',
                  style: context.textTheme.labelSmall
                      ?.copyWith(color: AppColors.danger)),
            ],
            const SizedBox(height: 4),
            Text('Created ${_time(task.createdAt)}',
                style: context.textTheme.labelSmall
                    ?.copyWith(color: AppColors.textTertiary)),
          ],
        ),
      ),
    );
  }
}

/* ── Shared card container ── */

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: child,
    );
  }
}

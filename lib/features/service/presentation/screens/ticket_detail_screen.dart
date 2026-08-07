import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../models/ticket.dart';

class TicketDetailScreen extends ConsumerStatefulWidget {
  const TicketDetailScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<TicketDetailScreen> createState() =>
      _TicketDetailScreenState();
}

class _TicketDetailScreenState extends ConsumerState<TicketDetailScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(PhosphorIconsRegular.arrowLeft),
          onPressed: () => context.pop(),
        ),
      ),
      body: FutureBuilder<Ticket?>(
        future: ref.read(firestoreServiceProvider).getTicket(widget.id),
        builder: (_, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(
                child: CircularProgressIndicator(strokeWidth: 2));
          }
          final t = snap.data;
          if (t == null) {
            return const EmptyState(
              icon: PhosphorIconsRegular.headset,
              title: 'Ticket not found',
            );
          }
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(t.subject, style: context.textTheme.headlineSmall),
              const SizedBox(height: 8),
              Row(
                children: [
                  _PriorityChip(priority: t.priority),
                  const SizedBox(width: 8),
                  StatusBadge(
                    label: t.status.label,
                    color: _statusColor(t.status),
                  ),
                  const Spacer(),
                  Text(
                    t.createdAt != null ? Formatters.timeAgo(t.createdAt!) : '',
                    style: context.textTheme.labelSmall,
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // ── SLA card ─────────────────────────────────
              _SlaCard(ticket: t),

              // ── Description ──────────────────────────────
              if (t.description != null) ...[
                const SizedBox(height: 20),
                Text('Description', style: context.textTheme.labelMedium),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      t.description!,
                      style: context.textTheme.bodyMedium,
                    ),
                  ),
                ),
              ],

              // ── Contact ──────────────────────────────────
              if (t.contactId != null) ...[
                const SizedBox(height: 20),
                Text('Contact', style: context.textTheme.labelMedium),
                const SizedBox(height: 8),
                Card(
                  child: ListTile(
                    leading: const CircleAvatar(
                      child: Icon(PhosphorIconsRegular.user, size: 18),
                    ),
                    title: Text(t.contactName ?? 'Contact'),
                    trailing: const Icon(Icons.chevron_right, size: 20),
                    onTap: () => context.push('/contacts/${t.contactId}'),
                  ),
                ),
              ],

              // ── Status changer ───────────────────────────
              const SizedBox(height: 24),
              Text('Update status', style: context.textTheme.labelMedium),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final s in TicketStatus.values)
                    ChoiceChip(
                      label: Text(s.label),
                      selected: t.status == s,
                      onSelected: (_) => _changeStatus(s),
                    ),
                ],
              ),

              const SizedBox(height: 40),
            ],
          );
        },
      ),
    );
  }

  Future<void> _changeStatus(TicketStatus newStatus) async {
    final db = ref.read(firestoreServiceProvider);
    final ticket = await db.getTicket(widget.id);
    if (ticket == null) return;
    final updated = ticket.copyWith(
      status: newStatus,
      resolvedAt: newStatus == TicketStatus.resolved ? DateTime.now() : null,
      closedAt: newStatus == TicketStatus.closed ? DateTime.now() : null,
      firstResponseAt: ticket.firstResponseAt ?? DateTime.now(),
    );
    await db.updateTicket(updated);
    if (!mounted) return;
    setState(() {});
    context.showSuccess('Status updated');
  }

  Color _statusColor(TicketStatus s) {
    return switch (s) {
      TicketStatus.open => AppColors.info,
      TicketStatus.inProgress => AppColors.accent,
      TicketStatus.waitingOnCustomer => AppColors.warning,
      TicketStatus.resolved => AppColors.success,
      TicketStatus.closed => AppColors.textTertiary,
    };
  }
}

class _PriorityChip extends StatelessWidget {
  const _PriorityChip({required this.priority});
  final TicketPriority priority;

  @override
  Widget build(BuildContext context) {
    final color = switch (priority) {
      TicketPriority.urgent => AppColors.danger,
      TicketPriority.high => AppColors.warning,
      TicketPriority.medium => AppColors.info,
      TicketPriority.low => AppColors.textTertiary,
    };
    return StatusBadge(
      label: priority.label,
      color: color,
      outlined: true,
    );
  }
}

class _SlaCard extends StatelessWidget {
  const _SlaCard({required this.ticket});
  final Ticket ticket;

  @override
  Widget build(BuildContext context) {
    if (ticket.slaDeadline == null) return const SizedBox.shrink();
    final color = switch (ticket.slaStatus) {
      'breached' => AppColors.danger,
      'at_risk' => AppColors.warning,
      _ => AppColors.success,
    };
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(PhosphorIconsRegular.timer, color: color, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  ticket.slaStatus == 'breached'
                      ? 'SLA Breached'
                      : ticket.slaStatus == 'at_risk'
                          ? 'SLA At Risk'
                          : 'Within SLA',
                  style: context.textTheme.titleSmall?.copyWith(color: color),
                ),
                const SizedBox(height: 2),
                Text(
                  'Deadline: ${Formatters.dateTime(ticket.slaDeadline!)}',
                  style: context.textTheme.labelSmall,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// `getTicket` lives on [FirestoreService] now.


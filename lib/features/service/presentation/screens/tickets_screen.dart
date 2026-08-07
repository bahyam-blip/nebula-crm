import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../models/ticket.dart';
import '../../providers/ticket_provider.dart';

class TicketsScreen extends ConsumerWidget {
  const TicketsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ticketsAsync = ref.watch(myTicketsProvider);
    final statusFilter = ref.watch(ticketStatusFilterProvider);

    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Tickets'),
          bottom: TabBar(
            tabs: const [
              Tab(text: 'Open'),
              Tab(text: 'In Progress'),
              Tab(text: 'Waiting'),
              Tab(text: 'All'),
            ],
            onTap: (i) {
              final status = switch (i) {
                0 => 'open',
                1 => 'inProgress',
                2 => 'waitingOnCustomer',
                _ => null,
              };
              ref.read(ticketStatusFilterProvider.notifier).state = status;
            },
          ),
        ),
        body: ticketsAsync.when(
          data: (all) {
            final list = statusFilter == null
                ? all
                : all.where((t) => t.status.name == statusFilter).toList();
            if (list.isEmpty) {
              return const EmptyState(
                icon: PhosphorIconsRegular.headset,
                title: 'No tickets',
                subtitle: 'Support tickets assigned to you will appear here.',
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: list.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final t = list[i];
                return _TicketTile(ticket: t)
                    .animate()
                    .fadeIn(duration: 200.ms, delay: (i * 30).ms);
              },
            );
          },
          loading: () => const Center(
              child: CircularProgressIndicator(strokeWidth: 2)),
          error: (e, _) => ErrorState(message: 'Failed: $e'),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => _showNewTicketSheet(context, ref),
          icon: const Icon(PhosphorIconsRegular.plus, size: 20),
          label: const Text('New Ticket'),
        ),
      ),
    );
  }

  void _showNewTicketSheet(BuildContext context, WidgetRef ref) {
    final subjectCtl = TextEditingController();
    final descCtl = TextEditingController();
    var priority = TicketPriority.medium;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetCtx) => StatefulBuilder(
        builder: (_, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 20, right: 20, top: 20,
            bottom: 20 + MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('New Ticket', style: context.textTheme.titleMedium),
              const SizedBox(height: 16),
              TextField(
                controller: subjectCtl,
                decoration: const InputDecoration(labelText: 'Subject *'),
                autofocus: true,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: descCtl,
                decoration: const InputDecoration(
                  labelText: 'Description',
                  alignLabelWithHint: true,
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 12),
              Text('Priority', style: context.textTheme.labelMedium),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final p in TicketPriority.values)
                    ChoiceChip(
                      label: Text(p.label),
                      selected: priority == p,
                      onSelected: (_) => setSheetState(() => priority = p),
                    ),
                ],
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () async {
                  if (subjectCtl.text.trim().isEmpty) return;
                  final user = ref.read(currentAppUserValueProvider);
                  final sla = DateTime.now().add(
                    Duration(hours: priority.slaHours),
                  );
                  await ref.read(firestoreServiceProvider).createTicket(Ticket(
                    id: '',
                    subject: subjectCtl.text.trim(),
                    description: descCtl.text.trim().isEmpty
                        ? null
                        : descCtl.text.trim(),
                    priority: priority,
                    status: TicketStatus.open,
                    ownerId: user?.id ?? '',
                    assigneeId: user?.id,
                    assigneeName: user?.displayName,
                    teamId: user?.teamId,
                    slaDeadline: sla,
                    createdAt: DateTime.now(),
                  ));
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('Create'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TicketTile extends StatelessWidget {
  const _TicketTile({required this.ticket});
  final Ticket ticket;

  @override
  Widget build(BuildContext context) {
    final priorityColor = _priorityColor(ticket.priority);
    final slaColor = _slaColor(ticket.slaStatus);

    return Card(
      child: InkWell(
        onTap: () => context.push('/tickets/${ticket.id}'),
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 4,
                height: 48,
                decoration: BoxDecoration(
                  color: priorityColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      ticket.subject,
                      style: context.textTheme.titleSmall,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    if (ticket.contactName != null)
                      Text(
                        ticket.contactName!,
                        style: context.textTheme.labelSmall,
                      ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        StatusBadge(
                          label: ticket.priority.label,
                          color: priorityColor,
                          outlined: true,
                        ),
                        const SizedBox(width: 8),
                        if (ticket.slaStatus != 'within')
                          StatusBadge(
                            label: ticket.slaStatus.toUpperCase(),
                            color: slaColor,
                          ),
                        const Spacer(),
                        if (ticket.messageCount > 0)
                          Row(
                            children: [
                              Icon(PhosphorIconsRegular.chatCircle,
                                  size: 12, color: AppColors.textTertiary),
                              const SizedBox(width: 4),
                              Text('${ticket.messageCount}',
                                  style: context.textTheme.labelSmall),
                            ],
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _priorityColor(TicketPriority p) {
    return switch (p) {
      TicketPriority.urgent => AppColors.danger,
      TicketPriority.high => AppColors.warning,
      TicketPriority.medium => AppColors.info,
      TicketPriority.low => AppColors.textTertiary,
    };
  }

  Color _slaColor(String s) {
    return switch (s) {
      'breached' => AppColors.danger,
      'at_risk' => AppColors.warning,
      _ => AppColors.success,
    };
  }
}

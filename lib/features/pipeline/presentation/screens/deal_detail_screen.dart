import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../../core/widgets/gradient_card.dart';
import '../../../contacts/providers/contact_provider.dart' show dealByIdProvider;
import '../../../dashboard/presentation/widgets/recent_activity.dart';
import '../../models/deal.dart';

class DealDetailScreen extends ConsumerWidget {
  const DealDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final deal = ref.watch(dealByIdProvider(id));
    return Scaffold(
      body: deal.when(
        data: (d) {
          if (d == null) {
            return const EmptyState(
              icon: PhosphorIconsRegular.kanban,
              title: 'Deal not found',
            );
          }
          return CustomScrollView(
            slivers: [
              SliverAppBar(
                expandedHeight: 200,
                pinned: true,
                leading: IconButton(
                  icon: const Icon(PhosphorIconsRegular.arrowLeft),
                  onPressed: () => context.pop(),
                ),
                actions: [
                  IconButton(
                    icon: const Icon(PhosphorIconsRegular.pencilSimple),
                    onPressed: () => context.push('/deals/new?id=$id'),
                  ),
                ],
                flexibleSpace: FlexibleSpaceBar(
                  background: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppColors.stageColor(d.stage).withValues(alpha: 0.3),
                          AppColors.background,
                        ],
                      ),
                    ),
                    child: SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 60, 20, 0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              Formatters.currency(d.value),
                              style: AppTypography.numericLarge,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              d.title,
                              style: context.textTheme.titleMedium,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 8),
                            StatusBadge(
                              label: AppConstants.stageLabels[d.stage] ?? d.stage,
                              color: AppColors.stageColor(d.stage),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── Stage picker ───────────────────────────
                    Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Stage', style: context.textTheme.labelMedium),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              for (final s in [
                                ...AppConstants.pipelineStages,
                                'lost',
                              ])
                                ChoiceChip(
                                  label: Text(
                                      AppConstants.stageLabels[s] ?? s),
                                  selected: d.stage == s,
                                  onSelected: (_) =>
                                      _changeStage(context, ref, d.id, s),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    // ── AI Insight (if present) ────────────────
                    if (d.aiInsight != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: GradientCard(
                          gradient: AppColors.premiumGradient,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(PhosphorIconsFill.sparkle,
                                  color: Colors.white, size: 20),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'AI Insight',
                                      style: context.textTheme.labelMedium
                                          ?.copyWith(color: Colors.white),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      d.aiInsight!,
                                      style: context.textTheme.bodyMedium
                                          ?.copyWith(color: Colors.white),
                                    ),
                                    if (d.aiConfidence != null) ...[
                                      const SizedBox(height: 8),
                                      Text(
                                        'Confidence: ${(d.aiConfidence! * 100).toStringAsFixed(0)}%',
                                        style: context.textTheme.labelSmall
                                            ?.copyWith(
                                                color: Colors.white70),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                    // ── Key facts ──────────────────────────────
                    const SectionHeader(title: 'Details'),
                    Card(
                      margin: const EdgeInsets.symmetric(horizontal: 20),
                      child: Column(
                        children: [
                          _FactRow(
                            icon: PhosphorIconsRegular.currencyDollar,
                            label: 'Value',
                            value: Formatters.currency(d.value),
                          ),
                          _FactRow(
                            icon: PhosphorIconsRegular.scales,
                            label: 'Weighted',
                            value: Formatters.currency(d.effectiveWeighted),
                          ),
                          _FactRow(
                            icon: PhosphorIconsRegular.percent,
                            label: 'Probability',
                            value: d.probability != null
                                ? Formatters.percent(d.probability! * 100)
                                : '—',
                          ),
                          if (d.expectedCloseDate != null)
                            _FactRow(
                              icon: PhosphorIconsRegular.calendar,
                              label: 'Expected Close',
                              value: Formatters.date(d.expectedCloseDate!),
                            ),
                          if (d.actualCloseDate != null)
                            _FactRow(
                              icon: PhosphorIconsRegular.checkCircle,
                              label: 'Closed On',
                              value: Formatters.date(d.actualCloseDate!),
                            ),
                          if (d.nextStep != null)
                            _FactRow(
                              icon: PhosphorIconsRegular.footprints,
                              label: 'Next Step',
                              value: d.nextStep!,
                            ),
                        ],
                      ),
                    ),

                    // ── Contact link ───────────────────────────
                    if (d.contactId != null)
                      Card(
                        margin: const EdgeInsets.all(20),
                        child: ListTile(
                          leading: const CircleAvatar(
                            child: Icon(PhosphorIconsRegular.user),
                          ),
                          title: Text(d.contactName ?? 'Contact'),
                          subtitle: const Text('Tap to view contact'),
                          trailing: const Icon(Icons.chevron_right, size: 20),
                          onTap: () =>
                              context.push('/contacts/${d.contactId}'),
                        ),
                      ),

                    // ── Notes ──────────────────────────────────
                    if (d.notes != null) ...[
                      const SectionHeader(title: 'Notes'),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(
                              d.notes!,
                              style: context.textTheme.bodyMedium,
                            ),
                          ),
                        ),
                      ),
                    ],

                    // ── Activity timeline ──────────────────────
                    const SectionHeader(title: 'Activity'),
                    const RecentActivity(),

                    const SizedBox(height: 80),
                  ],
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator(strokeWidth: 2)),
        error: (e, _) => ErrorState(message: 'Failed to load deal: $e'),
      ),
    );
  }

  Future<void> _changeStage(
    BuildContext context,
    WidgetRef ref,
    String dealId,
    String newStage,
  ) async {
    try {
      await ref.read(firestoreServiceProvider).updateDealStage(dealId, newStage);
      if (!context.mounted) return;
      context.showSuccess('Stage updated to ${AppConstants.stageLabels[newStage]}');
    } catch (e) {
      if (!context.mounted) return;
      context.showError('Failed: $e');
    }
  }
}

class _FactRow extends StatelessWidget {
  const _FactRow({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.textSecondary, size: 20),
      title: Text(label, style: context.textTheme.labelSmall),
      subtitle: Text(value, style: context.textTheme.bodyMedium),
    );
  }
}

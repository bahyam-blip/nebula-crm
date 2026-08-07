import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
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
import '../../../contacts/providers/contact_provider.dart';
import '../../models/deal.dart';

class PipelineBoardScreen extends ConsumerStatefulWidget {
  const PipelineBoardScreen({super.key});

  @override
  ConsumerState<PipelineBoardScreen> createState() =>
      _PipelineBoardScreenState();
}

class _PipelineBoardScreenState extends ConsumerState<PipelineBoardScreen> {
  @override
  Widget build(BuildContext context) {
    final dealsByStage = ref.watch(dealsByStageProvider);
    final summary = ref.watch(pipelineSummaryProvider);

    return Scaffold(
      body: NestedScrollView(
        headerSliverBuilder: (_, __) => [
          SliverAppBar(
            expandedHeight: 160,
            pinned: true,
            title: const Text('Pipeline'),
            flexibleSpace: FlexibleSpaceBar(
              background: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppColors.surface, AppColors.background],
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
                          Formatters.currencyCompact(summary.openValue),
                          style: AppTypography.numericLarge,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Open · ${summary.openCount} deals · Weighted ${Formatters.currencyCompact(summary.weightedValue)}',
                          style: context.textTheme.bodySmall
                              ?.copyWith(color: AppColors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
        body: dealsByStage.isEmpty
            ? const EmptyState(
                icon: PhosphorIconsRegular.kanban,
                title: 'No deals yet',
                subtitle: 'Create your first deal to start tracking your pipeline.',
                actionLabel: 'Add deal',
              )
            : SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.all(16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final stage in AppConstants.pipelineStages)
                      Padding(
                        padding: const EdgeInsets.only(right: 12),
                        child: _PipelineColumn(
                          stage: stage,
                          deals: dealsByStage[stage] ?? [],
                        ),
                      ),
                  ],
                ),
              ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/deals/new'),
        icon: const Icon(PhosphorIconsRegular.plus, size: 20),
        label: const Text('Add Deal'),
      ),
    );
  }
}

class _PipelineColumn extends ConsumerWidget {
  const _PipelineColumn({required this.stage, required this.deals});

  final String stage;
  final List<Deal> deals;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final color = AppColors.stageColor(stage);
    final total = deals.fold<double>(0, (s, d) => s + d.value);
    final label = AppConstants.stageLabels[stage] ?? stage;

    return SizedBox(
      width: 280,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border, width: 0.5),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
              child: Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(label, style: context.textTheme.labelLarge),
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceHigh,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '${deals.length}',
                      style: context.textTheme.labelSmall,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    Formatters.currencyCompact(total),
                    style: context.textTheme.labelMedium
                        ?.copyWith(color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),

            // Cards
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                padding: const EdgeInsets.all(10),
                itemCount: deals.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (_, i) => _DealCard(
                  deal: deals[i],
                  stageColor: color,
                ),
              ),
            ),

            // Drop zone hint
            if (deals.isEmpty)
              Padding(
                padding: const EdgeInsets.all(20),
                child: Center(
                  child: Text(
                    'Drop deals here',
                    style: context.textTheme.labelSmall,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _DealCard extends ConsumerWidget {
  const _DealCard({required this.deal, required this.stageColor});
  final Deal deal;
  final Color stageColor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Material(
      color: AppColors.surfaceElevated,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: () => context.push('/pipeline/deals/${deal.id}'),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border, width: 0.5),
          ),
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (deal.priority > 0)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: Icon(
                        deal.priority == 2
                            ? PhosphorIconsFill.star
                            : PhosphorIconsRegular.star,
                        size: 14,
                        color: AppColors.warning,
                      ),
                    ),
                  Expanded(
                    child: Text(
                      deal.title,
                      style: context.textTheme.titleSmall,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              if (deal.company != null || deal.contactName != null)
                Row(
                  children: [
                    Icon(PhosphorIconsRegular.building,
                        size: 12, color: AppColors.textTertiary),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        deal.company ?? deal.contactName ?? '',
                        style: context.textTheme.labelSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Text(
                    Formatters.currency(deal.value),
                    style: AppTypography.numericSmall.copyWith(
                      color: stageColor,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const Spacer(),
                  if (deal.expectedCloseDate != null) ...[
                    Icon(PhosphorIconsRegular.calendar,
                        size: 12, color: AppColors.textTertiary),
                    const SizedBox(width: 4),
                    Text(
                      Formatters.shortDate(deal.expectedCloseDate!),
                      style: context.textTheme.labelSmall,
                    ),
                  ],
                ],
              ),
              if (deal.aiInsight != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.tertiary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Row(
                    children: [
                      Icon(PhosphorIconsRegular.sparkle,
                          size: 10, color: AppColors.tertiary),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          deal.aiInsight!,
                          style: context.textTheme.labelSmall
                              ?.copyWith(color: AppColors.tertiary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    ).animate().fadeIn(duration: 250.ms);
  }
}

import 'package:flutter/material.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../pipeline/models/deal.dart';

/// Pipeline conversion funnel — horizontal bars showing deal count and
/// total value at each stage.
class ConversionFunnel extends StatelessWidget {
  const ConversionFunnel({super.key, required this.dealsByStage});

  final Map<String, List<Deal>> dealsByStage;

  @override
  Widget build(BuildContext context) {
    final stages = AppConstants.pipelineStages;
    final maxCount = stages.fold<int>(0, (max, s) {
      final n = dealsByStage[s]?.length ?? 0;
      return n > max ? n : max;
    }).clamp(1, 99999);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        children: [
          for (var i = 0; i < stages.length; i++) ...[
            _FunnelRow(
              stage: stages[i],
              deals: dealsByStage[stages[i]] ?? [],
              maxCount: maxCount,
              isLast: i == stages.length - 1,
            ),
            if (i < stages.length - 1) const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }
}

class _FunnelRow extends StatelessWidget {
  const _FunnelRow({
    required this.stage,
    required this.deals,
    required this.maxCount,
    required this.isLast,
  });

  final String stage;
  final List<Deal> deals;
  final int maxCount;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final color = AppColors.stageColor(stage);
    final count = deals.length;
    final totalValue = deals.fold<double>(0, (s, d) => s + d.value);
    final widthPct = maxCount == 0 ? 0.0 : (count / maxCount).clamp(0.0, 1.0);
    final label = AppConstants.stageLabels[stage] ?? stage;

    return Row(
      children: [
        SizedBox(
          width: 88,
          child: Text(label, style: context.textTheme.labelMedium),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  Container(
                    height: 28,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceHigh,
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  FractionallySizedBox(
                    widthFactor: widthPct,
                    child: Container(
                      height: 28,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            color.withValues(alpha: 0.4),
                            color.withValues(alpha: 0.7),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: SizedBox(
                      height: 28,
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          '$count deals · ${Formatters.currencyCompact(totalValue)}',
                          style: AppTypography.numericSmall.copyWith(
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

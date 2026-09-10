import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/widgets/nebula_ui.dart';
import '../../../assistant/models/insight.dart';
import '../../../assistant/providers/assistant_provider.dart';

/// Top-of-dashboard AI insight banner — MONO edition: a raised black
/// slab with a white AI mark, hairline chrome, semantic tick only when
/// the insight is a risk. Confidence line stays quiet gray.
class AiInsightBanner extends ConsumerWidget {
  const AiInsightBanner({super.key, required this.insight});
  final Insight insight;

  bool get _isRisk => switch (insight.type) {
        InsightType.atRiskDeal ||
        InsightType.churnRisk ||
        InsightType.anomaly =>
          true,
        _ => false,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
      child: NebulaCard(
        onTap: () => _handleTap(context, ref),
        accent: _isRisk ? AppColors.danger : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.auto_awesome_outlined,
                    color: AppColors.textPrimary, size: 16),
                const SizedBox(width: 8),
                Text(
                  insight.type.label.toUpperCase(),
                  style: AppTypography.overline(AppColors.textSecondary),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close_outlined,
                      color: AppColors.textTertiary, size: 18),
                  onPressed: () => ref
                      .read(insightActionsProvider.notifier)
                      .dismiss(insight.id),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              insight.title,
              style: AppTypography.textTheme.titleSmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 6),
            Text(
              insight.summary,
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary, height: 1.5),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  Icons.speed_outlined,
                  size: 12,
                  color: AppColors.textTertiary,
                ),
                const SizedBox(width: 4),
                Text(
                  insight.confidenceLabel,
                  style: context.textTheme.labelSmall?.copyWith(
                    color: AppColors.textTertiary,
                  ),
                ),
                const Spacer(),
                if (insight.recommendedAction != null)
                  TextButton(
                    onPressed: () => _handleTap(context, ref),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.textPrimary,
                      visualDensity: VisualDensity.compact,
                    ),
                    child: Text(insight.recommendedAction!),
                  ),
              ],
            ),
          ],
        ),
      ),
    ).animate().fadeIn(duration: 400.ms).slideY(begin: -0.05);
  }

  void _handleTap(BuildContext context, WidgetRef ref) {
    ref.read(insightActionsProvider.notifier).markActedOn(insight.id);
    if (insight.targetType == 'deal' && insight.targetId != null) {
      context.push('/pipeline/deals/${insight.targetId}');
    } else if (insight.targetType == 'contact' && insight.targetId != null) {
      context.push('/contacts/${insight.targetId}');
    } else if (insight.targetType == 'ticket' && insight.targetId != null) {
      context.push('/tickets/${insight.targetId}');
    }
  }
}

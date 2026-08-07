import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/gradient_card.dart';
import '../../../assistant/models/insight.dart';
import '../../../assistant/providers/assistant_provider.dart';

/// Top-of-dashboard AI insight banner — premium gradient card with
/// confidence, summary, and a CTA.
class AiInsightBanner extends ConsumerWidget {
  const AiInsightBanner({super.key, required this.insight});
  final Insight insight;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
      child: GradientCard(
        gradient: _gradientFor(insight.type),
        onTap: () => _handleTap(context, ref),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(PhosphorIconsFill.sparkle, color: Colors.white, size: 18),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    insight.type.label,
                    style: context.textTheme.labelSmall?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(PhosphorIconsRegular.x, color: Colors.white70, size: 18),
                  onPressed: () => ref
                      .read(insightActionsProvider.notifier)
                      .dismiss(insight.id),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              insight.title,
              style: AppTypography.textTheme.titleMedium
                  ?.copyWith(color: Colors.white),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 6),
            Text(
              insight.summary,
              style: context.textTheme.bodySmall
                  ?.copyWith(color: Colors.white.withValues(alpha: 0.85)),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  PhosphorIconsRegular.gauge,
                  size: 12,
                  color: Colors.white.withValues(alpha: 0.7),
                ),
                const SizedBox(width: 4),
                Text(
                  insight.confidenceLabel,
                  style: context.textTheme.labelSmall?.copyWith(
                    color: Colors.white.withValues(alpha: 0.7),
                  ),
                ),
                const Spacer(),
                if (insight.recommendedAction != null)
                  TextButton(
                    onPressed: () => _handleTap(context, ref),
                    style: TextButton.styleFrom(
                      foregroundColor: Colors.white,
                      visualDensity: VisualDensity.compact,
                    ),
                    child: Text(insight.recommendedAction!),
                  ),
              ],
            ),
          ],
        ),
      ),
    ).animate().fadeIn(duration: 500.ms).slideY(begin: -0.05);
  }

  LinearGradient _gradientFor(InsightType t) {
    return switch (t) {
      InsightType.atRiskDeal ||
      InsightType.churnRisk ||
      InsightType.anomaly =>
        AppColors.dangerGradient,
      InsightType.upsellOpportunity ||
      InsightType.forecastAdjustment ||
      InsightType.followUpReminder =>
        AppColors.primaryGradient,
      _ => AppColors.premiumGradient,
    };
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

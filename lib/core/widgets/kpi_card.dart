import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../theme/app_colors.dart';
import '../theme/app_typography.dart';
import '../utils/extensions.dart';
import 'nebula_ui.dart';

/// A KPI metric card — Nebula Design Language 2.0.
///
/// Composition: glowing icon tile → aurora value in Sora → quiet label →
/// honest context line. Optional delta carries semantic color. The whole
/// card lifts on press (spring scale) and can deep-link via [onTap].
class KpiCard extends StatelessWidget {
  const KpiCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.delta,
    this.deltaSuffix = 'vs last period',
    this.sublabel,
    this.accentColor = AppColors.primary,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final double? delta;
  final String deltaSuffix;

  /// Real context line under the value (e.g. "6 open deals"). Used
  /// INSTEAD of [delta] when there is no honest period comparison —
  /// inventing deltas looked like data and was worse than no delta.
  final String? sublabel;
  final Color accentColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final isPositive = (delta ?? 0) >= 0;
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.glassEdge, width: 1),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomCenter,
            colors: [
              accentColor.withValues(alpha: 0.06),
              Colors.transparent,
            ],
            stops: const [0.0, 0.5],
          ),
          boxShadow: AppColors.cardShadow,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                NebulaIconTile(
                  icon: icon,
                  color: accentColor,
                  size: 38,
                  rounded: 11,
                ),
                const Spacer(),
                if (delta != null)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: (isPositive
                              ? AppColors.success
                              : AppColors.danger)
                          .withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          isPositive
                              ? Icons.north_east_rounded
                              : Icons.south_east_rounded,
                          color: isPositive
                              ? AppColors.success
                              : AppColors.danger,
                          size: 12,
                        ),
                        const SizedBox(width: 3),
                        Text(
                          '${delta!.abs().toStringAsFixed(1)}%',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: isPositive
                                ? AppColors.success
                                : AppColors.danger,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            const Spacer(),
            Text(
              value,
              style: AppTypography.numericLarge.copyWith(fontSize: 27),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: context.textTheme.bodySmall?.copyWith(
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w500,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            if (delta != null)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text(
                  deltaSuffix,
                  style: context.textTheme.labelSmall,
                ),
              )
            else if (sublabel != null)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text(
                  sublabel!,
                  style: context.textTheme.labelSmall?.copyWith(
                    color: AppColors.textTertiary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
        ),
      ),
    ).animate().fadeIn(duration: 320.ms).slideY(begin: 0.05);
  }
}

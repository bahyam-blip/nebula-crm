import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../theme/app_colors.dart';
import '../theme/app_typography.dart';
import '../utils/extensions.dart';

/// A KPI metric card with title, value, delta vs. previous period,
/// and an icon chip. Used heavily on the dashboard.
class KpiCard extends StatelessWidget {
  const KpiCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.delta,
    this.deltaSuffix = 'vs last period',
    this.accentColor = AppColors.primary,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final double? delta;
  final String deltaSuffix;
  final Color accentColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final isPositive = (delta ?? 0) >= 0;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          decoration: BoxDecoration(
            color: AppColors.surfaceElevated,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border, width: 0.5),
          ),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: accentColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(icon, color: accentColor, size: 18),
                  ),
                  const Spacer(),
                  if (delta != null)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          isPositive
                              ? Icons.north_east
                              : Icons.south_east,
                          color: isPositive
                              ? AppColors.success
                              : AppColors.danger,
                          size: 14,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '${delta!.abs().toStringAsFixed(1)}%',
                          style: context.textTheme.labelMedium?.copyWith(
                            color: isPositive
                                ? AppColors.success
                                : AppColors.danger,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Text(value, style: AppTypography.numeric),
              const SizedBox(height: 6),
              Text(
                label,
                style: context.textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondary,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (delta != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    deltaSuffix,
                    style: context.textTheme.labelSmall,
                  ),
                ),
            ],
          ),
        ),
      ),
    ).animate().fadeIn(duration: 300.ms).slideY(begin: 0.05);
  }
}

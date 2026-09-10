import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// A card with an (optional) monochrome wash — used for hero CTAs,
/// AI insight banners, and premium feature highlights.
///
/// MONO edition: the default "gradient" is now a whisper of white light
/// fading into black — atmosphere without decoration.
class GradientCard extends StatelessWidget {
  const GradientCard({
    super.key,
    this.gradient,
    this.padding = const EdgeInsets.all(20),
    this.borderRadius = 18,
    this.onTap,
    this.border,
    this.child,
  });

  final Widget? child;
  final Gradient? gradient;
  final EdgeInsetsGeometry padding;
  final double borderRadius;
  final VoidCallback? onTap;
  final Border? border;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(borderRadius),
        child: Ink(
          decoration: BoxDecoration(
            gradient: gradient ?? AppColors.heroWash,
            color: gradient == null ? AppColors.surfaceElevated : null,
            borderRadius: BorderRadius.circular(borderRadius),
            border: border ?? Border.all(color: AppColors.border, width: 1),
          ),
          padding: padding,
          child: child,
        ),
      ),
    );
  }
}

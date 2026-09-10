import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

// ═══════════════════════════════════════════════════════════════════
// NEBULA UI KIT — MONO edition.
//
// The 2.0 kit decorated (aurora glows, glass, gradients). The 3.0 kit
// is deliberately quieter — the restraint IS the design:
//   1. BLACK CANVAS — screens are true black; ambient light is a faint
//      white breath at 2-4% opacity. Nothing glows.
//   2. WHITE ACTIONS — primary actions are solid white on black with
//      black labels. Selection is inversion, not color.
//   3. HAIRLINE CHROME — 1px #1F1F1F strokes; depth from elevation
//      steps of black, never from borders-of-color or shadows-of-color.
//   4. MOTION STAYS — spring presses and staggered entrances survive;
//      movement is craft, decoration is not.
// ═══════════════════════════════════════════════════════════════════

// ── Ambient background ────────────────────────────────────────────

/// Ambient backdrop — an almost-imperceptible white breath from the top
/// of the screen over true black. No hue, no drift; stillness reads as
/// confidence. (Keeps the AuroraBackground name/API for compatibility.)
class AuroraBackground extends StatelessWidget {
  const AuroraBackground({
    super.key,
    required this.child,
    this.intensity = 1.0,
    this.animate = true,
  });

  final Widget child;
  final double intensity;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final i = intensity.clamp(0.0, 2.0);
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: const [0.0, 0.45],
          colors: [
            Color.lerp(const Color(0xFF000000), const Color(0xFF161616),
                0.55 * i)!,
            AppColors.background,
          ],
        ),
      ),
      child: child,
    );
  }
}

// ── Tactility ─────────────────────────────────────────────────────

/// Spring press physics wrapper — scales to 0.97 while pressed with a
/// gentle curve back. Wrap anything tappable that Material InkWell
/// doesn't already give depth to.
class PressableScale extends StatefulWidget {
  const PressableScale({
    super.key,
    required this.child,
    this.onTap,
    this.pressedScale = 0.97,
  });

  final Widget child;
  final VoidCallback? onTap;
  final double pressedScale;

  @override
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: widget.onTap == null
          ? null
          : (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? widget.pressedScale : 1.0,
        duration: const Duration(milliseconds: 140),
        curve: Curves.easeOutCubic,
        child: widget.child,
      ),
    );
  }
}

// ── Cards ─────────────────────────────────────────────────────────

/// The workhorse container: flat black surface, 1px hairline, nothing
/// else. Optional [accent] tints ONLY the border for meaning.
class NebulaCard extends StatelessWidget {
  const NebulaCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    this.accent,
    this.glow = false,
    this.radius = 16,
    this.fill,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final Color? accent;
  final bool glow;
  final double radius;
  final Color? fill;

  @override
  Widget build(BuildContext context) {
    final card = Container(
      decoration: BoxDecoration(
        color: fill ?? AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(
          color: accent != null
              ? accent!.withValues(alpha: 0.45)
              : AppColors.border,
          width: 1,
        ),
      ),
      child: Padding(padding: padding, child: child),
    );

    if (onTap == null) return card;
    return PressableScale(
      onTap: onTap,
      child: card,
    );
  }
}

/// Hero card for the one thing that matters most on a screen — a raised
/// black slab with a brighter hairline. Used sparingly (max one per
/// screen). Inverted (white) fill is available via [inverted] for the
/// single loudest surface.
class NebulaHeroCard extends StatelessWidget {
  const NebulaHeroCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(18),
    this.radius = 20,
    this.inverted = false,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final double radius;
  final bool inverted;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      pressedScale: 0.98,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(radius),
          color: inverted ? AppColors.primary : const Color(0xFF101010),
          border: Border.all(
            color: inverted ? AppColors.primary : AppColors.glassEdge,
            width: 1,
          ),
        ),
        child: Padding(
          padding: padding,
          child: inverted
              ? Theme(
                  data: ThemeData.dark().copyWith(
                    textTheme: Theme.of(context).textTheme.copyWith(
                          bodyMedium: Theme.of(context)
                              .textTheme
                              .bodyMedium
                              ?.copyWith(color: const Color(0xFF0A0A0A)),
                        ),
                  ),
                  child: child,
                )
              : child,
        ),
      ),
    );
  }
}

// ── Buttons ───────────────────────────────────────────────────────

/// Primary action button — SOLID WHITE with a black label. The single
/// loudest element anywhere in the app; everything defers to it.
class NebulaButton extends StatelessWidget {
  const NebulaButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.loading = false,
    this.expanded = true,
    this.variant = NebulaButtonVariant.primary,
    this.height = 52,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final bool expanded;
  final NebulaButtonVariant variant;
  final double height;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    final Widget content = loading
        ? SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2.2,
              valueColor: AlwaysStoppedAnimation(_fg),
            ),
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 18, color: _fg),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.1,
                    color: _fg,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          );

    final Widget button = PressableScale(
      onTap: enabled ? onPressed : null,
      child: Opacity(
        opacity: enabled ? 1 : 0.4,
        child: Container(
          height: height,
          padding: const EdgeInsets.symmetric(horizontal: 22),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: variant == NebulaButtonVariant.primary
                ? AppColors.primary
                : variant == NebulaButtonVariant.ghost
                    ? Colors.transparent
                    : AppColors.glassFillStrong,
            borderRadius: BorderRadius.circular(14),
            border: variant == NebulaButtonVariant.primary
                ? null
                : Border.all(
                    color: variant == NebulaButtonVariant.ghost
                        ? AppColors.glassEdge
                        : AppColors.glassEdge,
                    width: 1),
          ),
          child: content,
        ),
      ),
    );

    if (!expanded) return button;
    return SizedBox(width: double.infinity, child: button);
  }

  Color get _fg => variant == NebulaButtonVariant.primary
      ? const Color(0xFF0A0A0A)
      : AppColors.textPrimary;
}

enum NebulaButtonVariant { primary, outlined, ghost }

// ── Icon tiles / chips ────────────────────────────────────────────

/// Square icon container — quiet gray slab, white outline icon.
class NebulaIconTile extends StatelessWidget {
  const NebulaIconTile({
    super.key,
    required this.icon,
    this.color = AppColors.textPrimary,
    this.size = 40,
    this.iconSize,
    this.rounded = 12,
  });

  final IconData icon;
  final Color color;
  final double size;
  final double? iconSize;
  final double rounded;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(rounded),
        color: AppColors.surfaceHigh,
        border: Border.all(color: AppColors.border, width: 1),
      ),
      child: Icon(icon,
          color: color, size: iconSize ?? size * 0.46),
    );
  }
}

/// Selectable pill — selection is INVERSION: white fill, black text.
class NebulaChip extends StatelessWidget {
  const NebulaChip({
    super.key,
    required this.label,
    this.selected = false,
    this.onSelected,
    this.icon,
    this.color = AppColors.primary,
  });

  final String label;
  final bool selected;
  final VoidCallback? onSelected;
  final IconData? icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onSelected,
      pressedScale: 0.95,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected
                ? AppColors.primary
                : (onSelected != null
                    ? AppColors.glassEdge
                    : AppColors.border),
            width: 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon,
                  size: 14,
                  color: selected
                      ? const Color(0xFF0A0A0A)
                      : AppColors.textSecondary),
              const SizedBox(width: 6),
            ],
            Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: selected
                    ? const Color(0xFF0A0A0A)
                    : AppColors.textSecondary,
                letterSpacing: 0.1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Choreography ──────────────────────────────────────────────────

/// Staggered entrance — wrap list children with [index] so the list
/// cascades in. Cheap, and instantly reads as craft.
class StaggerIn extends StatelessWidget {
  const StaggerIn({
    super.key,
    required this.child,
    this.index = 0,
    this.baseDelay = 30,
  });

  final Widget child;
  final int index;
  final int baseDelay;

  @override
  Widget build(BuildContext context) {
    return child
        .animate(delay: (index * baseDelay).ms)
        .fadeIn(duration: 360.ms, curve: Curves.easeOutCubic)
        .slideY(
            begin: 0.06,
            end: 0,
            duration: 360.ms,
            curve: Curves.easeOutCubic);
  }
}

// ── Overline / section label ──────────────────────────────────────

/// Tiny uppercase eyebrow — the typographic glue of the design language.
class OverlineLabel extends StatelessWidget {
  const OverlineLabel(this.text, {super.key, this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: AppTypography.overline(color ?? AppColors.textTertiary),
    );
  }
}

// ── Sheet & toast ─────────────────────────────────────────────────

/// Standard Nebula bottom sheet — grabber, rounded top, safe area.
Future<T?> showNebulaSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  Color? backgroundColor,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: isScrollControlled,
    backgroundColor: backgroundColor ?? AppColors.surfaceHigh,
    barrierColor: Colors.black.withValues(alpha: 0.7),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (sheetContext) {
      return Container(
        decoration: const BoxDecoration(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          border: Border(
            top: BorderSide(color: AppColors.border, width: 1),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.textTertiary.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Flexible(child: builder(sheetContext)),
          ],
        ),
      );
    },
  );
}

/// Floating toast — black glass, white text, minimal icon.
void showNebulaToast(
  BuildContext context,
  String message, {
  IconData icon = Icons.check_circle_outline,
  Color color = AppColors.textPrimary,
}) {
  final overlay = OverlayEntry(
    builder: (toastContext) => Positioned(
      top: MediaQuery.paddingOf(context).top + 12,
      left: 20,
      right: 20,
      child: Material(
        color: Colors.transparent,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: const Color(0xE6141414),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  message,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
        )
            .animate()
            .slideY(
              begin: -0.6,
              end: 0,
              duration: 340.ms,
              curve: Curves.easeOutCubic,
            )
            .fadeIn(duration: 200.ms),
      ),
    ),
  );

  Overlay.of(context).insert(overlay);
  Future.delayed(const Duration(milliseconds: 2400), () {
    if (overlay.mounted) overlay.remove();
  });
}

// ── Progress ──────────────────────────────────────────────────────

/// Slim white progress bar (0..1) — used for quotas, onboarding, funnels.
class NebulaProgress extends StatelessWidget {
  const NebulaProgress({
    super.key,
    required this.value,
    this.color = AppColors.primary,
    this.height = 4,
  });

  final double value;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    final v = value.clamp(0.0, 1.0).toDouble();
    return ClipRRect(
      borderRadius: BorderRadius.circular(height / 2),
      child: SizedBox(
        height: height,
        child: Stack(
          children: [
            Container(color: AppColors.surfaceHigh),
            FractionallySizedBox(
              widthFactor: v,
              child: Container(color: color),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Loading ───────────────────────────────────────────────────────

/// Shimmering placeholder block — compose skeletons from these.
class ShimmerBox extends StatelessWidget {
  const ShimmerBox({
    super.key,
    this.width,
    this.height = 14,
    this.radius = 6,
  });

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(radius),
      ),
    )
        .animate(onPlay: (c) => c.repeat())
        .shimmer(
          duration: 1200.ms,
          color: Colors.white.withValues(alpha: 0.04),
        );
  }
}

/// Full-card skeleton with icon + value rows — matches [NebulaStatCard].
class NebulaSkeletonCard extends StatelessWidget {
  const NebulaSkeletonCard({super.key, this.height = 132});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ShimmerBox(width: 40, height: 40, radius: 12),
          const Spacer(),
          const ShimmerBox(width: 120, height: 24, radius: 8),
          const SizedBox(height: 8),
          const ShimmerBox(width: 80, height: 10),
        ],
      ),
    );
  }
}

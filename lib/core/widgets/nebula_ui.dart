import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

// ═══════════════════════════════════════════════════════════════════
// NEBULA UI KIT — the signature component layer.
//
// Every widget here exists because a plain Material equivalent reads
// "default". The kit adds the three things that separate premium apps:
//   1. ATMOSPHERE  — aurora ambient light, glass materials, glow.
//   2. TACTILITY   — spring press physics on everything touchable.
//   3. CHOREOGRAPHY— staggered entrances that guide the eye.
// ═══════════════════════════════════════════════════════════════════

// ── Aurora ambient background ─────────────────────────────────────

/// Ambient aurora backdrop — two/three slow-drifting radial glows behind
/// content. Gives dark screens depth and brand atmosphere at ~zero cost
/// (repaints are throttled by the slow controller duration).
class AuroraBackground extends StatefulWidget {
  const AuroraBackground({
    super.key,
    required this.child,
    this.intensity = 1.0,
    this.animate = true,
  });

  final Widget child;

  /// 0 = invisible, 1 = standard ambience, >1 = stronger for hero screens.
  final double intensity;

  final bool animate;

  @override
  State<AuroraBackground> createState() => _AuroraBackgroundState();
}

class _AuroraBackgroundState extends State<AuroraBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 18),
    );
    if (widget.animate) _controller.repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final i = widget.intensity;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = Curves.easeInOut.transform(_controller.value);
        return CustomPaint(
          painter: _AuroraPainter(t: t, intensity: i),
          isComplex: true,
          willChange: widget.animate,
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

class _AuroraPainter extends CustomPainter {
  _AuroraPainter({required this.t, required this.intensity});
  final double t;
  final double intensity;

  @override
  void paint(Canvas canvas, Size size) {
    if (intensity <= 0) return;
    final w = size.width;
    final h = size.height;

    void orb(Offset c, double r, Color color, double alpha) {
      final paint = Paint()
        ..shader = RadialGradient(
          colors: [color.withValues(alpha: alpha), color.withValues(alpha: 0)],
        ).createShader(Rect.fromCircle(center: c, radius: r));
      canvas.drawCircle(c, r, paint);
    }

    // Top-left indigo bloom.
    orb(
      Offset(w * (0.06 + 0.04 * t), -h * 0.08),
      w * 0.85,
      AppColors.auroraIndigo,
      0.10 * intensity,
    );
    // Right violet bloom, drifting opposite.
    orb(
      Offset(w * (1.02 - 0.03 * t), h * (0.22 + 0.05 * t)),
      w * 0.6,
      AppColors.auroraViolet,
      0.07 * intensity,
    );
    // Faint cyan floor glow.
    orb(
      Offset(w * 0.5, h * 1.06),
      w * 0.75,
      AppColors.auroraCyan,
      0.05 * intensity,
    );
  }

  @override
  bool shouldRepaint(_AuroraPainter oldDelegate) =>
      oldDelegate.t != t || oldDelegate.intensity != intensity;
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

/// Signature glass card: hairline that catches light on the top edge,
/// glass fill, optional accent glow. The workhorse container.
class NebulaCard extends StatelessWidget {
  const NebulaCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    this.accent,
    this.glow = false,
    this.radius = 18,
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
    final a = accent ?? AppColors.primary;
    final card = Container(
      decoration: BoxDecoration(
        color: fill ?? AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(
          color: AppColors.glassEdge,
          width: 1,
        ),
        gradient: fill == null
            ? LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.white.withValues(alpha: 0.03),
                  Colors.transparent,
                ],
                stops: const [0.0, 0.35],
              )
            : null,
        boxShadow: [
          ...AppColors.cardShadow,
          if (glow) ...AppColors.glow(a, alpha: 0.22),
        ],
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

/// Hero card for the one thing that matters most on a screen — gradient
/// wash, aurora rim, soft glow. Used sparingly (max one per screen).
class NebulaHeroCard extends StatelessWidget {
  const NebulaHeroCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(18),
    this.radius = 22,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      pressedScale: 0.98,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(radius),
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF182042), Color(0xFF10131F)],
            stops: [0.0, 0.7],
          ),
          border: Border.all(
            color: AppColors.primary.withValues(alpha: 0.35),
            width: 1,
          ),
          boxShadow: AppColors.glow(AppColors.primary, alpha: 0.18),
        ),
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

// ── Buttons ───────────────────────────────────────────────────────

/// Primary action button — aurora gradient, glow, spring press, loading.
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
        ? const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2.2,
              valueColor: AlwaysStoppedAnimation(Colors.white),
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
                    fontWeight: FontWeight.w700,
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
        opacity: enabled ? 1 : 0.45,
        child: Container(
          height: height,
          padding: const EdgeInsets.symmetric(horizontal: 22),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: variant == NebulaButtonVariant.primary
                ? AppColors.primaryGradient
                : null,
            color: variant == NebulaButtonVariant.primary
                ? null
                : (variant == NebulaButtonVariant.ghost
                    ? Colors.transparent
                    : AppColors.glassFillStrong),
            borderRadius: BorderRadius.circular(15),
            border: variant == NebulaButtonVariant.outlined
                ? Border.all(color: AppColors.glassEdge, width: 1)
                : variant == NebulaButtonVariant.ghost
                    ? null
                    : null,
            boxShadow: variant == NebulaButtonVariant.primary && enabled
                ? AppColors.glow(AppColors.primary, alpha: 0.28)
                : null,
          ),
          child: content,
        ),
      ),
    );

    if (!expanded) return button;
    return SizedBox(width: double.infinity, child: button);
  }

  Color get _fg => variant == NebulaButtonVariant.primary
      ? Colors.white
      : AppColors.textPrimary;
}

enum NebulaButtonVariant { primary, outlined, ghost }

// ── Icon tiles / chips ────────────────────────────────────────────

/// Squircle icon container with tint gradient — the standard way to
/// render an icon with weight next to text.
class NebulaIconTile extends StatelessWidget {
  const NebulaIconTile({
    super.key,
    required this.icon,
    this.color = AppColors.primary,
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
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            color.withValues(alpha: 0.22),
            color.withValues(alpha: 0.08),
          ],
        ),
        border: Border.all(
          color: color.withValues(alpha: 0.25),
          width: 1,
        ),
      ),
      child: Icon(icon, color: color, size: iconSize ?? size * 0.48),
    );
  }
}

/// Animated selectable pill — morphs to filled gradient when active.
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
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          gradient: selected ? AppColors.primaryGradient : null,
          color: selected ? null : AppColors.glassFill,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected
                ? Colors.transparent
                : (onSelected != null
                    ? AppColors.glassEdge
                    : AppColors.border),
            width: 1,
          ),
          boxShadow: selected
              ? AppColors.glow(color, alpha: 0.25)
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon,
                  size: 14,
                  color: selected ? Colors.white : AppColors.textSecondary),
              const SizedBox(width: 6),
            ],
            Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? Colors.white : AppColors.textSecondary,
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
        .slideY(begin: 0.06, end: 0, duration: 360.ms, curve: Curves.easeOutCubic);
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
    barrierColor: Colors.black.withValues(alpha: 0.6),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
    ),
    builder: (sheetContext) {
      return Container(
        decoration: const BoxDecoration(
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
          border: Border(
            top: BorderSide(color: AppColors.glassEdge, width: 1),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.textTertiary.withValues(alpha: 0.5),
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

/// Floating glass toast — appears at the top with spring physics.
/// Use for feedback that a SnackBar would render as heavy chrome.
void showNebulaToast(
  BuildContext context,
  String message, {
  IconData icon = Icons.check_circle,
  Color color = AppColors.success,
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
            color: AppColors.surfaceHighest.withValues(alpha: 0.96),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.glassEdge),
            boxShadow: AppColors.cardShadow,
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
                    fontWeight: FontWeight.w600,
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
              curve: Curves.easeOutBack,
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

/// Slim glowing progress bar (0..1) — used for quotas, onboarding, funnels.
class NebulaProgress extends StatelessWidget {
  const NebulaProgress({
    super.key,
    required this.value,
    this.color = AppColors.primary,
    this.height = 5,
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
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [color.withValues(alpha: 0.7), color],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: color.withValues(alpha: 0.5),
                      blurRadius: 6,
                    ),
                  ],
                ),
              ),
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
          color: Colors.white.withValues(alpha: 0.05),
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
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border, width: 0.5),
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

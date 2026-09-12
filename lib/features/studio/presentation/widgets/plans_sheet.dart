import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/nebula_ui.dart';
import '../../models/studio_models.dart';
import '../../providers/studio_provider.dart';

/// v12 PLANS SHEET — the subscription surface: current plan + usage bars,
/// then the catalog. Checkout creates a pending order (manual activation
/// by the owner today; a payment SDK slots in behind the same call).
class PlansSheet extends ConsumerStatefulWidget {
  const PlansSheet({super.key});

  @override
  ConsumerState<PlansSheet> createState() => _PlansSheetState();
}

class _PlansSheetState extends ConsumerState<PlansSheet> {
  String? _checkingOut;

  Future<void> _upgrade(PlanOption plan) async {
    setState(() => _checkingOut = plan.id);
    try {
      final note = await ref.read(studioProvider.notifier).checkout(plan.id);
      if (!mounted) return;
      showNebulaToast(context, 'Order created', icon: Icons.receipt_long_rounded);
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: AppColors.surfaceHigh,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
        builder: (_) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 22, 20, 30),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.receipt_long_rounded, size: 18, color: AppColors.textPrimary),
                  const SizedBox(width: 9),
                  Text('Order for ${plan.name}',
                      style: const TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w800, fontSize: 15, color: AppColors.textPrimary)),
                ],
              ),
              const SizedBox(height: 12),
              Text(note, style: const TextStyle(fontSize: 12.5, height: 1.55, color: AppColors.textSecondary)),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(context).pop(),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.background,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w800)),
                ),
              ),
            ],
          ),
        ),
      );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        showNebulaToast(context, '$e', icon: Icons.error_outline_rounded, color: AppColors.danger);
      }
    } finally {
      if (mounted) setState(() => _checkingOut = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(studioProvider);
    final b = state.billing;
    final catalog = b?.catalog ?? const <PlanOption>[];

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 14),
            const Text(
              'Plan & usage',
              style: TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w800, fontSize: 17, letterSpacing: -0.3, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 4),
            Text(
              b == null
                  ? 'Loading your plan…'
                  : b.expired
                      ? 'Your paid plan has ended — renew below to keep the full team.'
                      : '${b.planName} · ${b.buildsUsed}/${b.buildsLimit} builds this month',
              style: const TextStyle(fontSize: 12.5, color: AppColors.textTertiary),
            ),
            const SizedBox(height: 16),
            if (b != null) _usageBars(b),
            if (catalog.isNotEmpty) ...[
              const SizedBox(height: 16),
              ...catalog.map((p) => _planCard(p)),
            ],
            const SizedBox(height: 6),
            const Text(
              'Every plan runs the same 13-agent team. Limits protect the compute — upgrades unlock volume, connectors, domains and seats.',
              style: TextStyle(fontSize: 11, height: 1.5, color: AppColors.textTertiary),
            ),
          ],
        ),
      ),
    );
  }

  Widget _usageBars(BillingSnapshot b) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          _bar('Builds', b.buildsUsed, b.buildsLimit, b.low || b.expired),
          const SizedBox(height: 11),
          _bar('Refinements', b.refinesUsed, b.refinesLimit, false),
        ],
      ),
    );
  }

  Widget _bar(String label, int used, int limit, bool warn) {
    final pct = limit <= 0 ? 0.0 : (used / limit).clamp(0.0, 1.0);
    return Row(
      children: [
        SizedBox(
          width: 86,
          child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textSecondary)),
        ),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: pct,
              minHeight: 5,
              backgroundColor: AppColors.border,
              color: warn ? AppColors.danger : AppColors.primary,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          '$used/$limit',
          style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 10.5, color: AppColors.textTertiary),
        ),
      ],
    );
  }

  Widget _planCard(PlanOption p) {
    final busy = _checkingOut == p.id;
    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.current ? AppColors.textPrimary.withValues(alpha: 0.07) : AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: p.current ? AppColors.textPrimary.withValues(alpha: 0.5) : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  p.name,
                  style: const TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w800, fontSize: 14.5, color: AppColors.textPrimary),
                ),
              ),
              Text(
                p.priceInr == 0 ? 'Free' : '₹${p.priceInr}/mo',
                style: const TextStyle(fontFamily: 'JetBrains Mono', fontWeight: FontWeight.w700, fontSize: 12.5, color: AppColors.textPrimary),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(p.tagline, style: const TextStyle(fontSize: 11.5, color: AppColors.textTertiary)),
          const SizedBox(height: 9),
          ...p.perks.map(
            (perk) => Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  const Icon(Icons.check_rounded, size: 13, color: AppColors.success),
                  const SizedBox(width: 7),
                  Expanded(child: Text(perk, style: const TextStyle(fontSize: 11.5, height: 1.4, color: AppColors.textSecondary))),
                ],
              ),
            ),
          ),
          if (!p.current) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              height: 40,
              child: FilledButton(
                onPressed: busy ? null : () => _upgrade(p),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: AppColors.background,
                  disabledBackgroundColor: AppColors.primaryPressed,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
                ),
                child: busy
                    ? const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.background),
                      )
                    : Text(
                        p.priceInr == 0 ? 'Stay on Free' : 'Get ${p.name}',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                      ),
              ),
            ),
          ] else
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Align(
                alignment: Alignment.centerRight,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.textSecondary.withValues(alpha: 0.5)),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'CURRENT',
                    style: TextStyle(fontFamily: 'JetBrains Mono', fontSize: 9, fontWeight: FontWeight.w800, letterSpacing: 0.12, color: AppColors.textSecondary),
                  ),
                ),
              ),
            ),
        ],
      ),
    ).animate().fadeIn(duration: 200.ms);
  }
}

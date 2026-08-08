import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/firebase_boot.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../auth/models/app_user.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../models/commission.dart';
import '../../providers/commission_provider.dart';

/// Earnings for everyone; rates and payouts for admins.
class CommissionsScreen extends ConsumerWidget {
  const CommissionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(currentAppUserValueProvider);
    final isAdmin = me?.role.canManageTeam ?? false;

    return DefaultTabController(
      length: isAdmin ? 3 : 1,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Commissions'),
          bottom: isAdmin
              ? const TabBar(tabs: [
                  Tab(text: 'My earnings'),
                  Tab(text: 'Team'),
                  Tab(text: 'Rate'),
                ])
              : null,
        ),
        body: isAdmin
            ? const TabBarView(children: [
                _MyEarningsTab(),
                _TeamTab(),
                _RateTab(),
              ])
            : const _MyEarningsTab(),
      ),
    );
  }
}

Widget _statTile(BuildContext context, String label, String value, Color c) =>
    Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value,
                style: context.textTheme.titleMedium?.copyWith(color: c)),
            Text(label,
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textTertiary, fontSize: 11)),
          ],
        ),
      ),
    );

class _MyEarningsTab extends ConsumerWidget {
  const _MyEarningsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(teamCommissionsProvider);
    final mine = ref.watch(myCommissionsProvider);
    final settings = ref.watch(commissionSettingsProvider).valueOrNull ??
        const CommissionSettings();

    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => ErrorState(
        message: describeFirestoreError(e),
        onRetry: () => ref.invalidate(teamCommissionsProvider),
      ),
      data: (_) {
        final counted = mine.where((c) => c.status.counts).toList();
        final earned = counted.fold<double>(0, (a, c) => a + c.amount);
        final paid = counted
            .where((c) => c.status == CommissionStatus.paid)
            .fold<double>(0, (a, c) => a + c.amount);

        return ListView(
          padding: const EdgeInsets.all(12),
          children: [
            Row(children: [
              _statTile(context, 'Sales', '${counted.length}',
                  AppColors.primary),
              const SizedBox(width: 8),
              _statTile(context, 'Earned', Formatters.currency(earned),
                  AppColors.success),
              const SizedBox(width: 8),
              _statTile(context, 'Unpaid',
                  Formatters.currency(earned - paid), AppColors.warning),
            ]),
            const SizedBox(height: 10),
            Text(
              'You earn ${Formatters.currency(settings.payoutPerSale)} per '
              'subscription of ${Formatters.currency(settings.subscriptionPrice)}.',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 14),
            if (counted.isEmpty)
              const EmptyState(
                icon: Icons.payments_outlined,
                title: 'No sales yet',
                subtitle:
                    'Mark a lead as Converted when they subscribe and it '
                    'appears here.',
              )
            else
              ...mine.map((c) => _row(context, c)),
            const SizedBox(height: 30),
          ],
        );
      },
    );
  }

  Widget _row(BuildContext context, Commission c) => Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(c.contactName.isEmpty ? 'Subscription' : c.contactName,
                      style: context.textTheme.bodyMedium,
                      overflow: TextOverflow.ellipsis),
                  Text(
                    '${c.status.label}'
                    '${c.createdAt == null ? '' : ' · ${Formatters.date(c.createdAt!)}'}',
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textTertiary),
                  ),
                ],
              ),
            ),
            Text(Formatters.currency(c.amount),
                style: context.textTheme.bodyMedium?.copyWith(
                  color: c.status == CommissionStatus.paid
                      ? AppColors.success
                      : AppColors.textPrimary,
                )),
          ],
        ),
      );
}

class _TeamTab extends ConsumerWidget {
  const _TeamTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rows = ref.watch(earningsLeaderboardProvider);
    final commissions =
        ref.watch(teamCommissionsProvider).valueOrNull ?? const <Commission>[];

    final counted = commissions.where((c) => c.status.counts).toList();
    final revenue = counted.fold<double>(0, (a, c) => a + c.subscriptionPrice);
    final payout = counted.fold<double>(0, (a, c) => a + c.amount);
    final pending = counted
        .where((c) => c.status == CommissionStatus.pending)
        .fold<double>(0, (a, c) => a + c.amount);

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Row(children: [
          _statTile(context, 'Subscriptions', '${counted.length}',
              AppColors.primary),
          const SizedBox(width: 8),
          _statTile(context, 'Revenue', Formatters.currencyCompact(revenue),
              AppColors.success),
          const SizedBox(width: 8),
          _statTile(context, 'Payout', Formatters.currencyCompact(payout),
              AppColors.accent),
        ]),
        const SizedBox(height: 10),
        if (pending > 0)
          Text('${Formatters.currency(pending)} awaiting approval',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.warning)),
        const SizedBox(height: 14),
        const SectionHeader(
            title: 'Leaderboard', subtitle: 'Ranked by commission earned'),
        const SizedBox(height: 8),
        ...rows.where((r) => r.sales > 0).map((r) => Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: AppColors.surfaceElevated,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(r.name, style: context.textTheme.bodyMedium),
                        Text(
                          '${r.sales} sale${r.sales == 1 ? '' : 's'} · '
                          '${Formatters.currency(r.outstanding)} unpaid',
                          style: context.textTheme.bodySmall
                              ?.copyWith(color: AppColors.textTertiary),
                        ),
                      ],
                    ),
                  ),
                  Text(Formatters.currency(r.earned),
                      style: context.textTheme.bodyMedium
                          ?.copyWith(color: AppColors.success)),
                ],
              ),
            )),
        if (rows.every((r) => r.sales == 0))
          const EmptyState(
            icon: Icons.emoji_events_outlined,
            title: 'No sales recorded yet',
            subtitle: 'Conversions logged by the team appear here.',
          ),
        const SizedBox(height: 14),
        const SectionHeader(
            title: 'Recent', subtitle: 'Tap to approve or mark paid'),
        const SizedBox(height: 8),
        ...commissions.take(30).map((c) => ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text('${c.salesPersonName} · ${c.contactName}',
                  overflow: TextOverflow.ellipsis,
                  style: context.textTheme.bodyMedium),
              subtitle: Text(
                  '${Formatters.currency(c.amount)} · ${c.status.label}',
                  style: context.textTheme.bodySmall),
              trailing: PopupMenuButton<CommissionStatus>(
                icon: const Icon(Icons.more_vert, size: 18),
                onSelected: (s) async {
                  try {
                    await ref
                        .read(commissionServiceProvider)
                        .setStatus(c.id, s);
                    if (context.mounted) {
                      context.showSuccess('Marked ${s.label.toLowerCase()}');
                    }
                  } catch (e) {
                    if (context.mounted) {
                      context.showError(describeFirestoreError(e));
                    }
                  }
                },
                itemBuilder: (_) => CommissionStatus.values
                    .map((s) =>
                        PopupMenuItem(value: s, child: Text(s.label)))
                    .toList(),
              ),
            )),
        const SizedBox(height: 30),
      ],
    );
  }
}

class _RateTab extends ConsumerStatefulWidget {
  const _RateTab();

  @override
  ConsumerState<_RateTab> createState() => _RateTabState();
}

class _RateTabState extends ConsumerState<_RateTab> {
  final _price = TextEditingController();
  final _value = TextEditingController();
  bool _percent = false;
  bool _seeded = false;
  bool _saving = false;

  @override
  void dispose() {
    _price.dispose();
    _value.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;
    final price = double.tryParse(_price.text.trim());
    final value = double.tryParse(_value.text.trim());
    if (price == null || value == null) {
      context.showError('Enter numbers for both fields.');
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(commissionServiceProvider).saveSettings(
            me.teamId ?? '',
            CommissionSettings(
              subscriptionPrice: price,
              isPercentage: _percent,
              commissionValue: value,
            ),
            me.id,
          );
      ref.invalidate(commissionSettingsProvider);
      if (mounted) context.showSuccess('Commission rate updated');
    } catch (e) {
      if (mounted) context.showError(describeFirestoreError(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(commissionSettingsProvider).valueOrNull;
    if (settings == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (!_seeded) {
      _seeded = true;
      _price.text = settings.subscriptionPrice.toStringAsFixed(0);
      _value.text = settings.commissionValue.toStringAsFixed(0);
      _percent = settings.isPercentage;
    }

    final price = double.tryParse(_price.text) ?? 0;
    final value = double.tryParse(_value.text) ?? 0;
    final preview = _percent ? price * (value / 100) : value;

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Text(
          'Set what a subscription costs and what the closer earns. Changes '
          'apply to future sales only — commissions already earned keep the '
          'rate that was in force when the sale closed.',
          style: context.textTheme.bodySmall
              ?.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _price,
          keyboardType: TextInputType.number,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            isDense: true,
            labelText: 'Subscription price per month (₹)',
          ),
        ),
        const SizedBox(height: 12),
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, label: Text('Flat ₹')),
            ButtonSegment(value: true, label: Text('Percentage')),
          ],
          selected: {_percent},
          onSelectionChanged: (v) => setState(() => _percent = v.first),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _value,
          keyboardType: TextInputType.number,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            isDense: true,
            labelText:
                _percent ? 'Commission (% of price)' : 'Commission per sale (₹)',
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surfaceElevated,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              const Icon(Icons.payments, size: 18, color: AppColors.success),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Each sale pays ${Formatters.currency(preview)} '
                  'on ${Formatters.currency(price)}.',
                  style: context.textTheme.bodyMedium,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: Text(_saving ? 'Saving…' : 'Save rate'),
        ),
      ],
    );
  }
}

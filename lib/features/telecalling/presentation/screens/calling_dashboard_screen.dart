import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/firebase_boot.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../models/call_log.dart';
import '../../providers/telecalling_provider.dart';

/// Team calling performance for managers and admins.
class CallingDashboardScreen extends ConsumerWidget {
  const CallingDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(currentAppUserValueProvider);
    final allowed = me?.role.canManageCampaigns ?? false;

    if (!allowed) {
      return Scaffold(
        appBar: AppBar(title: const Text('Calling performance')),
        body: const EmptyState(
          icon: Icons.lock,
          title: 'Managers only',
          subtitle: 'You need manager access to see team performance.',
        ),
      );
    }

    final logsAsync = ref.watch(teamCallLogsProvider);
    final stats = ref.watch(callerStatsProvider);
    final perDay = ref.watch(callsPerDayProvider);
    final days = ref.watch(dashboardRangeDaysProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calling performance'),
        actions: [
          PopupMenuButton<int>(
            initialValue: days,
            onSelected: (v) =>
                ref.read(dashboardRangeDaysProvider.notifier).state = v,
            itemBuilder: (_) => const [
              PopupMenuItem(value: 7, child: Text('Last 7 days')),
              PopupMenuItem(value: 14, child: Text('Last 14 days')),
              PopupMenuItem(value: 30, child: Text('Last 30 days')),
            ],
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Center(
                child: Text('${days}d', style: context.textTheme.bodyMedium),
              ),
            ),
          ),
        ],
      ),
      body: logsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(
          message: describeFirestoreError(e),
          onRetry: () => ref.invalidate(teamCallLogsProvider),
        ),
        data: (_) {
          final totalCalls = stats.fold<int>(0, (a, s) => a + s.calls);
          final totalConnected =
              stats.fold<int>(0, (a, s) => a + s.connected);
          final totalConverted =
              stats.fold<int>(0, (a, s) => a + s.converted);
          final totalPending = stats.fold<int>(0, (a, s) => a + s.pending);

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  _kpi(context, 'Calls', '$totalCalls', AppColors.primary),
                  const SizedBox(width: 10),
                  _kpi(
                    context,
                    'Connect rate',
                    totalCalls == 0
                        ? '—'
                        : '${(totalConnected / totalCalls * 100).round()}%',
                    AppColors.info,
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  _kpi(context, 'Converted', '$totalConverted',
                      AppColors.success),
                  const SizedBox(width: 10),
                  _kpi(context, 'Still open', '$totalPending',
                      AppColors.warning),
                ],
              ),
              const SizedBox(height: 20),
              _chartCard(context, perDay, days),
              const SizedBox(height: 20),
              const SectionHeader(
                title: 'By telecaller',
                subtitle: 'Ranked by call volume',
              ),
              const SizedBox(height: 8),
              if (stats.every((s) => s.calls == 0 && s.assigned == 0))
                const EmptyState(
                  icon: Icons.bar_chart,
                  title: 'No activity yet',
                  subtitle: 'Stats appear once calls are logged.',
                )
              else
                ...stats.map((s) => _callerRow(context, s)),
              const SizedBox(height: 40),
            ],
          );
        },
      ),
    );
  }

  Widget _kpi(BuildContext context, String label, String value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value,
                style: context.textTheme.headlineSmall?.copyWith(color: color)),
            const SizedBox(height: 2),
            Text(label,
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textTertiary)),
          ],
        ),
      ),
    );
  }

  Widget _chartCard(BuildContext context, List<int> perDay, int days) {
    final double maxY = perDay.isEmpty
        ? 1.0
        : perDay.reduce((a, b) => a > b ? a : b).toDouble();
    final double axisMax = (maxY <= 0 ? 1.0 : maxY) * 1.2;

    return Container(
      height: 200,
      padding: const EdgeInsets.fromLTRB(8, 20, 16, 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: BarChart(
        BarChartData(
          maxY: axisMax,
          borderData: FlBorderData(show: false),
          gridData: const FlGridData(show: false),
          titlesData: FlTitlesData(
            leftTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            topTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 22,
                getTitlesWidget: (value, meta) {
                  final i = value.toInt();
                  // Only label the ends to avoid a cluttered axis.
                  if (i != 0 && i != perDay.length - 1) {
                    return const SizedBox.shrink();
                  }
                  return Text(
                    i == 0 ? '${days}d ago' : 'today',
                    style: const TextStyle(
                        color: AppColors.textTertiary, fontSize: 10),
                  );
                },
              ),
            ),
          ),
          barGroups: [
            for (var i = 0; i < perDay.length; i++)
              BarChartGroupData(
                x: i,
                barRods: [
                  BarChartRodData(
                    toY: perDay[i].toDouble(),
                    width: 10,
                    borderRadius: BorderRadius.circular(3),
                    color: AppColors.primary,
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _callerRow(BuildContext context, CallerStats s) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(s.callerName,
                    style: context.textTheme.titleSmall,
                    overflow: TextOverflow.ellipsis),
              ),
              Text('${s.calls} calls', style: context.textTheme.bodySmall),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _mini(context, 'Held', '${s.assigned}'),
              _mini(context, 'Open', '${s.pending}'),
              _mini(context, 'Connect',
                  s.calls == 0 ? '—' : '${(s.connectRate * 100).round()}%'),
              _mini(context, 'Won', '${s.converted}'),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: s.coverage,
              minHeight: 6,
              backgroundColor: AppColors.surfaceHigh,
              valueColor: AlwaysStoppedAnimation(
                s.coverage > 0.7
                    ? AppColors.success
                    : s.coverage > 0.3
                        ? AppColors.warning
                        : AppColors.danger,
              ),
            ),
          ),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '${(s.coverage * 100).round()}% of their leads worked',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textTertiary),
            ),
          ),
        ],
      ),
    );
  }

  Widget _mini(BuildContext context, String label, String value) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value, style: context.textTheme.bodyMedium),
            Text(label,
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textTertiary, fontSize: 10)),
          ],
        ),
      );
}

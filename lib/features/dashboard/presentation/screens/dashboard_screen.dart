import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../../core/widgets/gradient_card.dart';
import '../../../../core/widgets/kpi_card.dart';
import '../../../assistant/models/insight.dart';
import '../../../assistant/providers/assistant_provider.dart';
import '../../../auth/providers/auth_provider.dart' show currentAppUserValueProvider;
import '../../../contacts/providers/contact_provider.dart';
import '../../../pipeline/models/deal.dart';
import '../../../service/providers/ticket_provider.dart';
import '../../providers/dashboard_provider.dart';
import '../widgets/ai_insight_banner.dart';
import '../widgets/conversion_funnel.dart';
import '../widgets/recent_activity.dart';
import '../widgets/revenue_chart.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(dashboardDataProvider);
    final dealsByStage = ref.watch(dealsByStageProvider);
    final sla = ref.watch(slaCountsProvider);
    final insights = ref.watch(insightsProvider).valueOrNull ?? [];

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          _buildHeader(context, ref),
          SliverToBoxAdapter(
            child: dashboard.when(
              data: (data) => _DashboardBody(
                data: data,
                dealsByStage: dealsByStage,
                sla: sla,
                insights: insights,
              ),
              loading: () => const LoadingGrid(itemCount: 4),
              error: (e, _) => ErrorState(
                message: 'Failed to load dashboard: $e',
                onRetry: () => ref.invalidate(dashboardDataProvider),
              ),
            ),
          ),
        ],
      ),
    );
  }

  SliverAppBar _buildHeader(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentAppUserValueProvider);
    return SliverAppBar(
      expandedHeight: 120,
      pinned: true,
      flexibleSpace: FlexibleSpaceBar(
        titlePadding: const EdgeInsets.only(left: 20, bottom: 14),
        title: Text(
          'Good ${_greeting()},',
          style: context.textTheme.titleMedium,
        ),
        background: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.surface, AppColors.background],
            ),
          ),
        ),
      ),
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: 12),
          child: GestureDetector(
            onTap: () => context.push('/profile'),
            child: CircleAvatar(
              radius: 18,
              backgroundColor: AppColors.primary.withValues(alpha: 0.2),
              backgroundImage: user?.photoUrl != null
                  ? NetworkImage(user!.photoUrl!)
                  : null,
              child: user?.photoUrl == null
                  ? Text(
                      (user?.displayName ?? '?').initials,
                      style: context.textTheme.labelLarge
                          ?.copyWith(color: AppColors.primary),
                    )
                  : null,
            ),
          ),
        ),
      ],
    );
  }

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }
}

class _DashboardBody extends StatelessWidget {
  const _DashboardBody({
    required this.data,
    required this.dealsByStage,
    required this.sla,
    required this.insights,
  });

  final DashboardData data;
  final Map<String, List<Deal>> dealsByStage;
  final SlaCounts sla;
  final List<Insight> insights;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // AI Insight banner (top)
        if (insights.isNotEmpty)
          AiInsightBanner(insight: insights.first)
              .animate()
              .fadeIn(duration: 400.ms)
              .slideY(begin: -0.05),

        // KPI grid
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.1,
            children: [
              KpiCard(
                label: 'Open Pipeline',
                value: Formatters.currencyCompact(data.openPipelineValue),
                icon: PhosphorIconsRegular.kanban,
                delta: 12.4,
                accentColor: AppColors.primary,
              ),
              KpiCard(
                label: 'Weighted Forecast',
                value: Formatters.currencyCompact(data.weightedForecast),
                icon: PhosphorIconsRegular.trendUp,
                delta: 8.2,
                accentColor: AppColors.accent,
              ),
              KpiCard(
                label: 'Won This Month',
                value: Formatters.currencyCompact(data.wonThisMonth),
                icon: PhosphorIconsRegular.trophy,
                delta: 22.1,
                accentColor: AppColors.success,
              ),
              KpiCard(
                label: 'Win Rate',
                value: Formatters.percent(data.winRate, decimals: 1),
                icon: PhosphorIconsRegular.target,
                delta: -1.5,
                accentColor: AppColors.tertiary,
              ),
            ],
          ),
        ),

        // Revenue trend chart
        const SectionHeader(
          title: 'Revenue Trend',
          subtitle: 'Last 6 months',
          actionLabel: 'Details',
        ),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 20),
          child: RevenueChart(),
        ),
        const SizedBox(height: 24),

        // Conversion funnel
        const SectionHeader(title: 'Conversion Funnel'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: ConversionFunnel(dealsByStage: dealsByStage),
        ),
        const SizedBox(height: 24),

        // SLA status (service widget)
        const SectionHeader(title: 'Service SLA'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: _SlaCard(sla: sla),
        ),
        const SizedBox(height: 24),

        // Recent activity
        const SectionHeader(title: 'Recent Activity', actionLabel: 'See all'),
        const RecentActivity(),
        const SizedBox(height: 40),
      ],
    );
  }
}

class _SlaCard extends StatelessWidget {
  const _SlaCard({required this.sla});
  final SlaCounts sla;

  @override
  Widget build(BuildContext context) {
    return GradientCard(
      gradient: const LinearGradient(
        colors: [Color(0xFF1E2746), Color(0xFF161E36)],
      ),
      border: Border.all(color: AppColors.border, width: 0.5),
      child: Row(
        children: [
          _SlaStat(
            label: 'Within SLA',
            value: sla.within,
            color: AppColors.success,
          ),
          Container(width: 1, height: 40, color: AppColors.border),
          _SlaStat(
            label: 'At Risk',
            value: sla.atRisk,
            color: AppColors.warning,
          ),
          Container(width: 1, height: 40, color: AppColors.border),
          _SlaStat(
            label: 'Breached',
            value: sla.breached,
            color: AppColors.danger,
          ),
        ],
      ),
    );
  }
}

class _SlaStat extends StatelessWidget {
  const _SlaStat({
    required this.label,
    required this.value,
    required this.color,
  });
  final String label;
  final int value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value.toString(),
            style: AppTypography.numeric.copyWith(color: color),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: context.textTheme.labelSmall?.copyWith(
              color: AppColors.textSecondary,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

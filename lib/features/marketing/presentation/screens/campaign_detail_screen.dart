import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../models/campaign.dart';
import '../../providers/marketing_provider.dart';

class CampaignDetailScreen extends ConsumerWidget {
  const CampaignDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaign = ref.watch(campaignByIdProvider(id));
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: () => context.push('/campaigns/new?id=$id'),
          ),
        ],
      ),
      body: campaign.when(
        data: (c) {
          if (c == null) {
            return const EmptyState(
              icon: Icons.send,
              title: 'Campaign not found',
            );
          }
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(c.name, style: context.textTheme.headlineSmall),
              const SizedBox(height: 6),
              Text(
                '${c.channel.label} · ${c.status.toUpperCase()}',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 24),

              // ── Performance metrics ──────────────────────
              _MetricsGrid(campaign: c),

              const SizedBox(height: 24),

              // ── Audience ─────────────────────────────────
              const _SectionLabel('Audience'),
              Card(
                child: Column(
                  children: [
                    ListTile(
                      leading: const Icon(Icons.group),
                      title: Text('${c.audienceCount} recipients'),
                      subtitle: Text(
                          '${c.audienceSegmentIds.length} segment(s) selected'),
                    ),
                  ],
                ),
              ),

              // ── Schedule ─────────────────────────────────
              const SizedBox(height: 20),
              const _SectionLabel('Schedule'),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.calendar_today),
                  title: Text(c.scheduleType.titleCase()),
                  subtitle: Text(c.scheduledAt != null
                      ? c.scheduledAt.toString()
                      : 'Not scheduled'),
                ),
              ),

              // ── Content ──────────────────────────────────
              const SizedBox(height: 20),
              const _SectionLabel('Content'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Subject', style: context.textTheme.labelSmall),
                      const SizedBox(height: 4),
                      Text(c.subject ?? '—', style: context.textTheme.bodyMedium),
                      const SizedBox(height: 12),
                      Text('Preview text', style: context.textTheme.labelSmall),
                      const SizedBox(height: 4),
                      Text(c.previewText ?? '—',
                          style: context.textTheme.bodyMedium),
                      const SizedBox(height: 12),
                      Text('CTA', style: context.textTheme.labelSmall),
                      const SizedBox(height: 4),
                      if (c.ctaLabel != null)
                        Chip(label: Text(c.ctaLabel!)),
                    ],
                  ),
                ),
              ),

              // ── Drip sequence ────────────────────────────
              if (c.dripSequence.isNotEmpty) ...[
                const SizedBox(height: 20),
                const _SectionLabel('Drip Sequence'),
                Card(
                  child: Column(
                    children: [
                      for (var i = 0; i < c.dripSequence.length; i++) ...[
                        ListTile(
                          leading: CircleAvatar(
                            backgroundColor:
                                AppColors.primary.withValues(alpha: 0.2),
                            child: Text('${i + 1}',
                                style: context.textTheme.labelLarge
                                    ?.copyWith(color: AppColors.primary)),
                          ),
                          title: Text(c.dripSequence[i].subject),
                          subtitle: Text(
                              '+${c.dripSequence[i].delayHours}h after previous'),
                        ),
                        if (i < c.dripSequence.length - 1)
                          const Divider(height: 1, indent: 56),
                      ],
                    ],
                  ),
                ),
              ],

              const SizedBox(height: 40),
            ],
          );
        },
        loading: () => const Center(
            child: CircularProgressIndicator(strokeWidth: 2)),
        error: (e, _) => ErrorState(message: 'Failed to load: $e'),
      ),
    );
  }
}

class _MetricsGrid extends StatelessWidget {
  const _MetricsGrid({required this.campaign});
  final Campaign campaign;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 1.0,
      children: [
        _MetricTile(
          label: 'Sent',
          value: campaign.metrics.sent.toString(),
          color: AppColors.textPrimary,
        ),
        _MetricTile(
          label: 'Delivered',
          value: campaign.metrics.delivered.toString(),
          color: AppColors.success,
        ),
        _MetricTile(
          label: 'Not delivered',
          value: campaign.metrics.notDelivered.toString(),
          color: AppColors.danger,
        ),
        _MetricTile(
          label: 'Opens',
          value: campaign.metrics.opens.toString(),
          color: AppColors.info,
        ),
        _MetricTile(
          label: 'Clicks',
          value: campaign.metrics.clicks.toString(),
          color: AppColors.accent,
        ),
        _MetricTile(
          label: 'Unsubs',
          value: campaign.metrics.unsubscribes.toString(),
          color: AppColors.warning,
        ),
      ],
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({
    required this.label,
    required this.value,
    required this.color,
  });
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            value,
            style: context.textTheme.headlineSmall?.copyWith(color: color),
          ),
          Text(label, style: context.textTheme.labelSmall),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(text, style: context.textTheme.titleSmall),
    );
  }
}

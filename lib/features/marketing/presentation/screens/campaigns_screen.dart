import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/services/mailercloud_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../models/campaign.dart';
import '../../providers/marketing_provider.dart';

class CampaignsScreen extends ConsumerWidget {
  const CampaignsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campaigns = ref.watch(campaignsProvider);
    final mcCampaigns = ref.watch(mailerCloudCampaignsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Campaigns')),
      body: campaigns.when(
        data: (list) {
          if (list.isEmpty && mcCampaigns.valueOrNull?.isEmpty != false) {
            return const EmptyState(
              icon: Icons.send,
              title: 'No campaigns yet',
              subtitle: 'Launch your first email or SMS campaign.',
              actionLabel: 'New campaign',
            );
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 80),
            children: [
              // ── MailerCloud live campaigns ──
              ...?mcCampaigns.whenOrNull(
                data: (mcList) {
                  if (mcList.isEmpty) return null;
                  return [
                    Padding(
                      padding: const EdgeInsets.only(top: 8, bottom: 4),
                      child: Row(
                        children: [
                          Icon(Icons.cloud_done,
                              size: 16, color: AppColors.info),
                          const SizedBox(width: 6),
                          Text('MailerCloud Live',
                              style: context.textTheme.labelLarge),
                        ],
                      ),
                    ),
                    ...mcList.map((mc) => _MailerCloudCard(campaign: mc)),
                    const SizedBox(height: 12),
                  ];
                },
              ),
              // ── Firestore-stored campaigns ──
              ...list.asMap().entries.map((entry) {
                final c = entry.value;
                return _CampaignCard(campaign: c)
                    .animate()
                    .fadeIn(duration: 250.ms, delay: (entry.key * 40).ms);
              }),
            ],
          );
        },
        loading: () => const Center(
            child: CircularProgressIndicator(strokeWidth: 2)),
        error: (e, _) => ErrorState(message: 'Failed to load: $e'),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/campaigns/new'),
        icon: const Icon(Icons.add, size: 20),
        label: const Text('New Campaign'),
      ),
    );
  }
}

class _CampaignCard extends StatelessWidget {
  const _CampaignCard({required this.campaign});
  final Campaign campaign;

  @override
  Widget build(BuildContext context) {
    final color = _statusColor(campaign.status);
    return Card(
      child: InkWell(
        onTap: () => context.push('/campaigns/${campaign.id}'),
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      _channelIcon(campaign.channel),
                      color: color,
                      size: 18,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          campaign.name,
                          style: context.textTheme.titleSmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${campaign.channel.label} · ${campaign.audienceCount} recipients',
                          style: context.textTheme.labelSmall,
                        ),
                      ],
                    ),
                  ),
                  StatusBadge(
                    label: campaign.status.toUpperCase(),
                    color: color,
                    outlined: true,
                  ),
                ],
              ),
              if (campaign.metrics.sent > 0) ...[
                const SizedBox(height: 14),
                Row(
                  children: [
                    _Metric(
                      label: 'Sent',
                      value: Formatters.compact(campaign.metrics.sent),
                    ),
                    _Metric(
                      label: 'Open Rate',
                      value: Formatters.percent(campaign.openRate, decimals: 1),
                    ),
                    _Metric(
                      label: 'Click Rate',
                      value: Formatters.percent(campaign.clickRate, decimals: 1),
                    ),
                    _Metric(
                      label: 'Revenue',
                      value: Formatters.currencyCompact(campaign.metrics.revenue),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Color _statusColor(String s) {
    return switch (s) {
      'running' => AppColors.success,
      'scheduled' => AppColors.info,
      'paused' => AppColors.warning,
      'completed' => AppColors.textTertiary,
      _ => AppColors.textTertiary,
    };
  }

  IconData _channelIcon(CampaignChannel c) {
    return switch (c) {
      CampaignChannel.email => Icons.email,
      CampaignChannel.sms => Icons.chat_bubble,
      CampaignChannel.push => Icons.notifications,
      CampaignChannel.inApp => Icons.dashboard,
      CampaignChannel.whatsapp => Icons.chat,
    };
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: context.textTheme.titleSmall?.copyWith(
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: context.textTheme.labelSmall,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

/// Card showing a MailerCloud campaign with live send metrics.
///
/// Appears above the Firestore-stored campaigns on the campaigns screen,
/// labelled "MailerCloud Live" so users can distinguish real sends (via
/// MailerCloud) from campaign drafts stored in the CRM.
class _MailerCloudCard extends StatelessWidget {
  const _MailerCloudCard({required this.campaign});
  final MailerCloudCampaign campaign;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.info.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(Icons.mark_email_read,
                      color: AppColors.info, size: 18),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        campaign.name,
                        style: context.textTheme.titleSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        campaign.subject,
                        style: context.textTheme.labelSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                StatusBadge(
                  label: campaign.status.toUpperCase(),
                  color: AppColors.info,
                  outlined: true,
                ),
              ],
            ),
            if (campaign.sent > 0) ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  _Metric(
                    label: 'Sent',
                    value: Formatters.compact(campaign.sent),
                  ),
                  _Metric(
                    label: 'Open Rate',
                    value: Formatters.percent(campaign.openRate, decimals: 1),
                  ),
                  _Metric(
                    label: 'Click Rate',
                    value: Formatters.percent(campaign.clickRate, decimals: 1),
                  ),
                  _Metric(
                    label: 'Bounces',
                    value: Formatters.compact(campaign.bounces),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

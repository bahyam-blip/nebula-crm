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
              // ── Branded header: gradient accent bar above the name ──
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  gradient: AppColors.primaryGradient,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              const SizedBox(height: 12),
              Text(c.name, style: context.textTheme.headlineSmall),
              const SizedBox(height: 6),
              Row(
                children: [
                  Text(
                    c.channel.label,
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(width: 8),
                  _StatusPill(status: c.status),
                ],
              ),
              const SizedBox(height: 24),

              // ── Engagement dashboard: rates, funnel, live evidence ──
              _EngagementPanel(campaign: c),

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

/* ── Engagement panel ───────────────────────────────────────────── */

/// The owner's answer to "was this REALLY delivered — did anyone read it?":
/// rate KPIs, a delivery funnel, and live evidence of who opened/clicked.
class _EngagementPanel extends StatelessWidget {
  const _EngagementPanel({required this.campaign});
  final Campaign campaign;

  @override
  Widget build(BuildContext context) {
    final m = campaign.metrics;
    final deliveredBase = m.delivered > 0 ? m.delivered : m.sent;
    double pct(int n) =>
        deliveredBase > 0 ? (n / deliveredBase) * 100 : 0.0;
    final openRate = pct(m.opens);
    final clickRate = pct(m.clicks);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Engagement',
                    style: context.textTheme.titleSmall),
              ),
              if (m.hasEngagement)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                        color: AppColors.success.withValues(alpha: 0.4),
                        width: 0.6),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 5,
                        height: 5,
                        decoration: const BoxDecoration(
                            color: AppColors.success, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 5),
                      Text('Live opens tracked',
                          style: context.textTheme.labelSmall?.copyWith(
                              color: AppColors.success,
                              fontSize: 10,
                              fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),

          // ── Rate KPI tiles ──────────────────────────────────────
          Row(
            children: [
              Expanded(
                child: _RateTile(
                  label: 'Open rate',
                  pct: openRate,
                  caption: '${m.opens} unique opens',
                  colors: const [AppColors.primary, AppColors.accent],
                  icon: Icons.visibility_outlined,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _RateTile(
                  label: 'Click rate',
                  pct: clickRate,
                  caption: '${m.clicks} clicks',
                  colors: const [AppColors.tertiary, Color(0xFFFFB547)],
                  icon: Icons.touch_app_outlined,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // ── Funnel ──────────────────────────────────────────────
          _EngBar(
            label: 'Sent',
            count: m.sent,
            fraction: 1,
            color: AppColors.textSecondary,
          ),
          _EngBar(
            label: 'Delivered',
            count: m.delivered,
            fraction:
                m.sent > 0 ? (m.delivered / m.sent).clamp(0.0, 1.0) : 0,
            color: AppColors.success,
          ),
          _EngBar(
            label: 'Opened',
            count: m.opens,
            fraction: deliveredBase > 0
                ? (m.opens / deliveredBase).clamp(0.0, 1.0)
                : 0,
            color: AppColors.primary,
          ),
          _EngBar(
            label: 'Clicked',
            count: m.clicks,
            fraction: deliveredBase > 0
                ? (m.clicks / deliveredBase).clamp(0.0, 1.0)
                : 0,
            color: AppColors.accent,
          ),
          _EngBar(
            label: 'Not delivered',
            count: m.notDelivered,
            fraction:
                m.sent > 0 ? (m.notDelivered / m.sent).clamp(0.0, 1.0) : 0,
            color: AppColors.danger,
          ),
          _EngBar(
            label: 'Unsubs',
            count: m.unsubscribes,
            fraction: deliveredBase > 0
                ? (m.unsubscribes / deliveredBase).clamp(0.0, 1.0)
                : 0,
            color: AppColors.warning,
          ),

          // ── Live evidence: who opened / clicked last ────────────
          if (m.lastOpenEmail.isNotEmpty || m.lastClickEmail.isNotEmpty) ...[
            const SizedBox(height: 6),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border, width: 0.5),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (m.lastOpenEmail.isNotEmpty)
                    _EvidenceRow(
                      icon: Icons.mark_email_read_outlined,
                      color: AppColors.primary,
                      text:
                          'Last opened by ${m.lastOpenEmail} · ${_ago(m.lastOpenAt)}',
                    ),
                  if (m.lastClickEmail.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    _EvidenceRow(
                      icon: Icons.ads_click,
                      color: AppColors.accent,
                      text:
                          'Last clicked by ${m.lastClickEmail} · ${_ago(m.lastClickAt)}',
                    ),
                  ],
                ],
              ),
            ),
          ],

          // ── Engaged readers (newest first) ──────────────────────
          if (m.openedSample.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Recent openers',
                style: context.textTheme.labelSmall
                    ?.copyWith(color: AppColors.textTertiary)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: m.openedSample
                  .take(8)
                  .map((s) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 9, vertical: 5),
                        decoration: BoxDecoration(
                          color:
                              AppColors.primary.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                              color: AppColors.primary
                                  .withValues(alpha: 0.30),
                              width: 0.6),
                        ),
                        child: Text(s['email']!,
                            style: context.textTheme.labelSmall?.copyWith(
                                color: AppColors.textPrimary,
                                fontSize: 10.5)),
                      ))
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }

  /// Human "time ago" for an ISO timestamp — no intl dependency.
  static String _ago(String iso) {
    final t = DateTime.tryParse(iso);
    if (t == null) return 'just now';
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return 'just now';
    if (d.inMinutes < 60) return '${d.inMinutes} min ago';
    if (d.inHours < 24) return '${d.inHours}h ago';
    return '${d.inDays}d ago';
  }
}

class _RateTile extends StatelessWidget {
  const _RateTile({
    required this.label,
    required this.pct,
    required this.caption,
    required this.colors,
    required this.icon,
  });
  final String label;
  final double pct;
  final String caption;
  final List<Color> colors;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final gradient = LinearGradient(colors: colors);
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            colors.first.withValues(alpha: 0.14),
            colors.last.withValues(alpha: 0.05),
          ],
        ),
        borderRadius: BorderRadius.circular(14),
        border:
            Border.all(color: colors.first.withValues(alpha: 0.35), width: 0.8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: colors.first),
              const SizedBox(width: 5),
              Text(label,
                  style: context.textTheme.labelSmall
                      ?.copyWith(color: AppColors.textSecondary)),
            ],
          ),
          const SizedBox(height: 7),
          ShaderMask(
            shaderCallback: (bounds) => gradient.createShader(bounds),
            blendMode: BlendMode.srcIn,
            child: Text(
              '${pct.toStringAsFixed(1)}%',
              style: context.textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(height: 2),
          Text(caption,
              style: context.textTheme.labelSmall
                  ?.copyWith(color: AppColors.textTertiary, fontSize: 10)),
        ],
      ),
    );
  }
}

class _EngBar extends StatelessWidget {
  const _EngBar({
    required this.label,
    required this.count,
    required this.fraction,
    required this.color,
  });
  final String label;
  final int count;
  final double fraction;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final f = fraction.isNaN ? 0.0 : fraction;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          SizedBox(
            width: 88,
            child: Text(label,
                style: context.textTheme.labelSmall
                    ?.copyWith(color: AppColors.textSecondary)),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: Stack(
                children: [
                  Container(height: 8, color: AppColors.surfaceHigh),
                  FractionallySizedBox(
                    widthFactor: f,
                    child: Container(
                      height: 8,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: [
                          color.withValues(alpha: 0.55),
                          color,
                        ]),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 40,
            child: Text('$count',
                textAlign: TextAlign.right,
                style: context.textTheme.labelSmall?.copyWith(
                    color: color, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

class _EvidenceRow extends StatelessWidget {
  const _EvidenceRow({
    required this.icon,
    required this.color,
    required this.text,
  });
  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 7),
        Expanded(
          child: Text(text,
              style: context.textTheme.labelSmall
                  ?.copyWith(color: AppColors.textSecondary)),
        ),
      ],
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final s = status.toLowerCase();
    final color = s == 'sent' || s == 'done'
        ? AppColors.success
        : s == 'scheduled'
            ? AppColors.info
            : s == 'failed'
                ? AppColors.danger
                : AppColors.warning;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2.5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35), width: 0.6),
      ),
      child: Text(
        s.toUpperCase(),
        style: context.textTheme.labelSmall
            ?.copyWith(color: color, fontSize: 9.5, fontWeight: FontWeight.w700),
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

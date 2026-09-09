import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../models/studio_models.dart';
import '../../providers/studio_provider.dart';
import '../widgets/publish_sheet.dart';
import 'site_preview_screen.dart';

/// Nebula STUDIO — describe it, the agent builds it, it is LIVE instantly.
///
/// Clean, single-flow surface:
///   1. DESCRIBE — one field, plain language. Kind + look are one tap each.
///   2. WATCH    — the agent walks visible stages (brief → research →
///                 design → copy → build → host) while the Worker works.
///   3. PREVIEW  — the real site renders in-app with a shareable URL.
///   4. HOST     — GitHub / Vercel / Firebase / GoDaddy / Hostinger /
///                 Supabase, credentials vaulted server-side.
class StudioScreen extends ConsumerStatefulWidget {
  const StudioScreen({super.key});

  @override
  ConsumerState<StudioScreen> createState() => _StudioScreenState();
}

class _StudioScreenState extends ConsumerState<StudioScreen> {
  final _briefCtrl = TextEditingController();
  final _titleCtrl = TextEditingController();
  final _ctaCtrl = TextEditingController();

  String _kind = 'landing';
  String? _style;
  bool _moreOptions = false;

  static const _kinds = <(String, String, String)>[
    ('landing', '🚀', 'Landing'),
    ('promo', '🎉', 'Offer'),
    ('event', '📅', 'Event'),
    ('portfolio', '🎨', 'Portfolio'),
    ('webapp', '⚡', 'Web app'),
    ('report', '📊', 'Report'),
  ];

  static const _styles = <(String, Color, String)>[
    ('Aurora', Color(0xFF7C8CFF), 'Dark, premium, glowing accents'),
    ('Editorial', Color(0xFFC2492E), 'Light magazine look, serif headlines'),
    ('Minimal', Color(0xFF2454FF), 'White space, clean grid, quiet'),
    ('Festive', Color(0xFFFFB03A), 'Bold, celebratory, high energy'),
  ];

  static const _styleHints = <String, String>{
    'Aurora': 'Dark premium aurora look — glassy, glowing, high-end.',
    'Editorial': 'Clean editorial magazine look with serif headlines.',
    'Minimal': 'Clean, minimal, lots of whitespace.',
    'Festive': 'Make it look festive and energetic with a bold offer layout.',
  };

  static const _examples = [
    'A website for my coffee shop "Musafir" — menu, story, and a WhatsApp order button',
    'Diwali mega-sale offer page for my bakery — 40% off with a countdown',
    'Portfolio for a freelance photographer with an enquiry button',
    'A small tip-tracker web app my field team can use offline',
  ];

  @override
  void dispose() {
    _briefCtrl.dispose();
    _titleCtrl.dispose();
    _ctaCtrl.dispose();
    super.dispose();
  }

  void _openPreview(StudioSite site) {
    if (!mounted) return; // called after awaits in the build flow
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SitePreviewScreen(site: site, onHostTap: () => _openPublishSheet(site)),
      ),
    );
  }

  void _openPlatforms() {
    final notifier = ref.read(studioProvider.notifier);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => PublishSheet(
        site: null,
        onPublish: null,
        onConnect: (platform, credentials) => notifier.connectPlatform(
          connector: platform.connector,
          credentials: credentials,
          label: platform.name,
        ),
        onDisconnect: (platform) => notifier.disconnectPlatform(platform.connector),
        onPointDomain: (platform, domain, target, name) =>
            notifier.pointDomain(connector: platform.connector, domain: domain, target: target, name: name),
      ),
    );
  }

  void _openPublishSheet(StudioSite site) {
    final notifier = ref.read(studioProvider.notifier);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => PublishSheet(
        site: site,
        onPublish: (platform, repo, domain) => notifier.publishSite(
          artifactId: site.id,
          connector: platform.connector,
          repo: repo,
          domain: domain,
        ),
        onConnect: (platform, credentials) => notifier.connectPlatform(
          connector: platform.connector,
          credentials: credentials,
          label: platform.name,
        ),
        onDisconnect: (platform) => notifier.disconnectPlatform(platform.connector),
        onPointDomain: (platform, domain, target, name) =>
            notifier.pointDomain(connector: platform.connector, domain: domain, target: target, name: name),
      ),
    );
  }

  Future<void> _build() async {
    final brief = _briefCtrl.text.trim();
    if (brief.length < 12) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Describe it a little more — what is it, who is it for?')),
      );
      return;
    }
    final title = _titleCtrl.text.trim().isEmpty ? brief.split(RegExp(r'[.!?\n]')).first.trim() : _titleCtrl.text.trim();
    FocusScope.of(context).unfocus();
    await ref.read(studioProvider.notifier).buildSite(
          title: title,
          brief: brief,
          kind: _kind,
          style: _style != null ? _styleHints[_style] : null,
          ctaText: _ctaCtrl.text.trim().isNotEmpty ? _ctaCtrl.text.trim() : null,
          onDone: _openPreview,
        );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(studioProvider);
    final sites = state.sites.where((s) => !s.isNote).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: const Text('Studio', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 19)),
        actions: [
          IconButton(
            tooltip: 'Hosting & platforms',
            icon: const Icon(Icons.dns_outlined, size: 21),
            onPressed: _openPlatforms,
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () => ref.read(studioProvider.notifier).refresh(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
          children: [
            if (state.error != null) _errorBanner(state.error!),
            _composer(state),
            const SizedBox(height: 28),
            if (sites.isNotEmpty) ...[
              Row(
                children: [
                  const Text('Your sites', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  const SizedBox(width: 8),
                  Text('${sites.length}', style: TextStyle(color: AppColors.textTertiary, fontSize: 13, fontWeight: FontWeight.w600)),
                  const Spacer(),
                  if (state.loading)
                    const SizedBox(
                      width: 14, height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textTertiary),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              ...sites.map(_siteCard),
            ] else if (!state.building) ..._emptyState(),
          ],
        ),
      ),
    );
  }

  // ── Composer ────────────────────────────────────────────────────────

  Widget _composer(StudioState state) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          state.building ? 'Building…' : 'What are we building today?',
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 22, height: 1.2),
        ),
        const SizedBox(height: 6),
        Text(
          state.building
              ? 'The agent is on it — watch the steps below.'
              : 'Describe it in plain words. You get a real website on a public link.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.45),
        ),
        const SizedBox(height: 18),
        if (!state.building) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.border.withValues(alpha: 0.8)),
            ),
            child: TextField(
              controller: _briefCtrl,
              maxLines: 4,
              minLines: 3,
              maxLength: 1200,
              textInputAction: TextInputAction.newline,
              style: const TextStyle(fontSize: 15, height: 1.5),
              decoration: InputDecoration(
                hintText: 'e.g. ${_examples.first}',
                hintStyle: TextStyle(color: AppColors.textTertiary.withValues(alpha: 0.75), fontSize: 13.5, height: 1.5),
                hintMaxLines: 2,
                border: InputBorder.none,
                counterText: '',
              ),
            ),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _kinds.map((k) => _kindChip(k.$1, k.$2, k.$3)).toList(),
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 34,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _styles.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final s = _styles[i];
                final selected = _style == s.$1;
                return GestureDetector(
                  onTap: () => setState(() => _style = selected ? null : s.$1),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: selected ? s.$2.withValues(alpha: 0.18) : Colors.transparent,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: selected ? s.$2 : AppColors.border.withValues(alpha: 0.9)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(width: 10, height: 10, decoration: BoxDecoration(color: s.$2, shape: BoxShape.circle)),
                        const SizedBox(width: 7),
                        Text(
                          s.$1,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                            color: selected ? s.$2 : AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 6),
          Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: EdgeInsets.zero,
              initiallyExpanded: _moreOptions,
              onExpansionChanged: (v) => setState(() => _moreOptions = v),
              title: Text('More options', style: TextStyle(color: AppColors.textTertiary, fontSize: 13, fontWeight: FontWeight.w600)),
              children: [
                TextField(
                  controller: _titleCtrl,
                  style: const TextStyle(fontSize: 14),
                  decoration: _smallField('Page title (optional)'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _ctaCtrl,
                  style: const TextStyle(fontSize: 14),
                  decoration: _smallField('Button text, e.g. "Order on WhatsApp" (optional)'),
                ),
                const SizedBox(height: 4),
              ],
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              onPressed: _build,
              child: const Text('Create it', style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700)),
            ),
          ),
          const SizedBox(height: 12),
          Center(
            child: Text(
              'Your Business Profile (name, colors, offers) is applied automatically.',
              style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
            ),
          ),
        ] else
          _stagePanel(state),
      ],
    ).animate().fadeIn(duration: 220.ms);
  }

  Widget _stagePanel(StudioState state) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border.withValues(alpha: 0.8)),
      ),
      child: Column(
        children: [
          for (int i = 0; i < kBuildStages.length; i++) ...[
            _stageRow(i, state.stageIndex),
            if (i < kBuildStages.length - 1)
              Container(
                margin: const EdgeInsets.only(left: 13),
                width: 1.5,
                height: 16,
                color: i < state.stageIndex ? AppColors.success.withValues(alpha: 0.6) : AppColors.border.withValues(alpha: 0.7),
              ),
          ],
        ],
      ),
    ).animate().fadeIn(duration: 200.ms);
  }

  Widget _stageRow(int i, int active) {
    final done = i < active;
    final current = i == active;
    final color = done ? AppColors.success : current ? AppColors.primary : AppColors.textTertiary;
    return Row(
      children: [
        SizedBox(
          width: 27,
          height: 27,
          child: done
              ? Icon(Icons.check_circle, color: color, size: 24)
              : current
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2, color: AppColors.primary))
                  : Container(
                      width: 20, height: 20,
                      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: AppColors.border, width: 1.6)),
                    ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: AnimatedDefaultTextStyle(
            duration: const Duration(milliseconds: 200),
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: current ? FontWeight.w700 : FontWeight.w500,
              color: done || current ? AppColors.textPrimary : AppColors.textTertiary,
            ),
            child: Text('${kBuildStages[i].icon}  ${kBuildStages[i].label}'),
          ),
        ),
      ],
    );
  }

  Widget _kindChip(String value, String emoji, String label) {
    final selected = _kind == value;
    return GestureDetector(
      onTap: () => setState(() => _kind = value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary.withValues(alpha: 0.16) : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? AppColors.primary : AppColors.border.withValues(alpha: 0.9)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 13.5)),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? AppColors.primary : AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Sites list ──────────────────────────────────────────────────────

  Widget _siteCard(StudioSite site) {
    final dep = site.latestDeployment;
    final dateStr = _dateLabel(site.updatedAt ?? site.at);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border.withValues(alpha: 0.7)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _openPreview(site),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceHigh.withValues(alpha: 0.55),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Text(site.kindIcon, style: const TextStyle(fontSize: 21)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              site.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                            ),
                          ),
                          if (site.version > 1)
                            Container(
                              margin: const EdgeInsets.only(left: 6),
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppColors.primary.withValues(alpha: 0.14),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                'v${site.version}',
                                style: const TextStyle(color: AppColors.primary, fontSize: 10, fontWeight: FontWeight.w800),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${site.kindLabel} · $dateStr',
                        style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                      ),
                      const SizedBox(height: 7),
                      Row(
                        children: [
                          Icon(
                            dep != null && dep.url != null ? Icons.cloud_done_outlined : Icons.public,
                            size: 12,
                            color: dep != null && dep.url != null ? AppColors.success : AppColors.info,
                          ),
                          const SizedBox(width: 5),
                          Flexible(
                            child: Text(
                              dep?.url ?? site.url ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(color: AppColors.textTertiary, fontSize: 10.5),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                PopupMenuButton<String>(
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  color: AppColors.surfaceHigh,
                  icon: Icon(Icons.more_vert, size: 18, color: AppColors.textTertiary),
                  onSelected: (action) {
                    switch (action) {
                      case 'open':
                        _openPreview(site);
                        break;
                      case 'copy':
                        _copyToClipboard(dep?.url ?? site.url ?? '');
                        break;
                      case 'browser':
                        _launchExternal(dep?.url ?? site.url ?? '');
                        break;
                      case 'host':
                        _openPublishSheet(site);
                        break;
                    }
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'open', height: 40, child: Text('Preview', style: TextStyle(fontSize: 13.5))),
                    const PopupMenuItem(value: 'copy', height: 40, child: Text('Copy link', style: TextStyle(fontSize: 13.5))),
                    const PopupMenuItem(value: 'browser', height: 40, child: Text('Open in browser', style: TextStyle(fontSize: 13.5))),
                    const PopupMenuItem(value: 'host', height: 40, child: Text('Publish & domains', style: TextStyle(fontSize: 13.5))),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────

  List<Widget> _emptyState() {
    return [
      const SizedBox(height: 10),
      Column(
        children: [
          const Text('✨', style: TextStyle(fontSize: 36)),
          const SizedBox(height: 10),
          const Text(
            'Your sites will live here',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
          ),
          const SizedBox(height: 6),
          Text(
            'Every build gets a real public link — open it in the app or any browser, then publish it to GitHub, Vercel, Firebase or your own domain.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5, height: 1.55),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              for (final e in _examples.take(3))
                ActionChip(
                  label: Text(
                    e.length > 44 ? '${e.substring(0, 44)}…' : e,
                    style: const TextStyle(fontSize: 11),
                  ),
                  backgroundColor: AppColors.surface,
                  side: BorderSide(color: AppColors.border.withValues(alpha: 0.8)),
                  onPressed: () {
                    _briefCtrl.text = e;
                    setState(() {});
                  },
                ),
            ],
          ),
        ],
      ),
    ];
  }

  Widget _errorBanner(String message) => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.danger.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: AppColors.danger, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(message, style: const TextStyle(color: AppColors.danger, fontSize: 12.5, height: 1.4)),
            ),
          ],
        ),
      );

  // ── Helpers ─────────────────────────────────────────────────────────

  InputDecoration _smallField(String hint) => InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: AppColors.textTertiary, fontSize: 12.5),
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: BorderSide(color: AppColors.border.withValues(alpha: 0.8)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: BorderSide(color: AppColors.border.withValues(alpha: 0.8)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(color: AppColors.primary),
        ),
      );

  String _dateLabel(String iso) {
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '';
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inHours < 1) return '${diff.inMinutes}m ago';
    if (diff.inDays < 1) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return DateFormat('d MMM').format(dt);
  }

  Future<void> _copyToClipboard(String text) async {
    if (text.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Link copied'), backgroundColor: AppColors.success),
      );
    }
  }

  Future<void> _launchExternal(String url) async {
    if (url.isEmpty) return;
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No browser found on this device.')),
      );
    }
  }
}

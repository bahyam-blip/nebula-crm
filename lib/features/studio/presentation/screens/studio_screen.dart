import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../models/studio_models.dart';
import '../providers/studio_provider.dart';
import '../widgets/publish_sheet.dart';
import 'site_preview_screen.dart';

/// Nebula STUDIO — describe it, the agent builds it, it is LIVE instantly.
///
/// One surface for the full journey:
///   1. BUILD   — a brief in plain language becomes a complete branded site
///                or mini web app, hosted on the spot at a public URL.
///   2. PREVIEW — the real site renders in-app (WebView) with the URL one
///                tap away for any external browser.
///   3. HOST    — publish to GitHub Pages / Vercel / Firebase Hosting and
///                point GoDaddy/Hostinger domains, credentials vaulted
///                server-side (no API tokens anywhere in the app).
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

  static const _kinds = <(String, String, String)>[
    ('landing', '🚀', 'Landing page'),
    ('promo', '🎉', 'Offer page'),
    ('event', '📅', 'Event invite'),
    ('portfolio', '🎨', 'Portfolio'),
    ('webapp', '⚡', 'Mini web app'),
    ('report', '📊', 'Report page'),
  ];

  static const _styles = <(String, String)>[
    ('Dark premium', 'Use a dark premium, high-end look.'),
    ('Festive & bold', 'Make it look festive and energetic with a bold offer layout.'),
    ('Clean minimal', 'Clean, minimal, lots of whitespace.'),
    ('Playful colorful', 'Playful and colorful with big friendly shapes.'),
  ];

  static const _examples = [
    'A Diwali mega-sale offer page for my bakery — 40% off, urgency, WhatsApp CTA',
    'Portfolio for a freelance photographer with an enquiry button',
    'A small tip-tracker web app my field team can use offline',
    'Landing page for our new CRM consultation service with pricing tiers',
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
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
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
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
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
        const SnackBar(content: Text('Describe the site a little more — what is it for, who is it for?')),
      );
      return;
    }
    final title = _titleCtrl.text.trim().isEmpty ? brief.split(RegExp(r'[.!?\n]')).first.trim() : _titleCtrl.text.trim();
    FocusScope.of(context).unfocus();
    await ref.read(studioProvider.notifier).buildSite(
          title: title,
          brief: brief,
          kind: _kind,
          style: _style,
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
        title: const Text('Studio'),
        actions: [
          IconButton(
            tooltip: 'Hosting platforms',
            icon: const Icon(Icons.dns_outlined, size: 22),
            onPressed: _openPlatforms,
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () => ref.read(studioProvider.notifier).refresh(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            if (state.error != null) _errorBanner(state.error!),
            _buildCard(state),
            const SizedBox(height: 24),
            if (sites.isNotEmpty) ...[
              Row(
                children: [
                  Text(
                    'Your builds',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const Spacer(),
                  Text(
                    '${sites.length} live',
                    style: TextStyle(color: AppColors.textTertiary, fontSize: 12.5),
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

  // ── Build composer ──────────────────────────────────────────────

  Widget _buildCard(StudioState state) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.surface, AppColors.surfaceElevated],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border.withValues(alpha: 0.7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  gradient: AppColors.primaryGradient,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.auto_fix_high, color: Colors.white, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('What should we build?', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
                    Text(
                      'A complete site, live on a public URL in one step.',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _kinds
                .map((k) => _kindChip(k.$1, k.$2, k.$3))
                .toList(),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _briefCtrl,
            maxLines: 4,
            minLines: 3,
            maxLength: 1200,
            style: const TextStyle(fontSize: 14, height: 1.5),
            decoration: _decoration(
              'Describe it like you would to a designer…',
              hint: 'e.g. ${_examples.first}',
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _titleCtrl,
                  style: const TextStyle(fontSize: 13.5),
                  decoration: _decoration('Title (optional)'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _ctaCtrl,
                  style: const TextStyle(fontSize: 13.5),
                  decoration: _decoration('CTA button (optional)'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in _styles)
                ChoiceChip(
                  label: Text(s.$1, style: const TextStyle(fontSize: 12)),
                  selected: _style == s.$2,
                  onSelected: (_) => setState(() => _style = _style == s.$2 ? null : s.$2),
                  selectedColor: AppColors.primary.withValues(alpha: 0.25),
                  labelPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                  side: BorderSide(color: _style == s.$2 ? AppColors.primary : AppColors.border),
                  showCheckmark: false,
                ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              onPressed: state.building ? null : _build,
              icon: state.building
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.bolt, size: 19),
              label: Text(
                state.building ? (state.buildStage ?? 'Building…') : 'Build & host it now',
                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
              ),
            ),
          ),
          if (state.building) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                minHeight: 4,
                backgroundColor: AppColors.border.withValues(alpha: 0.4),
                color: AppColors.primary,
              ),
            ),
          ],
          const SizedBox(height: 12),
          Text(
            'Tip: your Business Profile (name, colors, offers) is applied automatically.',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 250.ms).slideY(begin: 0.03, end: 0);
  }

  Widget _kindChip(String value, String emoji, String label) {
    final selected = _kind == value;
    return GestureDetector(
      onTap: () => setState(() => _kind = value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary.withValues(alpha: 0.2) : AppColors.surface,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: selected ? AppColors.primary : AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 14)),
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

  // ── Sites list ──────────────────────────────────────────────────

  Widget _siteCard(StudioSite site) {
    final dep = site.latestDeployment;
    final dateStr = _dateLabel(site.at);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border.withValues(alpha: 0.6)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _openPreview(site),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceHigh,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Text(site.kindIcon, style: const TextStyle(fontSize: 22)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        site.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${site.kindLabel} · $dateStr',
                        style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          if (dep != null && dep.url != null)
                            _pill(
                              Icons.cloud_done_outlined,
                              dep.connector,
                              AppColors.success,
                            )
                          else
                            _pill(
                              Icons.public,
                              'nebula.url',
                              AppColors.info,
                            ),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              (dep?.url ?? site.url ?? '').replaceAll(RegExp(r'^https?://'), ''),
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
                const SizedBox(width: 8),
                Column(
                  children: [
                    _iconBtn(
                      Icons.copy_rounded,
                      'Copy link',
                      () => _copyToClipboard(dep?.url ?? site.url ?? ''),
                    ),
                    const SizedBox(height: 6),
                    _iconBtn(
                      Icons.open_in_new,
                      'Open in browser',
                      () => _launchExternal(dep?.url ?? site.url ?? ''),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _pill(IconData icon, String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 11, color: color),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      );

  Widget _iconBtn(IconData icon, String tooltip, VoidCallback onTap) => Tooltip(
        message: tooltip,
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surfaceHigh,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 16, color: AppColors.textSecondary),
          ),
        ),
      );

  // ── Empty state ─────────────────────────────────────────────────

  List<Widget> _emptyState() {
    return [
      const SizedBox(height: 8),
      Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.border.withValues(alpha: 0.5)),
        ),
        child: Column(
          children: [
            const Text('🪄', style: TextStyle(fontSize: 34)),
            const SizedBox(height: 10),
            const Text(
              'Your builds appear here',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
            ),
            const SizedBox(height: 6),
            Text(
              'Every site the agent builds is hosted instantly on a public link — preview it in-app, share it, then put it on GitHub, Vercel or your own domain.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5, height: 1.5),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.center,
              children: [
                for (final e in _examples.take(3))
                  ActionChip(
                    label: Text(
                      e.length > 42 ? '${e.substring(0, 42)}…' : e,
                      style: const TextStyle(fontSize: 11),
                    ),
                    backgroundColor: AppColors.surfaceHigh,
                    side: const BorderSide(color: AppColors.border),
                    onPressed: () {
                      _briefCtrl.text = e;
                      _titleCtrl.text = e.split(RegExp(r'[—,]')).first.trim();
                      setState(() {});
                    },
                  ),
              ],
            ),
          ],
        ),
      ),
    ];
  }

  Widget _errorBanner(String message) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.danger.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: AppColors.danger, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(message, style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
            ),
          ],
        ),
      );

  // ── Helpers ─────────────────────────────────────────────────────

  InputDecoration _decoration(String label, {String? hint}) => InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: AppColors.textTertiary, fontSize: 12.5),
        hintText: hint,
        hintMaxLines: 2,
        hintStyle: TextStyle(color: AppColors.textTertiary.withValues(alpha: 0.7), fontSize: 12),
        filled: true,
        fillColor: AppColors.background,
        counterText: '',
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(color: AppColors.border),
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

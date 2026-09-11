import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/nebula_ui.dart';
import '../../models/studio_models.dart';
import '../../providers/studio_provider.dart';
import '../widgets/publish_sheet.dart';
import 'site_preview_screen.dart';

/// Nebula STUDIO — 3.0 "MISSION CONTROL".
///
/// Rebuilt from scratch on the mono design law: true-black canvas,
/// hairline chrome, white-is-the-accent, zero emoji in chrome. The
/// composer is one tight surface; the build view is a live mission-
/// control feed of the REAL agent team (monogram tiles, mono durations,
/// timeline rail); the sites list is a dense, scannable ledger.
class StudioScreen extends ConsumerStatefulWidget {
  const StudioScreen({super.key});

  @override
  ConsumerState<StudioScreen> createState() => _StudioScreenState();
}

class _StudioScreenState extends ConsumerState<StudioScreen> {
  final _briefCtrl = TextEditingController();
  final _titleCtrl = TextEditingController();
  final _ctaCtrl = TextEditingController();
  final _briefFocus = FocusNode();

  String _kind = 'landing';
  String? _style;
  bool _options = false;

  static const _kinds = <(String, IconData, String)>[
    ('landing', Icons.rocket_launch_outlined, 'Landing'),
    ('promo', Icons.local_offer_outlined, 'Offer'),
    ('event', Icons.event_outlined, 'Event'),
    ('portfolio', Icons.palette_outlined, 'Portfolio'),
    ('webapp', Icons.bolt_outlined, 'Web app'),
    ('report', Icons.insert_chart_outlined, 'Report'),
  ];

  static const _styleHints = <String, String>{
    'Onyx': 'Deep black minimal — white type, hairlines, one restrained accent, editorial spacing.',
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
  void initState() {
    super.initState();
    _briefFocus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _briefCtrl.dispose();
    _titleCtrl.dispose();
    _ctaCtrl.dispose();
    _briefFocus.dispose();
    super.dispose();
  }

  void _openPreview(StudioSite site) {
    if (!mounted) return;
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
      backgroundColor: AppColors.surfaceHigh,
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
      backgroundColor: AppColors.surfaceHigh,
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
      showNebulaToast(context,
        'Describe it a little more — what is it, who is it for?',
        icon: Icons.info_outline_rounded, color: AppColors.warning);
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
      body: RefreshIndicator(
        color: AppColors.primary,
        backgroundColor: AppColors.surfaceHigh,
        onRefresh: () => ref.read(studioProvider.notifier).refresh(),
        child: ListView(
          padding: EdgeInsets.fromLTRB(0, MediaQuery.paddingOf(context).top + 2, 0, 44),
          children: [
            _header(),
            Container(height: 1, color: AppColors.border),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 0, 18, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 16),
                  if (state.error != null) ...[
                    _errorBanner(state.error!),
                    const SizedBox(height: 14),
                  ],
                  if (state.building)
                    MissionControl(state: state)
                  else ...[
                    _composer(),
                    const SizedBox(height: 26),
                    if (sites.isNotEmpty) ...[
                      _sitesHeader(sites.length, state.loading),
                      const SizedBox(height: 10),
                      ...sites.asMap().entries.map((e) => StaggerIn(
                            index: e.key,
                            child: _siteCard(e.value),
                          )),
                    ] else
                      ..._emptyState(),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Header ──────────────────────────────────────────────────────────

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 8, 12, 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const OverlineLabel('NEBULA STUDIO', color: AppColors.textTertiary),
                const SizedBox(height: 4),
                Text(
                  'Describe it. Watch it ship.',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    fontSize: 21,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.5,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
          _iconAction(icon: Icons.dns_outlined, label: 'Hosting', onTap: _openPlatforms),
        ],
      ),
    ).animate().fadeIn(duration: 240.ms);
  }

  Widget _iconAction({required IconData icon, required String label, required VoidCallback onTap}) {
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: AppColors.textSecondary),
            const SizedBox(width: 6),
            Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
          ],
        ),
      ),
    );
  }

  // ── Composer — one tight surface ────────────────────────────────────

  Widget _composer() {
    final focused = _briefFocus.hasFocus;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: focused ? AppColors.textPrimary.withValues(alpha: 0.5) : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _briefCtrl,
            focusNode: _briefFocus,
            maxLines: 4,
            minLines: 3,
            maxLength: 1200,
            textInputAction: TextInputAction.newline,
            style: const TextStyle(fontSize: 14.5, height: 1.5, color: AppColors.textPrimary),
            cursorColor: AppColors.primary,
            decoration: InputDecoration(
              hintText: 'What are we building? e.g. "${_examples.first}"',
              hintStyle: TextStyle(color: AppColors.textTertiary.withValues(alpha: 0.8), fontSize: 13, height: 1.5),
              hintMaxLines: 2,
              border: InputBorder.none,
              counterText: '',
              isDense: true,
              contentPadding: EdgeInsets.zero,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 34,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _kinds.length,
              separatorBuilder: (_, __) => const SizedBox(width: 7),
              itemBuilder: (_, i) {
                final k = _kinds[i];
                return NebulaChip(
                  label: k.$3,
                  icon: k.$2,
                  selected: _kind == k.$1,
                  onSelected: () => setState(() => _kind = k.$1),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 34,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _styleHints.keys.length,
              separatorBuilder: (_, __) => const SizedBox(width: 7),
              itemBuilder: (_, i) {
                final s = _styleHints.keys.elementAt(i);
                return NebulaChip(
                  label: s,
                  selected: _style == s,
                  onSelected: () => setState(() => _style = _style == s ? null : s),
                );
              },
            ),
          ),
          const SizedBox(height: 10),
          // Options — a flat disclosure, no box-in-box.
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => setState(() => _options = !_options),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  AnimatedRotation(
                    turns: _options ? 0.25 : 0,
                    duration: const Duration(milliseconds: 180),
                    child: const Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.textTertiary),
                  ),
                  const SizedBox(width: 4),
                  const Text('Title & button', style: TextStyle(color: AppColors.textTertiary, fontSize: 12.5, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 200),
            sizeCurve: Curves.easeOutCubic,
            crossFadeState: _options ? CrossFadeState.showSecond : CrossFadeState.showFirst,
            firstChild: const SizedBox(width: double.infinity),
            secondChild: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Column(
                children: [
                  TextField(
                    controller: _titleCtrl,
                    style: const TextStyle(fontSize: 13.5, color: AppColors.textPrimary),
                    decoration: _smallField('Page title (optional)'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _ctaCtrl,
                    style: const TextStyle(fontSize: 13.5, color: AppColors.textPrimary),
                    decoration: _smallField('Button text, e.g. "Order on WhatsApp"'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton(
              onPressed: _build,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.background,
                disabledBackgroundColor: AppColors.primaryPressed,
                disabledForegroundColor: AppColors.background,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
              ),
              child: const Text(
                'Build it live',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, letterSpacing: -0.2, fontFamily: 'Sora'),
              ),
            ),
          ),
          const SizedBox(height: 9),
          const Text(
            'A research-deep agent team designs, codes and hosts it — you get a real public link. Your site carries your brand, never ours.',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.45),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 220.ms);
  }

  // ── Mission control — the agents, live ──────────────────────────────

  Widget MissionControl({required StudioState state}) {
    final live = state.liveTrace;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(color: AppColors.success, shape: BoxShape.circle),
              ).animate(onPlay: (c) => c.repeat(reverse: true)).fadeOut(duration: 700.ms),
              const SizedBox(width: 8),
              const Text(
                'AGENT TEAM AT WORK',
                style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, letterSpacing: 0.16, color: AppColors.textSecondary),
              ),
              const Spacer(),
              if (live.isNotEmpty)
                Text(
                  '${live.length} steps',
                  style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 10.5, color: AppColors.textTertiary),
                ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Thirteen specialists — Lead (with a deep-think pass), Analyst, Researcher, Art Director, Copywriter, Copy Chief, Architect, Photographer, Engineers, QA, Builder, Reflector, Skill Researcher — research, design, code and host your page live. About a minute.',
            style: TextStyle(fontSize: 11.5, height: 1.5, color: AppColors.textTertiary),
          ),
          const SizedBox(height: 14),
          if (live.isEmpty)
            ..._rosterRows(state)
          else
            ..._liveRows(live),
        ],
      ),
    ).animate().fadeIn(duration: 200.ms);
  }

  /// Idle: the roster with a pacing engine — tight rows, no emoji chrome.
  List<Widget> _rosterRows(StudioState state) {
    final rows = <Widget>[];
    for (int i = 0; i < kBuildStages.length; i++) {
      final done = i < state.stageIndex;
      final current = i == state.stageIndex;
      rows.add(
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: [
              _statusDot(done: done, current: current),
              const SizedBox(width: 11),
              Expanded(
                child: AnimatedDefaultTextStyle(
                  duration: const Duration(milliseconds: 200),
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: current ? FontWeight.w700 : FontWeight.w500,
                    color: done || current ? AppColors.textPrimary : AppColors.textTertiary,
                  ),
                  child: Text(kBuildStages[i].label, maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
              ),
            ],
          ),
        ),
      );
    }
    return rows;
  }

  /// Live: the REAL team rows — monogram tile + action + mono duration.
  List<Widget> _liveRows(List<AgentRunRow> live) {
    final rows = <Widget>[];
    for (int i = 0; i < live.length; i++) {
      final row = live[i];
      final isLast = i == live.length - 1;
      rows.add(
        _liveRow(row, isLast: isLast)
            .animate()
            .fadeIn(duration: 240.ms)
            .slideY(begin: 0.3, end: 0, duration: 240.ms, curve: Curves.easeOutCubic),
      );
    }
    return rows;
  }

  Widget _monogram(String agent, {bool active = false}) {
    final initials = agent
        .split(RegExp(r'\s+'))
        .take(2)
        .map((w) => w.isNotEmpty ? w[0].toUpperCase() : '')
        .join();
    return Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: active ? AppColors.surfaceHigh : AppColors.surface,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: active ? AppColors.textSecondary : AppColors.border),
      ),
      child: Text(
        initials,
        style: TextStyle(
          fontFamily: 'JetBrains Mono',
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: active ? AppColors.textPrimary : AppColors.textSecondary,
        ),
      ),
    );
  }

  Widget _statusDot({required bool done, required bool current}) {
    if (done) {
      return const Icon(Icons.check_rounded, size: 15, color: AppColors.success);
    }
    if (current) {
      return const SizedBox(
        width: 13,
        height: 13,
        child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
      );
    }
    return Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: AppColors.textTertiary, width: 1.2)),
    );
  }

  Widget _liveRow(AgentRunRow row, {bool isLast = false}) {
    final secs = row.ms / 1000;
    final time = secs >= 10 ? '${secs.round()}s' : secs >= 1 ? '${secs.toStringAsFixed(1)}s' : '${row.ms}ms';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _monogram(row.agent, active: isLast),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        '${row.agent} · ${row.action}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      time,
                      style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 10, color: AppColors.textTertiary),
                    ),
                    const SizedBox(width: 6),
                    Icon(
                      row.ok ? Icons.check_rounded : Icons.priority_high_rounded,
                      size: 13,
                      color: row.ok ? AppColors.success : AppColors.danger,
                    ),
                  ],
                ),
                if (row.detail.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Text(
                      row.detail,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11, height: 1.35, color: AppColors.textTertiary),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Sites ledger ────────────────────────────────────────────────────

  Widget _sitesHeader(int count, bool loading) {
    return Row(
      children: [
        const Text('Your sites', style: TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.textPrimary)),
        const SizedBox(width: 8),
        Text('$count', style: const TextStyle(fontFamily: 'JetBrains Mono', color: AppColors.textTertiary, fontSize: 12, fontWeight: FontWeight.w600)),
        const Spacer(),
        if (loading)
          const SizedBox(
            width: 13, height: 13,
            child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textTertiary),
          ),
      ],
    );
  }

  Widget _siteCard(StudioSite site) {
    final dep = site.latestDeployment;
    final dateStr = _dateLabel(site.updatedAt ?? site.at);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(15),
          onTap: () => _openPreview(site),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Icon(site.kindGlyph, size: 18, color: AppColors.textSecondary),
                ),
                const SizedBox(width: 11),
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
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: AppColors.textPrimary),
                            ),
                          ),
                          if (site.version > 1)
                            Container(
                              margin: const EdgeInsets.only(left: 6),
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                              decoration: BoxDecoration(
                                border: Border.all(color: AppColors.border),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                'v${site.version}',
                                style: const TextStyle(fontFamily: 'JetBrains Mono', color: AppColors.textSecondary, fontSize: 9.5, fontWeight: FontWeight.w700),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${site.kindLabel} · $dateStr',
                        style: const TextStyle(color: AppColors.textTertiary, fontSize: 11),
                      ),
                      const SizedBox(height: 5),
                      Row(
                        children: [
                          Icon(
                            dep != null && dep.url != null ? Icons.cloud_done_outlined : Icons.public_outlined,
                            size: 11,
                            color: dep != null && dep.url != null ? AppColors.success : AppColors.textTertiary,
                          ),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              (dep?.url ?? site.url ?? '').replaceFirst(RegExp('^https?://'), ''),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontFamily: 'JetBrains Mono', color: AppColors.textTertiary, fontSize: 9.5),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 4),
                PopupMenuButton<String>(
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  color: AppColors.surfaceHigh,
                  icon: const Icon(Icons.more_horiz_rounded, size: 18, color: AppColors.textTertiary),
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
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'open', height: 40, child: Text('Preview', style: TextStyle(fontSize: 13.5))),
                    PopupMenuItem(value: 'copy', height: 40, child: Text('Copy link', style: TextStyle(fontSize: 13.5))),
                    PopupMenuItem(value: 'browser', height: 40, child: Text('Open in browser', style: TextStyle(fontSize: 13.5))),
                    PopupMenuItem(value: 'host', height: 40, child: Text('Publish & domains', style: TextStyle(fontSize: 13.5))),
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
      const SizedBox(height: 14),
      Column(
        children: [
          Container(
            width: 54,
            height: 54,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.border),
              color: AppColors.surface,
            ),
            child: const Icon(Icons.auto_awesome_outlined, color: AppColors.textSecondary, size: 22),
          ),
          const SizedBox(height: 13),
          const Text(
            'Your sites will live here',
            style: TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w700, fontSize: 14.5, color: AppColors.textPrimary),
          ),
          const SizedBox(height: 6),
          Text(
            'Every build gets a real public link — preview it in the app, share it anywhere, then publish it to GitHub, Vercel, Firebase or your own domain.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.55),
          ),
          const SizedBox(height: 15),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            alignment: WrapAlignment.center,
            children: [
              for (final e in _examples.take(3))
                PressableScale(
                  onTap: () {
                    _briefCtrl.text = e;
                    setState(() {});
                  },
                  pressedScale: 0.96,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Text(
                      e.length > 42 ? '${e.substring(0, 42)}…' : e,
                      style: const TextStyle(fontSize: 10.5, color: AppColors.textSecondary),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    ];
  }

  Widget _errorBanner(String message) => Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: AppColors.danger.withValues(alpha: 0.09),
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Icon(Icons.error_outline_rounded, color: AppColors.danger, size: 17),
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
        hintStyle: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: AppColors.border.withValues(alpha: 0.8)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: AppColors.border.withValues(alpha: 0.8)),
        ),
        focusedBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: AppColors.primary),
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
      showNebulaToast(context, 'Link copied', icon: Icons.link_rounded);
    }
  }

  Future<void> _launchExternal(String url) async {
    if (url.isEmpty) return;
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      showNebulaToast(context, 'No browser found on this device.',
          icon: Icons.info_outline_rounded, color: AppColors.warning);
    }
  }
}

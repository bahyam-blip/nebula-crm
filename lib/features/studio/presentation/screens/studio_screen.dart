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

/// Nebula STUDIO — describe it, the agent builds it, it is LIVE instantly.
///
/// 2.0 presentation: aurora atmosphere, glass composer, gradient CTA,
/// choreographed stage panel. All build/publish logic unchanged.
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
  bool _moreOptions = false;

  static const _kinds = <(String, String, String)>[
    ('landing', '🚀', 'Landing'),
    ('promo', '🎉', 'Offer'),
    ('event', '📅', 'Event'),
    ('portfolio', '🎨', 'Portfolio'),
    ('webapp', '⚡', 'Web app'),
    ('report', '📊', 'Report'),
  ];

  static const _styles = <(String, String)>[
    ('Onyx', 'Deep black, white type, razor-sharp minimal'),
    ('Aurora', 'Dark premium with glowing accents'),
    ('Editorial', 'Light magazine look, serif headlines'),
    ('Minimal', 'White space, clean grid, quiet'),
    ('Festive', 'Bold, celebratory, high energy'),
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
      backgroundColor: AppColors.surfaceHigh,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
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
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
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
      body: AuroraBackground(
        intensity: 1.3,
        child: RefreshIndicator(
          color: AppColors.primary,
          backgroundColor: AppColors.surfaceHigh,
          onRefresh: () => ref.read(studioProvider.notifier).refresh(),
          child: ListView(
            padding: EdgeInsets.fromLTRB(0, MediaQuery.paddingOf(context).top + 4, 0, 40),
            children: [
              _header(),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
                child: Column(
                  children: [
                    if (state.error != null) _errorBanner(state.error!),
                    _composer(state),
                    const SizedBox(height: 30),
                    if (sites.isNotEmpty) ...[
                      _sitesHeader(sites.length, state.loading),
                      const SizedBox(height: 14),
                      ...sites.asMap().entries.map((e) => StaggerIn(
                            index: e.key,
                            child: _siteCard(e.value),
                          )),
                    ] else if (!state.building) ..._emptyState(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Header ──────────────────────────────────────────────────────────

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 18),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                OverlineLabel('Nebula Studio', color: AppColors.textTertiary),
                const SizedBox(height: 5),
                const Text(
                  'Build & host',
                  style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.8,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
          _platformButton(),
        ],
      ),
    ).animate().fadeIn(duration: 260.ms);
  }

  Widget _platformButton() {
    return PressableScale(
      onTap: _openPlatforms,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.glassFillStrong,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.glassEdge),
        ),
        child: const Row(
          children: [
            Icon(Icons.dns_outlined, size: 17, color: AppColors.textSecondary),
            SizedBox(width: 7),
            Text(
              'Hosting',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
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
          state.building ? 'The agent is on it…' : 'What are we building today?',
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 21,
            height: 1.25,
            letterSpacing: -0.4,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          state.building
              ? 'Watch each step below — you will get a real, public website.'
              : 'Describe it in plain words. You get a real website on a public link.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.45),
        ),
        const SizedBox(height: 18),
        if (!state.building) ...[
          _briefField(),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _kinds
                .map((k) => NebulaChip(
                      label: k.$3,
                      selected: _kind == k.$1,
                      onSelected: () => setState(() => _kind = k.$1),
                    ))
                .toList(),
          ),
          const SizedBox(height: 14),
          _styleRow(),
          const SizedBox(height: 4),
          Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: EdgeInsets.zero,
              initiallyExpanded: _moreOptions,
              onExpansionChanged: (v) => setState(() => _moreOptions = v),
              iconColor: AppColors.textTertiary,
              collapsedIconColor: AppColors.textTertiary,
              title: const Text('More options', style: TextStyle(color: AppColors.textTertiary, fontSize: 13, fontWeight: FontWeight.w600)),
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
          NebulaButton(
            label: 'Create it',
            onPressed: _build,
            icon: Icons.auto_awesome_rounded,
            height: 54,
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

  Widget _briefField() {
    final focused = _briefFocus.hasFocus;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: focused
              ? AppColors.textPrimary.withValues(alpha: 0.55)
              : AppColors.border,
          width: 1,
        ),
      ),
      child: TextField(
        controller: _briefCtrl,
        focusNode: _briefFocus,
        maxLines: 4,
        minLines: 3,
        maxLength: 1200,
        textInputAction: TextInputAction.newline,
        style: const TextStyle(fontSize: 15, height: 1.5, color: AppColors.textPrimary),
        cursorColor: AppColors.primary,
        decoration: InputDecoration(
          hintText: 'e.g. ${_examples.first}',
          hintStyle: TextStyle(color: AppColors.textTertiary.withValues(alpha: 0.75), fontSize: 13.5, height: 1.5),
          hintMaxLines: 2,
          border: InputBorder.none,
          counterText: '',
        ),
      ),
    );
  }

  Widget _styleRow() {
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _styles.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final s = _styles[i];
          return NebulaChip(
            label: s.$1,
            selected: _style == s.$1,
            onSelected: () => setState(() => _style = _style == s.$1 ? null : s.$1),
          );
        },
      ),
    );
  }

  // ── Stage panel ─────────────────────────────────────────────────────

  Widget _stagePanel(StudioState state) {
    final live = state.liveTrace;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.glassEdge),
        boxShadow: AppColors.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            live.isEmpty ? 'AGENT TEAM ASSEMBLING · NO TEMPLATES' : 'LIVE FROM THE AGENT TEAM · NO TEMPLATES',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.14,
              color: AppColors.textTertiary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            live.isEmpty
                ? 'Nine specialists — Lead, Researcher, Art Director, Copywriter, Copy Chief, Architect, Engineers, QA — hand-build your page together. This takes about a minute.'
                : 'Streaming each agent as it works — this is the real team, not an animation. One moment more.',
            style: TextStyle(fontSize: 12, height: 1.45, color: AppColors.textTertiary),
          ),
          const SizedBox(height: 14),
          if (live.isEmpty)
            for (int i = 0; i < kBuildStages.length; i++) ...[
              _stageRow(i, state.stageIndex),
              if (i < kBuildStages.length - 1)
                Container(
                  margin: const EdgeInsets.only(left: 13),
                  width: 1.5,
                  height: 16,
                  color: i < state.stageIndex ? AppColors.success.withValues(alpha: 0.6) : AppColors.border.withValues(alpha: 0.7),
                ),
            ]
          else
            for (int i = 0; i < live.length; i++) ...[
              _liveRow(live[i], isLast: i == live.length - 1),
              if (i < live.length - 1)
                Container(
                  margin: const EdgeInsets.only(left: 13),
                  width: 1.5,
                  height: 14,
                  color: AppColors.success.withValues(alpha: 0.45),
                ),
            ],
        ],
      ),
    ).animate().fadeIn(duration: 200.ms);
  }

  /// One REAL row from the run doc: who did what, how long it took.
  Widget _liveRow(AgentRunRow row, {bool isLast = false}) {
    final color = row.ok ? AppColors.success : AppColors.danger;
    final secs = row.ms / 1000;
    final time = secs >= 1 ? '${secs.toStringAsFixed(1)}s' : '${row.ms}ms';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 27,
          height: 27,
          child: isLast && !row.ok
              ? SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.2,
                    color: AppColors.primary,
                    backgroundColor: AppColors.primary.withValues(alpha: 0.15),
                  ),
                )
              : Icon(row.ok ? Icons.check_circle_rounded : Icons.error_rounded, color: color, size: 24),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      '${row.emoji}  ${row.agent} · ${row.action}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    time,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textTertiary),
                  ),
                ],
              ),
              if (row.detail.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    row.detail,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11.5, height: 1.35, color: AppColors.textTertiary),
                  ),
                ),
            ],
          ),
        ),
      ],
    ).animate().fadeIn(duration: 220.ms).slideY(begin: 0.35, end: 0, duration: 220.ms, curve: Curves.easeOutCubic);
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
              ? Icon(Icons.check_circle_rounded, color: color, size: 24)
              : current
                  ? SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: AppColors.primary,
                        backgroundColor: AppColors.primary.withValues(alpha: 0.15),
                      ),
                    )
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

  // ── Sites list ──────────────────────────────────────────────────────

  Widget _sitesHeader(int count, bool loading) {
    return Row(
      children: [
        const Text('Your sites', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: AppColors.textPrimary)),
        const SizedBox(width: 8),
        Text('$count', style: const TextStyle(color: AppColors.textTertiary, fontSize: 13, fontWeight: FontWeight.w600)),
        const Spacer(),
        if (loading)
          const SizedBox(
            width: 14, height: 14,
            child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textTertiary),
          ),
      ],
    );
  }

  Widget _siteCard(StudioSite site) {
    final dep = site.latestDeployment;
    final dateStr = _dateLabel(site.updatedAt ?? site.at);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.glassEdge),
        boxShadow: AppColors.cardShadow,
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
                    color: AppColors.surfaceHigh,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(site.kindIcon, style: const TextStyle(fontSize: 20)),
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
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: AppColors.textPrimary),
                            ),
                          ),
                          if (site.version > 1)
                            Container(
                              margin: const EdgeInsets.only(left: 6),
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(
                                border: Border.all(color: AppColors.border),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                'v${site.version}',
                                style: const TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w700),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${site.kindLabel} · $dateStr',
                        style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                      ),
                      const SizedBox(height: 7),
                      Row(
                        children: [
                          Icon(
                            dep != null && dep.url != null ? Icons.cloud_done_outlined : Icons.public_outlined,
                            size: 12,
                            color: dep != null && dep.url != null ? AppColors.success : AppColors.textTertiary,
                          ),
                          const SizedBox(width: 5),
                          Flexible(
                            child: Text(
                              dep?.url ?? site.url ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: AppColors.textTertiary, fontSize: 10.5),
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
                  icon: const Icon(Icons.more_vert_rounded, size: 18, color: AppColors.textTertiary),
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
      const SizedBox(height: 10),
      Column(
        children: [
          Container(
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.glassEdge, width: 1),
            ),
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: const BoxDecoration(
                color: AppColors.surfaceHigh,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.auto_awesome_outlined,
                  color: AppColors.textSecondary, size: 24),
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            'Your sites will live here',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.textPrimary),
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
                PressableScale(
                  onTap: () {
                    _briefCtrl.text = e;
                    setState(() {});
                  },
                  pressedScale: 0.96,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.glassFill,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: AppColors.glassEdge),
                    ),
                    child: Text(
                      e.length > 44 ? '${e.substring(0, 44)}…' : e,
                      style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
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
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.danger.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Icon(Icons.error_outline_rounded, color: AppColors.danger, size: 18),
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
        hintStyle: const TextStyle(color: AppColors.textTertiary, fontSize: 12.5),
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
        focusedBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(13)),
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

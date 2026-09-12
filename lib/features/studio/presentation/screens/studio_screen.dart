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
import '../widgets/plans_sheet.dart';
import '../widgets/publish_sheet.dart';
import 'site_preview_screen.dart';

/// Nebula STUDIO — 4.0 "COMMAND".
///
/// Rebuilt from scratch (the owner rejected every previous layout): one
/// command bar carrying the plan's quota chip, then a three-tab workspace
/// — CREATE (the canvas), SITES (the ledger) and TEAM (the agents, live).
/// The mono design law holds: true-black canvas, hairline chrome,
/// white-is-the-accent, zero emoji in chrome.
class StudioScreen extends ConsumerStatefulWidget {
  const StudioScreen({super.key});

  @override
  ConsumerState<StudioScreen> createState() => _StudioScreenState();
}

class _StudioScreenState extends ConsumerState<StudioScreen> {
  final _briefCtrl = TextEditingController();
  final _titleCtrl = TextEditingController();
  final _ctaCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();
  final _briefFocus = FocusNode();

  String _kind = 'landing';
  String? _style;
  bool _options = false;
  String _tab = 'create'; // create | sites | team
  String _filter = 'all';
  String _query = '';

  /// v13: trace-row indexes whose code shell is expanded.
  final _expandedCode = <int>{};

  static const _kinds = <(String, IconData, String, String)>[
    ('landing', Icons.rocket_launch_outlined, 'Landing', 'Turns visitors into customers'),
    ('promo', Icons.local_offer_outlined, 'Offer', 'A deal page with urgency'),
    ('event', Icons.event_outlined, 'Event', 'Agenda, speakers, sign-ups'),
    ('portfolio', Icons.palette_outlined, 'Portfolio', 'Your work, told as a story'),
    ('webapp', Icons.bolt_outlined, 'Web app', 'A small offline tool'),
    ('report', Icons.insert_chart_outlined, 'Report', 'Findings, numbers, sources'),
  ];

  /// Each style swatch carries its actual palette so the picker TEACHES
  /// the look before the build — three dots, real colors. $3 is the FULL
  /// hint sentence sent to the Worker (its theme matcher keys on words
  /// like "deep black" / "glassy" / "magazine" — not the short label).
  static const _styles = <(String, List<Color>, String)>[
    ('Onyx', [Color(0xFF050505), Color(0xFF161616), Color(0xFFF2F2F2)], 'Deep black minimal — white type, hairlines, one restrained accent, editorial spacing.'),
    ('Aurora', [Color(0xFF07080F), Color(0xFF1C2436), Color(0xFF7DD3FC)], 'Dark premium aurora look — glassy, glowing, high-end.'),
    ('Editorial', [Color(0xFFFAF7F2), Color(0xFF14100C), Color(0xFFB4530A)], 'Clean editorial magazine look with serif headlines.'),
    ('Minimal', [Color(0xFFFFFFFF), Color(0xFFF0F0F0), Color(0xFF111111)], 'Clean, minimal, lots of whitespace.'),
    ('Festive', [Color(0xFF2A0A12), Color(0xFFE11D48), Color(0xFFF59E0B)], 'Make it look festive and energetic with a bold offer layout.'),
  ];

  static const _examples = [
    'A website for my coffee shop "Musafir" — menu, story, and a WhatsApp order button',
    'Diwali mega-sale offer page for my bakery — 40% off with a countdown',
    'Portfolio for a freelance photographer with an enquiry button',
    'A small tip-tracker web app my field team can use offline',
  ];

  /// The roster the Team tab renders — mirrors the REAL server-side team
  /// (emailer/agents.js) name for name.
  static const _roster = <(String, String)>[
    ('Lead', 'Plans the run, deep-thinks it, revises it'),
    ('Analyst', 'Builds the project understanding'),
    ('Researcher', 'Studies your market on the live web'),
    ('Art Director', 'Design system, palette, UX flow'),
    ('Copywriter', 'Writes every word on the page'),
    ('Copy Chief', 'Reviews and tightens every line'),
    ('Architect', 'Journey-maps the sections'),
    ('Photographer', 'Sources and verifies real imagery'),
    ('Engineer', 'Hand-codes each section'),
    ('QA Director', 'Reviews code, forces rework'),
    ('Builder', 'Wires, hosts, enforces identity'),
    ('Reflector', 'Turns the build into a lesson'),
    ('Skill Researcher', 'Researches the craft, grows skills'),
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
    _searchCtrl.dispose();
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
        onGithubRepos: () => notifier.listGithubRepos(),
        onGithubTrigger: (repo, workflow) => notifier.triggerWorkflow(repo: repo, workflow: workflow),
        onGithubRuns: (repo) => notifier.workflowRuns(repo),
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
        onGithubRepos: () => notifier.listGithubRepos(),
        onGithubPush: (artifactId, repo, isPrivate, workflows, domain) => notifier.pushToGithub(
          artifactId: artifactId,
          repo: repo,
          isPrivate: isPrivate,
          workflows: workflows,
          domain: domain,
          title: site.title,
        ),
        onGithubTrigger: (repo, workflow) => notifier.triggerWorkflow(repo: repo, workflow: workflow),
        onGithubRuns: (repo) => notifier.workflowRuns(repo),
      ),
    );
  }

  void _openPlans() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surfaceHigh,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => const PlansSheet(),
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
    setState(() => _tab = 'team'); // the build IS the team's show
    final styleHint = _style == null
        ? null
        : _styles.firstWhere((s) => s.$1 == _style, orElse: () => _styles.first).$3;
    await ref.read(studioProvider.notifier).buildSite(
          title: title,
          brief: brief,
          kind: _kind,
          style: styleHint,
          ctaText: _ctaCtrl.text.trim().isNotEmpty ? _ctaCtrl.text.trim() : null,
          onDone: _openPreview,
        );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(studioProvider);
    final building = state.building;
    final effectiveTab = building ? 'team' : _tab;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          _commandBar(state),
          _segmented(effectiveTab, building),
          Expanded(
            child: RefreshIndicator(
              color: AppColors.primary,
              backgroundColor: AppColors.surfaceHigh,
              onRefresh: () => ref.read(studioProvider.notifier).refresh(),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 44),
                children: [
                  if (state.error != null) ...[
                    _errorBanner(state.error!),
                    const SizedBox(height: 14),
                  ],
                  if (effectiveTab == 'create') ..._createTab(state),
                  if (effectiveTab == 'sites') ..._sitesTab(state, state.sites.where((s) => !s.isNote).toList()),
                  if (effectiveTab == 'team') ..._teamTab(state),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Command bar ─────────────────────────────────────────────────────

  Widget _commandBar(StudioState state) {
    final b = state.billing;
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.background,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 6, 12, 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const OverlineLabel('NEBULA STUDIO', color: AppColors.textTertiary),
                const SizedBox(height: 3),
                Text(
                  state.building ? 'The team is building…' : 'Describe it. Watch it ship.',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'Sora',
                    fontSize: 19,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.5,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
          _quotaChip(b),
          const SizedBox(width: 8),
          _iconAction(icon: Icons.dns_outlined, onTap: _openPlatforms),
        ],
      ),
    ).animate().fadeIn(duration: 240.ms);
  }

  Widget _quotaChip(BillingSnapshot? b) {
    final expired = b?.expired ?? false;
    final label = b == null
        ? null
        : expired
            ? 'Plan ended'
            : '${b.buildsLeft} left · ${b.planName}';
    return PressableScale(
      onTap: _openPlans,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: expired ? AppColors.danger.withValues(alpha: 0.5) : AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (b != null) ...[
              SizedBox(
                width: 15,
                height: 15,
                child: CircularProgressIndicator(
                  value: b.buildPct == 0 ? 0 : (1 - b.buildPct),
                  strokeWidth: 2.2,
                  strokeCap: StrokeCap.round,
                  color: expired || b.low ? AppColors.danger : AppColors.primary,
                  backgroundColor: AppColors.border,
                ),
              ),
              const SizedBox(width: 7),
            ] else ...[
              const SizedBox(
                width: 11, height: 11,
                child: CircularProgressIndicator(strokeWidth: 1.6, color: AppColors.textTertiary),
              ),
              const SizedBox(width: 7),
            ],
            Text(
              label ?? 'Plan…',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
            ),
          ],
        ),
      ),
    );
  }

  Widget _iconAction({required IconData icon, required VoidCallback onTap}) {
    return PressableScale(
      onTap: onTap,
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: AppColors.border),
        ),
        child: Icon(icon, size: 17, color: AppColors.textSecondary),
      ),
    );
  }

  // ── Segmented control ───────────────────────────────────────────────

  Widget _segmented(String active, bool building) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
      child: Container(
        height: 40,
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            _segment('Create', Icons.edit_square, active == 'create', !building, () => setState(() => _tab = 'create')),
            const SizedBox(width: 3),
            _segment('Sites', Icons.layers_outlined, active == 'sites', !building, () => setState(() => _tab = 'sites')),
            const SizedBox(width: 3),
            _segment('Team', Icons.groups_2_outlined, active == 'team', true, () => setState(() => _tab = 'team')),
          ],
        ),
      ),
    );
  }

  Widget _segment(String label, IconData icon, bool active, bool enabled, VoidCallback onTap) {
    return Expanded(
      child: GestureDetector(
        onTap: enabled ? onTap : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutCubic,
          decoration: BoxDecoration(
            color: active ? AppColors.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(9.5),
          ),
          alignment: Alignment.center,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 15, color: active ? AppColors.background : AppColors.textTertiary),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                  color: active ? AppColors.background : AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── CREATE tab — the canvas ─────────────────────────────────────────

  List<Widget> _createTab(StudioState state) {
    final focused = _briefFocus.hasFocus;
    return [
      const SizedBox(height: 6),
      // Kind grid — 3 × 2 tiles, each teaching what it builds.
      GridView.count(
        crossAxisCount: 3,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 1.06,
        padding: EdgeInsets.zero,
        children: [
          for (final k in _kinds) _kindTile(k),
        ],
      ),
      const SizedBox(height: 14),
      // The brief — the hero element of the whole tab.
      Container(
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
              maxLines: 5,
              minLines: 4,
              maxLength: 1200,
              textInputAction: TextInputAction.newline,
              style: const TextStyle(fontSize: 14.5, height: 1.55, color: AppColors.textPrimary),
              cursorColor: AppColors.primary,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'What are we building? Say the name, what it is, who it is for, and the one action that matters…',
                hintStyle: TextStyle(color: AppColors.textTertiary.withValues(alpha: 0.85), fontSize: 13, height: 1.5),
                hintMaxLines: 3,
                border: InputBorder.none,
                counterText: '',
                isDense: true,
                contentPadding: EdgeInsets.zero,
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(
                      value: (_briefCtrl.text.length / 1200).clamp(0.0, 1.0),
                      minHeight: 2.5,
                      backgroundColor: AppColors.border,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '${_briefCtrl.text.length}',
                  style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 10, color: AppColors.textTertiary),
                ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 38,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _styles.length,
                separatorBuilder: (_, __) => const SizedBox(width: 7),
                itemBuilder: (_, i) {
                  final s = _styles[i];
                  final selected = _style == s.$1;
                  return PressableScale(
                    onTap: () => setState(() => _style = _style == s.$1 ? null : s.$1),
                    pressedScale: 0.96,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 160),
                      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
                      decoration: BoxDecoration(
                        color: selected ? AppColors.textPrimary.withValues(alpha: 0.1) : AppColors.surface,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: selected ? AppColors.textPrimary.withValues(alpha: 0.6) : AppColors.border),
                      ),
                      child: Row(
                        children: [
                          ...s.$2.map((c) => Container(
                                width: 10,
                                height: 10,
                                margin: const EdgeInsets.only(right: 3),
                                decoration: BoxDecoration(color: c, shape: BoxShape.circle, border: Border.all(color: AppColors.border, width: 0.8)),
                              )),
                          const SizedBox(width: 5),
                          Text(
                            s.$1,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: selected ? AppColors.textPrimary : AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 10),
      // Advanced — flat disclosure.
      InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => setState(() => _options = !_options),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(
            children: [
              AnimatedRotation(
                turns: _options ? 0.25 : 0,
                duration: const Duration(milliseconds: 180),
                child: const Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.textTertiary),
              ),
              const SizedBox(width: 4),
              const Text('Page title & button', style: TextStyle(color: AppColors.textTertiary, fontSize: 12.5, fontWeight: FontWeight.w600)),
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
                decoration: _smallField('Page title (optional — the brief names it)'),
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
      const SizedBox(height: 14),
      SizedBox(
        width: double.infinity,
        height: 52,
        child: FilledButton(
          onPressed: state.building ? null : _build,
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: AppColors.background,
            disabledBackgroundColor: AppColors.primaryPressed,
            disabledForegroundColor: AppColors.background,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          child: const Text(
            'Build it live',
            style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800, letterSpacing: -0.2, fontFamily: 'Sora'),
          ),
        ),
      ).animate(onPlay: (c) => c.repeat(reverse: true)).shimmer(
            duration: 2600.ms,
            color: AppColors.textPrimary.withValues(alpha: 0.08),
          ),
      const SizedBox(height: 10),
      const Text(
        'Thirteen specialists research, design, code and host it — you get a real public link. Your site carries your brand, never ours.',
        style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5, height: 1.45),
      ),
      const SizedBox(height: 16),
      const OverlineLabel('OR START FROM', color: AppColors.textTertiary),
      const SizedBox(height: 8),
      ..._examples.map(_exampleCard),
    ];
  }

  Widget _kindTile((String, IconData, String, String) k) {
    final selected = _kind == k.$1;
    return PressableScale(
      onTap: () => setState(() => _kind = k.$1),
      pressedScale: 0.97,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? AppColors.textPrimary.withValues(alpha: 0.09) : AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: selected ? AppColors.textPrimary.withValues(alpha: 0.65) : AppColors.border),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(k.$2, size: 19, color: selected ? AppColors.textPrimary : AppColors.textSecondary),
            const SizedBox(height: 6),
            Text(
              k.$3,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w800,
                color: selected ? AppColors.textPrimary : AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              k.$4,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 8.8, height: 1.25, color: AppColors.textTertiary),
            ),
          ],
        ),
      ),
    );
  }

  Widget _exampleCard(String e) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: PressableScale(
        onTap: () {
          _briefCtrl.text = e;
          setState(() {});
        },
        pressedScale: 0.985,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              const Icon(Icons.auto_awesome_outlined, size: 13, color: AppColors.textTertiary),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  e,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
              ),
              const Icon(Icons.arrow_upward_rounded, size: 13, color: AppColors.textTertiary),
            ],
          ),
        ),
      ),
    );
  }

  // ── SITES tab — the ledger ──────────────────────────────────────────

  List<Widget> _sitesTab(StudioState state, List<StudioSite> sites) {
    final filtered = sites.where((s) {
      if (_filter != 'all' && s.kind != _filter) return false;
      if (_query.isNotEmpty && !s.title.toLowerCase().contains(_query.toLowerCase())) return false;
      return true;
    }).toList();

    return [
      const SizedBox(height: 6),
      TextField(
        controller: _searchCtrl,
        onChanged: (v) => setState(() => _query = v),
        style: const TextStyle(fontSize: 13.5, color: AppColors.textPrimary),
        decoration: InputDecoration(
          hintText: 'Search your sites…',
          hintStyle: const TextStyle(color: AppColors.textTertiary, fontSize: 13),
          prefixIcon: const Icon(Icons.search_rounded, size: 19, color: AppColors.textTertiary),
          filled: true,
          fillColor: AppColors.surface,
          contentPadding: const EdgeInsets.symmetric(vertical: 12),
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
            borderSide: BorderSide(color: AppColors.textPrimary),
          ),
        ),
      ),
      const SizedBox(height: 10),
      SizedBox(
        height: 32,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: _kinds.length + 1,
          separatorBuilder: (_, __) => const SizedBox(width: 7),
          itemBuilder: (_, i) {
            final id = i == 0 ? 'all' : _kinds[i - 1].$1;
            final label = i == 0 ? 'All' : _kinds[i - 1].$3;
            final selected = _filter == id;
            final count = id == 'all'
                ? sites.length
                : sites.where((s) => s.kind == id).length;
            return NebulaChip(
              label: '$label $count',
              selected: selected,
              onSelected: () => setState(() => _filter = id),
            );
          },
        ),
      ),
      const SizedBox(height: 12),
      if (state.loading && sites.isEmpty)
        for (var i = 0; i < 3; i++) ...[
          Container(
            height: 74,
            margin: const EdgeInsets.only(bottom: 8),
            decoration: BoxDecoration(
              color: AppColors.surfaceElevated,
              borderRadius: BorderRadius.circular(15),
              border: Border.all(color: AppColors.border),
            ),
          ).animate(onPlay: (c) => c.repeat(reverse: true)).fadeOut(duration: 700.ms),
        ]
      else if (filtered.isEmpty) ..._sitesEmpty(sites.isNotEmpty)
      else
        ...filtered.asMap().entries.map((e) => StaggerIn(
              index: e.key,
              child: _siteCard(e.value),
            )),
    ];
  }

  List<Widget> _sitesEmpty(bool hasHidden) {
    return [
      const SizedBox(height: 34),
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
            child: const Icon(Icons.layers_outlined, color: AppColors.textSecondary, size: 22),
          ),
          const SizedBox(height: 13),
          Text(
            hasHidden ? 'Nothing matches' : 'Your sites will live here',
            style: const TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w700, fontSize: 14.5, color: AppColors.textPrimary),
          ),
          const SizedBox(height: 6),
          Text(
            hasHidden
                ? 'Try another search or filter.'
                : 'Every build gets a real public link — preview it here, share it anywhere, then publish to GitHub, Vercel, Firebase or your own domain.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.55),
          ),
          if (!hasHidden) ...[
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => setState(() => _tab = 'create'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.background,
                padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Create your first', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
            ),
          ],
        ],
      ),
    ];
  }

  Widget _siteCard(StudioSite site) {
    final dep = site.latestDeployment;
    final dateStr = _dateLabel(site.updatedAt ?? site.at);
    final accent = _siteAccent(site.id);
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
                // Per-site accent identity: the SAME hue the build's design
                // system picked — the ledger teaches each site's palette.
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.13),
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(color: accent.withValues(alpha: 0.4)),
                  ),
                  child: Icon(site.kindGlyph, size: 18, color: Color.lerp(accent, AppColors.textPrimary, 0.35)),
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
                      case 'report':
                        _openReport(site);
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
                    PopupMenuItem(value: 'report', height: 40, child: Text('Build report', style: TextStyle(fontSize: 13.5))),
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

  /// A stable per-site accent derived from the artifact id — deterministic,
  /// tasteful (55-62% lightness range), and unique enough to tell builds apart.
  Color _siteAccent(String id) {
    var h = 2166136261;
    for (final c in id.codeUnits) {
      h ^= c;
      h = (h * 16777619) & 0x7fffffff;
    }
    final hue = (h % 360).toDouble();
    return HSLColor.fromAHSL(1, hue, 0.52, 0.6).toColor();
  }

  // ── TEAM tab — the agents, live ─────────────────────────────────────

  List<Widget> _teamTab(StudioState state) {
    final live = state.liveTrace;
    return [
      const SizedBox(height: 6),
      // Roster strip — every specialist as a monogram chip; each lights up
      // the moment its real row lands in the trace.
      SizedBox(
        height: 62,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: _roster.length,
          separatorBuilder: (_, __) => const SizedBox(width: 7),
          itemBuilder: (_, i) {
            final r = _roster[i];
            final idx = live.lastIndexWhere((row) => row.agent == r.$1);
            final done = idx >= 0 && idx < live.length - 1;
            final active = live.isNotEmpty && live.last.agent == r.$1;
            return _rosterChip(r.$1, done: done, active: active);
          },
        ),
      ),
      const SizedBox(height: 12),
      if (state.building) ...[
        // Progress rail — the fallback pacer, corrected by real rows.
        _progressRail(state, live),
        const SizedBox(height: 14),
        if (live.isEmpty)
          _thinkingCard('Lead', 'reading your brief…')
        else ...[
          _thinkingCard(live.last.agent, live.last.action),
          const SizedBox(height: 12),
          ...live.asMap().entries.map((e) => _traceRow(e.value, isLast: e.key == live.length - 1, index: e.key)),
        ],
      ] else ...[
        // v13: the BUILD REPORT — the team's handover sheet for the last
        // build (stack, technology, front end, back end, crew).
        if (state.lastReport != null) ...[
          _reportCard(state.lastReport!),
          const SizedBox(height: 16),
        ],
        // Idle: the team, introduced — this is WHAT the user is paying for.
        const OverlineLabel('THE STUDIO TEAM', color: AppColors.textTertiary),
        const SizedBox(height: 4),
        const Text(
          'A full crew works every build — the same engineering pattern as the frontier agents: isolated specialists, an artifact bus, review loops and self-evolution.',
          style: TextStyle(fontSize: 12, height: 1.55, color: AppColors.textTertiary),
        ),
        const SizedBox(height: 14),
        _crewGroup('COMMAND', _roster.sublist(0, 1)),
        _crewGroup('UNDERSTANDING', _roster.sublist(1, 3)),
        _crewGroup('CRAFT', _roster.sublist(3, 8)),
        _crewGroup('ASSURANCE', _roster.sublist(8, 11)),
        _crewGroup('EVOLUTION', _roster.sublist(11, 13)),
        const SizedBox(height: 6),
        _teamFact(
          Icons.schedule_rounded,
          'Thinks longer',
          'The Lead critiques its own plan before anyone codes; the Researcher runs a second round when the picture is incomplete.',
        ),
        _teamFact(
          Icons.verified_outlined,
          'Quality-gated',
          'WCAG contrast is enforced with math, QA can send code back, and every page passes the identity firewall.',
        ),
        _teamFact(
          Icons.auto_graph_rounded,
          'Gets better every job',
          'A Reflector distills every finished build into a learned skill — the next build starts smarter.',
        ),
      ],
    ];
  }

  Widget _rosterChip(String name, {required bool done, required bool active}) {
    final initials = name
        .split(RegExp(r'\s+'))
        .take(2)
        .map((w) => w.isNotEmpty ? w[0].toUpperCase() : '')
        .join();
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      width: 46,
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: BoxDecoration(
        color: active ? AppColors.primary : AppColors.surface,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(
          color: active ? AppColors.primary : done ? AppColors.textSecondary.withValues(alpha: 0.5) : AppColors.border,
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            initials,
            style: TextStyle(
              fontFamily: 'JetBrains Mono',
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: active ? AppColors.background : done ? AppColors.textPrimary : AppColors.textTertiary,
            ),
          ),
          const SizedBox(height: 3),
          Container(
            width: 5,
            height: 5,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: active ? AppColors.background : done ? AppColors.success : AppColors.border,
            ),
          ),
        ],
      ),
    );
  }

  Widget _progressRail(StudioState state, List<AgentRunRow> live) {
    final frac = live.isNotEmpty
        ? (live.length / (kBuildStages.length + 2)).clamp(0.04, 1.0)
        : ((state.stageIndex + 1) / kBuildStages.length).clamp(0.04, 1.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'BUILD PROGRESS',
              style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, letterSpacing: 0.16, color: AppColors.textTertiary),
            ),
            Text(
              live.isNotEmpty ? '${live.length} steps' : 'connecting…',
              style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 10, color: AppColors.textTertiary),
            ),
          ],
        ),
        const SizedBox(height: 7),
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: frac),
            duration: const Duration(milliseconds: 420),
            curve: Curves.easeOutCubic,
            builder: (_, v, __) => LinearProgressIndicator(
              value: v,
              minHeight: 4,
              backgroundColor: AppColors.border,
              color: AppColors.primary,
            ),
          ),
        ),
      ],
    );
  }

  Widget _thinkingCard(String agent, String action) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.textPrimary.withValues(alpha: 0.28)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  agent,
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                ),
                const SizedBox(height: 1),
                Text(
                  '$action…',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, color: AppColors.textTertiary),
                ),
              ],
            ),
          ),
        ],
      ),
    ).animate(onPlay: (c) => c.repeat(reverse: true)).fadeIn(duration: 600.ms);
  }

  Widget _traceRow(AgentRunRow row, {bool isLast = false, int index = 0}) {
    final secs = row.ms / 1000;
    final time = secs >= 10 ? '${secs.round()}s' : secs >= 1 ? '${secs.toStringAsFixed(1)}s' : '${row.ms}ms';
    final codeOpen = _expandedCode.contains(index);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Rail: monogram + connecting hairline.
          SizedBox(
            width: 30,
            child: Column(
              children: [
                _monogram(row.agent, active: isLast),
                if (!isLast)
                  Expanded(child: Container(width: 1, color: AppColors.border)),
              ],
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 14),
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
                  // v13: the deliverables this row produced.
                  if (row.artifact != null) ...[
                    const SizedBox(height: 7),
                    _artifactChip(row.artifact!),
                  ],
                  if (row.code != null) ...[
                    const SizedBox(height: 7),
                    _codeToggle(row.code!, open: codeOpen, onToggle: () {
                      setState(() {
                        if (codeOpen) {
                          _expandedCode.remove(index);
                        } else {
                          _expandedCode.add(index);
                        }
                      });
                    }),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 240.ms).slideY(begin: 0.3, end: 0, duration: 240.ms, curve: Curves.easeOutCubic);
  }

  // ── v13 TRANSPARENCY: code shells, artifact chips, build report ────

  /// "VIEW CODE" toggle + the mono shell it expands into.
  Widget _codeToggle(AgentCodeSnippet code, {required bool open, required VoidCallback onToggle}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: onToggle,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: open ? AppColors.primary.withValues(alpha: 0.14) : AppColors.surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: open ? AppColors.primary.withValues(alpha: 0.55) : AppColors.border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.code_rounded, size: 12, color: open ? AppColors.primary : AppColors.textSecondary),
                const SizedBox(width: 5),
                Text(
                  open ? 'HIDE CODE' : 'VIEW CODE',
                  style: TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.12,
                    color: open ? AppColors.primary : AppColors.textSecondary,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  '${code.lines}L',
                  style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 9, color: AppColors.textTertiary),
                ),
                const SizedBox(width: 4),
                AnimatedRotation(
                  turns: open ? 0.5 : 0,
                  duration: const Duration(milliseconds: 180),
                  child: Icon(Icons.keyboard_arrow_down_rounded, size: 13, color: open ? AppColors.primary : AppColors.textTertiary),
                ),
              ],
            ),
          ),
        ),
        AnimatedCrossFade(
          firstChild: const SizedBox(width: double.infinity),
          secondChild: _codeShell(code),
          crossFadeState: open ? CrossFadeState.showSecond : CrossFadeState.showFirst,
          duration: const Duration(milliseconds: 200),
        ),
      ],
    );
  }

  /// The mono shell — a tiny terminal window with the code the agent
  /// just wrote (JetBrains Mono, true-black surface, copy button).
  Widget _codeShell(AgentCodeSnippet code) {
    return Container(
      margin: const EdgeInsets.only(top: 7),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFF05070B),
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: const BoxDecoration(
              color: Color(0xFF0C1017),
              border: Border(bottom: BorderSide(color: AppColors.border)),
            ),
            child: Row(
              children: [
                const Icon(Icons.terminal_rounded, size: 12, color: AppColors.textTertiary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    code.label.isEmpty ? code.lang : code.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 9.5, color: AppColors.textSecondary),
                  ),
                ),
                Text(
                  '${(code.chars / 1024).toStringAsFixed(1)}KB',
                  style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 9, color: AppColors.textTertiary),
                ),
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: () async {
                    await Clipboard.setData(ClipboardData(text: code.preview));
                    if (mounted) showNebulaToast(context, 'Code copied', icon: Icons.code_rounded);
                  },
                  child: const Icon(Icons.copy_rounded, size: 12, color: AppColors.textTertiary),
                ),
              ],
            ),
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 240),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(10),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Text(
                  code.preview,
                  style: TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontSize: 10,
                    height: 1.55,
                    color: AppColors.textSecondary.withValues(alpha: 0.92),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// An artifact event — a real deliverable the team produced mid-run.
  Widget _artifactChip(AgentArtifactEvent a) {
    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.24)),
      ),
      child: Row(
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(a.glyph, size: 14, color: AppColors.primary),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  a.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                ),
                if (a.detail.isNotEmpty)
                  Text(
                    a.detail,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10, height: 1.3, color: AppColors.textTertiary),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            a.type.toUpperCase(),
            style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 8, fontWeight: FontWeight.w800, letterSpacing: 0.14, color: AppColors.textTertiary),
          ),
        ],
      ),
    );
  }

  /// The BUILD REPORT card on the Team tab — the handover sheet.
  Widget _reportCard(BuildReport r) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 8, 0),
            child: Row(
              children: [
                const Expanded(
                  child: OverlineLabel('BUILD REPORT', color: AppColors.primary),
                ),
                GestureDetector(
                  onTap: () => ref.read(studioProvider.notifier).dismissReport(),
                  child: const Padding(
                    padding: EdgeInsets.all(6),
                    child: Icon(Icons.close_rounded, size: 15, color: AppColors.textTertiary),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 6, 14, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                ),
                const SizedBox(height: 3),
                Text(
                  '${r.agentCount} agents · ${r.aiCalls} AI calls · ${(r.buildMs / 1000).round()}s · ${(r.bytes / 1024).toStringAsFixed(1)} KB',
                  style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 9.5, color: AppColors.textTertiary),
                ),
                if (r.overview.isNotEmpty) ...[
                  const SizedBox(height: 5),
                  Text(
                    r.overview,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, height: 1.4, color: AppColors.textSecondary),
                  ),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
            child: _reportBody(r, compact: true),
          ),
        ],
      ),
    );
  }

  /// The report renderer (card-compact or full-sheet).
  Widget _reportBody(BuildReport r, {bool compact = false}) {
    final stackRows = compact ? r.stack.take(6).toList() : r.stack;
    Widget overline(String t) => Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: OverlineLabel(t, color: AppColors.textTertiary),
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        overline('STACK & TECHNOLOGY'),
        Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(11),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              for (var i = 0; i < stackRows.length; i++) ...[
                if (i > 0) Container(height: 1, color: AppColors.border.withValues(alpha: 0.55)),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 92,
                        child: Text(
                          stackRows[i].$1,
                          style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.textSecondary),
                        ),
                      ),
                      Expanded(
                        child: Text(
                          stackRows[i].$2,
                          style: const TextStyle(fontSize: 10.5, height: 1.45, color: AppColors.textTertiary),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
        if (!compact && r.sections.isNotEmpty) ...[
          const SizedBox(height: 12),
          overline('FRONT END — SECTIONS'),
          ...r.sections.map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(7),
                      ),
                      child: Text(
                        s.id,
                        style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 9, fontWeight: FontWeight.w800, color: AppColors.primary),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            s.name + (s.chars != null ? '  ·  ${s.chars} chars' : ''),
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                          ),
                          if (s.goal.isNotEmpty)
                            Text(s.goal, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10, height: 1.3, color: AppColors.textTertiary)),
                        ],
                      ),
                    ),
                  ],
                ),
              )),
        ],
        if (!compact && r.components.isNotEmpty) ...[
          const SizedBox(height: 10),
          overline('BUILT-IN BEHAVIORS'),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: r.components.map((c) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(c, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
                )).toList(),
          ),
        ],
        if (r.quality.isNotEmpty) ...[
          const SizedBox(height: 12),
          overline('QUALITY GATES'),
          ...r.quality.entries.map((e) => Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.verified_outlined, size: 12, color: AppColors.success),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        '${e.key.replaceAll('_', ' ')}: ${e.value}',
                        style: const TextStyle(fontSize: 10.5, height: 1.4, color: AppColors.textTertiary),
                      ),
                    ),
                  ],
                ),
              )),
        ],
        if (!compact && r.crew.isNotEmpty) ...[
          const SizedBox(height: 12),
          overline('THE CREW'),
          ...r.crew.map((c) => Padding(
                padding: const EdgeInsets.only(bottom: 5),
                child: Row(
                  children: [
                    _monogram(c.$1),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${c.$1} — ${c.$2}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 10.5, color: AppColors.textTertiary),
                      ),
                    ),
                  ],
                ),
              )),
        ],
        if (!compact && (r.research.isNotEmpty || r.skills.isNotEmpty)) ...[
          const SizedBox(height: 12),
          overline('RESEARCH & GROWTH'),
          if (r.research.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: Text(r.research, style: const TextStyle(fontSize: 10.5, height: 1.45, color: AppColors.textTertiary)),
            ),
          ...r.skills.map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 5),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.auto_awesome_rounded, size: 12, color: AppColors.primary),
                    const SizedBox(width: 7),
                    Expanded(child: Text(s, style: const TextStyle(fontSize: 10.5, height: 1.4, color: AppColors.textTertiary))),
                  ],
                ),
              )),
        ],
      ],
    );
  }

  /// Sites ledger → "Build report" — fetches the stored sheet and shows it.
  Future<void> _openReport(StudioSite site) async {
    final current = ref.read(studioProvider).lastReport;
    BuildReport? r = current?.title == site.title ? current : null;
    r ??= await ref.read(studioProvider.notifier).loadReport(site.id);
    if (!mounted) return;
    if (r == null) {
      showNebulaToast(context, 'No report stored for this build (pre-v13 build).',
          icon: Icons.info_outline_rounded, color: AppColors.warning);
      return;
    }
    _showReportSheet(r);
  }

  void _showReportSheet(BuildReport r) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surfaceHigh,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.72,
        maxChildSize: 0.94,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 34),
          children: [
            Row(
              children: [
                const Expanded(
                  child: OverlineLabel('BUILD REPORT', color: AppColors.primary),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded, size: 17, color: AppColors.textTertiary),
                ),
              ],
            ),
            Text(
              r.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 3),
            Text(
              '${r.agentCount} agents · ${r.aiCalls} AI calls · ${(r.buildMs / 1000).round()}s · ${(r.bytes / 1024).toStringAsFixed(1)} KB · ${r.brand}',
              style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 9.5, color: AppColors.textTertiary),
            ),
            if (r.url.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                r.url,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontFamily: 'JetBrains Mono', fontSize: 9.5, color: AppColors.primary),
              ),
            ],
            const SizedBox(height: 14),
            _reportBody(r),
          ],
        ),
      ),
    );
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

  Widget _crewGroup(String title, List<(String, String)> members) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.fromLTRB(13, 11, 13, 13),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            OverlineLabel(title, color: AppColors.textTertiary),
            const SizedBox(height: 8),
            ...members.map((m) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    children: [
                      _monogram(m.$1),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              m.$1,
                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                            ),
                            Text(
                              m.$2,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                )),
          ],
        ),
      ),
    );
  }

  Widget _teamFact(IconData icon, String title, String body) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Icon(icon, size: 17, color: AppColors.textSecondary),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
                  const SizedBox(height: 2),
                  Text(body, style: const TextStyle(fontSize: 11, height: 1.45, color: AppColors.textTertiary)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Shared widgets & helpers ────────────────────────────────────────

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
            TextButton(
              onPressed: _openPlans,
              style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: Size.zero),
              child: const Text('Plans', style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w800, fontSize: 12)),
            ),
          ],
        ),
      );

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

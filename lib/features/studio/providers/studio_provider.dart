import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/studio_models.dart';
import '../services/studio_api_service.dart';

/// Studio API service provider.
final studioApiProvider = Provider<StudioApiService>((ref) => StudioApiService());

/// One visible step of the agent build pipeline. Mirrors the REAL
/// server-side team (Agent v11 · IDENTITY): a Lead orchestrator plans
/// the run and then DEEP-THINKS it (self-critique + revision), an
/// Analyst builds the project understanding, the Researcher runs two
/// research rounds, the Art Director ships WCAG-verified design tokens
/// + a UX flow + a per-brief design-DNA palette, the Architect
/// journey-maps the sections, the Photographer sources and verifies
/// real imagery, Engineers hand-code every section with an advanced
/// motion system, QA reworks flagged code, the Builder enforces the
/// identity firewall, the Reflector distills a lesson, and a Skill
/// Researcher grows the library from live research. No templates
/// anywhere in the primary path.
class BuildStage {
  const BuildStage(this.label, this.icon);
  final String label;
  final String icon;
}

const kBuildStages = <BuildStage>[
  BuildStage('Lead · locking your identity + planning', '🧠'),
  BuildStage('Lead · deep-thinking the plan', '🧠'),
  BuildStage('Analyst · understanding your project', '🧭'),
  BuildStage('Art Director · designing the system', '🎨'),
  BuildStage('Researcher · studying your market', '🔍'),
  BuildStage('Copywriter · writing your words', '✍️'),
  BuildStage('Copy Chief · tightening every line', '🧐'),
  BuildStage('Architect · journey-mapping your page', '📐'),
  BuildStage('Photographer · sourcing real imagery', '📷'),
  BuildStage('Engineers · hand-coding the page', '🛠️'),
  BuildStage('QA Director · reviewing the code', '🔎'),
  BuildStage('Builder · wiring & hosting it live', '🚀'),
  BuildStage('Reflector · learning from this build', '🪞'),
  BuildStage('Skill Researcher · studying the craft', '📚'),
];

/// Studio state: built sites + hosting platform connections + build/refine
/// progress + the LIVE agent-team trace (Agent v10) + the v12 billing
/// snapshot (plan + quota).
class StudioState {
  const StudioState({
    this.sites = const [],
    this.connectors = const [],
    this.loading = false,
    this.building = false,
    this.refiningId,
    this.stageIndex = 0,
    this.liveTrace = const [],
    this.billing,
    this.error,
  });

  final List<StudioSite> sites;
  final List<HostingConnector> connectors;
  final bool loading;
  final bool building;

  /// Artifact currently being refined (null when none).
  final String? refiningId;

  /// Index into [kBuildStages] — the fallback pacer used until the first
  /// real agent row arrives from the live run stream.
  final int stageIndex;

  /// REAL rows from the agent team's run doc, streamed from the Worker as
  /// each agent finishes a step. Empty until the live stream connects;
  /// non-empty rows replace the ticker in the UI.
  final List<AgentRunRow> liveTrace;

  /// v12: the user's plan + quota (null while loading / on old workers).
  final BillingSnapshot? billing;

  final String? error;

  bool get anyHostingConnected =>
      connectors.any((c) => c.connected && c.canPublish);

  StudioState copyWith({
    List<StudioSite>? sites,
    List<HostingConnector>? connectors,
    bool? loading,
    bool? building,
    String? refiningId,
    bool clearRefining = false,
    int? stageIndex,
    List<AgentRunRow>? liveTrace,
    bool clearTrace = false,
    BillingSnapshot? billing,
    bool clearBilling = false,
    String? error,
    bool clearError = false,
  }) =>
      StudioState(
        sites: sites ?? this.sites,
        connectors: connectors ?? this.connectors,
        loading: loading ?? this.loading,
        building: building ?? this.building,
        refiningId: clearRefining ? null : (refiningId ?? this.refiningId),
        stageIndex: stageIndex ?? this.stageIndex,
        liveTrace: clearTrace ? const [] : (liveTrace ?? this.liveTrace),
        billing: clearBilling ? null : (billing ?? this.billing),
        error: clearError ? null : (error ?? this.error),
      );
}

/// Controller for the Studio screen.
class StudioController extends StateNotifier<StudioState> {
  StudioController(this._api) : super(const StudioState());

  final StudioApiService _api;
  Timer? _stageTimer;

  static const _pollInterval = Duration(milliseconds: 2500);
  static const _maxPolls = 120; // 300s of watching, > the 240s build timeout

  /// A unique run id (client-side, `b_` + base36 time + jitter) — the Worker
  /// streams the team's trace into `agent:run:<runId>` while the build
  /// request is in flight.
  String _newRunId() {
    final t = DateTime.now().millisecondsSinceEpoch.toRadixString(36);
    final r = (DateTime.now().microsecondsSinceEpoch % 1679616).toRadixString(36).padLeft(4, '0');
    return 'b_$t$r';
  }

  void _startStages() {
    _stageTimer?.cancel();
    state = state.copyWith(stageIndex: 0, clearTrace: true);
    // Fallback pacer: while the live run doc has not appeared (old Worker)
    // or before its first row lands, the ticker keeps progress honest about
    // ORDER. Real agent rows replace it the moment they stream in.
    _stageTimer = Timer.periodic(const Duration(milliseconds: 3900), (t) {
      if (!state.building) {
        t.cancel();
        return;
      }
      if (state.stageIndex < kBuildStages.length - 1) {
        state = state.copyWith(stageIndex: state.stageIndex + 1);
      }
    });
  }

  void _stopStages() {
    _stageTimer?.cancel();
    _stageTimer = null;
  }

  /// Watch the run doc while the build request is in flight: poll every
  /// 2.5s and push every new agent row into [state.liveTrace] — the UI
  /// swaps the ticker for the REAL team. Telemetry only: never throws,
  /// never affects the build's outcome (the POST response is the truth).
  Future<void> _watchRun(String runId) async {
    var seen = 0;
    for (var i = 0; i < _maxPolls; i++) {
      await Future<void>.delayed(i == 0 ? const Duration(milliseconds: 900) : _pollInterval);
      if (!state.building) return; // build finished — stop watching
      try {
        final s = await _api.pollRun(runId);
        if (s.trace.length > seen) {
          seen = s.trace.length;
          state = state.copyWith(liveTrace: s.trace);
        }
        if (s.status != 'running') return; // done/error/timeout — final doc
      } on StudioApiException {
        continue; // old server (404: no run doc) or a network blip — keep going
      }
    }
  }

  Future<void> refresh() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      // Two independent calls, raced in parallel. (Future.wait with mixed
      // element types erases generics — awaiting both futures directly keeps
      // the types intact.) Billing is best-effort: an old worker without
      // /v1/billing must not break the Studio.
      final sitesFuture = _api.listSites();
      final connectorsFuture = _api.listConnectors();
      final sites = await sitesFuture;
      final connectors = await connectorsFuture;
      BillingSnapshot? billing;
      try {
        billing = await _api.fetchBilling();
      } catch (_) {
        billing = null; // old worker — the Studio works without billing
      }
      state = state.copyWith(
        sites: sites,
        connectors: connectors,
        loading: false,
        billing: billing,
        clearBilling: billing == null,
      );
    } on StudioApiException catch (e) {
      state = state.copyWith(loading: false, error: e.message);
    } catch (e) {
      state = state.copyWith(loading: false, error: 'Could not load the Studio. $e');
    }
  }

  /// Build a site. [onDone] hands back the fresh artifact so the caller can
  /// navigate straight into the live preview.
  ///
  /// WATCHABLE RUN (Agent v9.1): the build request carries a client-run id
  /// and a concurrent poll loop streams the team's REAL trace into
  /// [state.liveTrace] while the request is in flight. On an old Worker the
  /// run doc never appears, the poll loop quietly no-ops, and the ticker
  /// paces the wait — the user sees a live team either way.
  Future<void> buildSite({
    required String title,
    required String brief,
    required String kind,
    String? style,
    String? ctaText,
    String? ctaUrl,
    void Function(StudioSite site)? onDone,
  }) async {
    state = state.copyWith(building: true, clearError: true);
    _startStages();
    try {
      final runId = _newRunId();
      unawaited(_watchRun(runId)); // telemetry only — never throws
      final site = await _api.buildSite(
        title: title,
        brief: brief,
        kind: kind,
        style: style,
        ctaText: ctaText,
        ctaUrl: ctaUrl,
        runId: runId,
      );
      _stopStages();
      state = state.copyWith(building: false);
      await refresh();
      onDone?.call(site);
    } on StudioApiException catch (e) {
      _stopStages();
      state = state.copyWith(building: false, error: e.message);
    } catch (e) {
      _stopStages();
      state = state.copyWith(building: false, error: 'Build failed. $e');
    }
  }

  /// Refine an existing build ("make the headline bolder"). Returns the
  /// updated site so the preview can reload it. [sections] names a subset
  /// for a SURGICAL re-code ("just the hero") — everything else stays
  /// byte-identical and the round-trip takes seconds, not a minute.
  Future<StudioSite> refineSite({
    required String artifactId,
    required String instruction,
    List<String> sections = const [],
  }) async {
    state = state.copyWith(refiningId: artifactId, clearError: true);
    try {
      final site = await _api.refineSite(
        artifactId: artifactId,
        instruction: instruction,
        sections: sections,
      );
      await refresh();
      state = state.copyWith(clearRefining: true);
      return site;
    } on StudioApiException catch (e) {
      state = state.copyWith(clearRefining: true, error: e.message);
      rethrow;
    } catch (e) {
      state = state.copyWith(clearRefining: true, error: 'Update failed. $e');
      rethrow;
    }
  }

  Future<String> connectPlatform({
    required String connector,
    required Map<String, String> credentials,
    String? label,
  }) async {
    final note = await _api.connectPlatform(
      connector: connector,
      credentials: credentials,
      label: label,
    );
    await refresh();
    return note;
  }

  Future<void> disconnectPlatform(String connector) async {
    await _api.disconnectPlatform(connector);
    await refresh();
  }

  Future<SiteDeployment> publishSite({
    required String artifactId,
    required String connector,
    String? repo,
    String? domain,
    String? siteId,
  }) async {
    final dep = await _api.publishSite(
      artifactId: artifactId,
      connector: connector,
      repo: repo,
      domain: domain,
      siteId: siteId,
    );
    await refresh();
    return dep;
  }

  Future<String> pointDomain({
    required String connector,
    required String domain,
    required String target,
    String name = 'www',
  }) =>
      _api.pointDomain(connector: connector, domain: domain, target: target, name: name);

  /// v12: create a pending upgrade order (manual activation).
  Future<String> checkout(String planId) => _api.createCheckout(planId);

  @override
  void dispose() {
    _stageTimer?.cancel();
    super.dispose();
  }
}

final studioProvider =
    StateNotifierProvider<StudioController, StudioState>((ref) {
  final controller = StudioController(ref.read(studioApiProvider));
  controller.refresh();
  return controller;
});

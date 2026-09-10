import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/studio_models.dart';
import '../services/studio_api_service.dart';

/// Studio API service provider.
final studioApiProvider = Provider<StudioApiService>((ref) => StudioApiService());

/// One visible step of the agent build pipeline. Mirrors the REAL
/// server-side team (Agent v9): a Lead orchestrator plans the run, then
/// named specialists — Researcher, Art Director, Copywriter, Copy Chief,
/// Architect, Engineers, QA Director, Reflector — build the page section
/// by section with a QA rework loop, and every build ends with a lesson
/// stored back into the skill library. No templates anywhere in the
/// primary path.
class BuildStage {
  const BuildStage(this.label, this.icon);
  final String label;
  final String icon;
}

const kBuildStages = <BuildStage>[
  BuildStage('Lead · forming your build team', '🧠'),
  BuildStage('Researcher · scanning your market', '🔍'),
  BuildStage('Art Director · designing the system', '🎨'),
  BuildStage('Copywriter · writing your words', '✍️'),
  BuildStage('Copy Chief · tightening every line', '🧐'),
  BuildStage('Architect · planning your sections', '📐'),
  BuildStage('Engineers · hand-coding the page', '🛠️'),
  BuildStage('QA Director · reviewing the code', '🔎'),
  BuildStage('Builder · wiring & hosting it live', '🚀'),
];

/// Studio state: built sites + hosting platform connections + build/refine
/// progress + the LIVE agent-team trace (Agent v9).
class StudioState {
  const StudioState({
    this.sites = const [],
    this.connectors = const [],
    this.loading = false,
    this.building = false,
    this.refiningId,
    this.stageIndex = 0,
    this.liveTrace = const [],
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
        error: clearError ? null : (error ?? this.error),
      );
}

/// Controller for the Studio screen.
class StudioController extends StateNotifier<StudioState> {
  StudioController(this._api) : super(const StudioState());

  final StudioApiService _api;
  Timer? _stageTimer;

  static const _pollInterval = Duration(milliseconds: 2500);
  static const _maxPolls = 120; // 300s budget, mirrors the server-side run cap

  void _startStages() {
    _stageTimer?.cancel();
    state = state.copyWith(stageIndex: 0, clearTrace: true);
    // Fallback pacer: while the live stream has not connected yet (or on an
    // old Worker), the ticker keeps progress honest about ORDER. It holds
    // on the last stage until the build actually lands.
    _stageTimer = Timer.periodic(const Duration(milliseconds: 4600), (t) {
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

  /// Watch a live run: poll GET /v1/studio/run every 2.5s, push every new
  /// agent row into [state.liveTrace] (the UI swaps the ticker for the real
  /// team), and complete when the run lands.
  Future<StudioSite> _watchRun(String jobId) async {
    var seen = 0;
    for (var i = 0; i < _maxPolls; i++) {
      await Future<void>.delayed(i == 0 ? const Duration(milliseconds: 700) : _pollInterval);
      final StudioRunStatus s;
      try {
        s = await _api.pollRun(jobId);
      } on StudioApiException {
        continue; // transient network error — keep watching
      }
      if (s.trace.length > seen) {
        seen = s.trace.length;
        state = state.copyWith(liveTrace: s.trace);
      }
      if (s.status == 'done' && s.site != null) return s.site!;
      if (s.status == 'error') {
        throw StudioApiException(s.error ?? 'The build failed.');
      }
      if (s.status == 'timeout') {
        throw StudioApiException(
            'The team took longer than its budget. Check your sites list — the build may still have landed.');
      }
    }
    throw StudioApiException('Lost contact with the build team. Check your sites list in a moment.');
  }

  Future<void> refresh() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      // Two independent calls, raced in parallel. (Future.wait with mixed
      // element types erases generics — awaiting both futures directly keeps
      // the types intact.)
      final sitesFuture = _api.listSites();
      final connectorsFuture = _api.listConnectors();
      final sites = await sitesFuture;
      final connectors = await connectorsFuture;
      state = state.copyWith(sites: sites, connectors: connectors, loading: false);
    } on StudioApiException catch (e) {
      state = state.copyWith(loading: false, error: e.message);
    } catch (e) {
      state = state.copyWith(loading: false, error: 'Could not load the Studio. $e');
    }
  }

  /// Build a site. [onDone] hands back the fresh artifact so the caller can
  /// navigate straight into the live preview.
  ///
  /// Primary path (Agent v9): start a LIVE RUN and stream the real team
  /// trace into [state.liveTrace] while it works. If the server or network
  /// can't do live runs, fall back to the legacy synchronous build with the
  /// ticker pacer — the user never sees a dead screen either way.
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
      String? jobId;
      try {
        jobId = await _api.startBuild(
          title: title,
          brief: brief,
          kind: kind,
          style: style,
          ctaText: ctaText,
          ctaUrl: ctaUrl,
        );
      } catch (_) {
        jobId = null; // old deployment / offline hiccup → legacy path below
      }
      final site = jobId != null
          ? await _watchRun(jobId)
          : await _api.buildSite(
              title: title,
              brief: brief,
              kind: kind,
              style: style,
              ctaText: ctaText,
              ctaUrl: ctaUrl,
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

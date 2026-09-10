import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/studio_models.dart';
import '../services/studio_api_service.dart';

/// Studio API service provider.
final studioApiProvider = Provider<StudioApiService>((ref) => StudioApiService());

/// One visible step of the agent build pipeline. Mirrors the REAL
/// server-side pipeline (Agent v7): the agent researches, plans the
/// architecture, then hand-codes each section's HTML+CSS before a
/// director review — no templates anywhere in the primary path.
class BuildStage {
  const BuildStage(this.label, this.icon);
  final String label;
  final String icon;
}

const kBuildStages = <BuildStage>[
  BuildStage('Understanding your brief', '💡'),
  BuildStage('Researching your market', '🔍'),
  BuildStage('Designing your look & feel', '🎨'),
  BuildStage('Writing your copy', '✍️'),
  BuildStage('Planning your sections', '📐'),
  BuildStage('Hand-coding your page', '🛠️'),
  BuildStage('Director review & polish', '🧐'),
  BuildStage('Wiring & hosting it live', '🚀'),
];

/// Studio state: built sites + hosting platform connections + build/refine
/// progress.
class StudioState {
  const StudioState({
    this.sites = const [],
    this.connectors = const [],
    this.loading = false,
    this.building = false,
    this.refiningId,
    this.stageIndex = 0,
    this.error,
  });

  final List<StudioSite> sites;
  final List<HostingConnector> connectors;
  final bool loading;
  final bool building;

  /// Artifact currently being refined (null when none).
  final String? refiningId;

  /// Index into [kBuildStages] shown as agent progress while building.
  final int stageIndex;
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
        error: clearError ? null : (error ?? this.error),
      );
}

/// Controller for the Studio screen.
class StudioController extends StateNotifier<StudioState> {
  StudioController(this._api) : super(const StudioState());

  final StudioApiService _api;
  Timer? _stageTimer;

  void _startStages() {
    _stageTimer?.cancel();
    state = state.copyWith(stageIndex: 0);
    // The real pipeline runs server-side (research → plan → per-section
    // codegen → review → wire) and takes ~40-90s for a bespoke page.
    // The ticker paces across that window so progress stays honest about
    // ORDER; it holds on the last stage until the build actually lands.
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
      final site = await _api.buildSite(
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
  /// updated site so the preview can reload it.
  Future<StudioSite> refineSite({
    required String artifactId,
    required String instruction,
  }) async {
    state = state.copyWith(refiningId: artifactId, clearError: true);
    try {
      final site = await _api.refineSite(artifactId: artifactId, instruction: instruction);
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

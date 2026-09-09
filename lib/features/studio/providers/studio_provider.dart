import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/studio_models.dart';
import '../services/studio_api_service.dart';

/// Studio API service provider.
final studioApiProvider = Provider<StudioApiService>((ref) => StudioApiService());

/// Studio state: built sites + hosting platform connections.
class StudioState {
  const StudioState({
    this.sites = const [],
    this.connectors = const [],
    this.loading = false,
    this.building = false,
    this.error,
    this.buildStage,
  });

  final List<StudioSite> sites;
  final List<HostingConnector> connectors;
  final bool loading;
  final bool building;

  /// Human-readable progress line shown while the agent builds.
  final String? buildStage;
  final String? error;

  bool get anyHostingConnected =>
      connectors.any((c) => c.connected && c.canPublish);

  StudioState copyWith({
    List<StudioSite>? sites,
    List<HostingConnector>? connectors,
    bool? loading,
    bool? building,
    String? buildStage,
    String? error,
    bool clearError = false,
  }) =>
      StudioState(
        sites: sites ?? this.sites,
        connectors: connectors ?? this.connectors,
        loading: loading ?? this.loading,
        building: building ?? this.building,
        buildStage: buildStage ?? this.buildStage,
        error: clearError ? null : (error ?? this.error),
      );
}

/// Controller for the Studio screen.
class StudioController extends StateNotifier<StudioState> {
  StudioController(this._api) : super(const StudioState());

  final StudioApiService _api;

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
    state = state.copyWith(building: true, buildStage: 'Designing your site…', clearError: true);
    try {
      final site = await _api.buildSite(
        title: title,
        brief: brief,
        kind: kind,
        style: style,
        ctaText: ctaText,
        ctaUrl: ctaUrl,
      );
      state = state.copyWith(building: false, buildStage: null);
      await refresh();
      onDone?.call(site);
    } on StudioApiException catch (e) {
      state = state.copyWith(building: false, buildStage: null, error: e.message);
    } catch (e) {
      state = state.copyWith(building: false, buildStage: null, error: 'Build failed. $e');
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
}

final studioProvider =
    StateNotifierProvider<StudioController, StudioState>((ref) {
  final controller = StudioController(ref.read(studioApiProvider));
  controller.refresh();
  return controller;
});

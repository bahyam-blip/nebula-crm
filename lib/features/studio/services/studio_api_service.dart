import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import '../../../core/services/storage_service.dart' show kStorageBaseUrl;
import '../models/studio_models.dart';

/// The status of one live agent-team run (Agent v9).
class StudioRunStatus {
  const StudioRunStatus({
    required this.status,
    required this.trace,
    this.title,
    this.error,
    this.site,
  });

  /// running | done | error | timeout
  final String status;
  final List<AgentRunRow> trace;
  final String? title;
  final String? error;

  /// The finished artifact when [status] == done.
  final StudioSite? site;
}

/// Studio API exception with a human-friendly message.
class StudioApiException implements Exception {
  StudioApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Client for the Worker's Nebula Studio endpoints (/v1/studio/*).
///
/// Same pattern as the mail/assistant services: the caller's Firebase ID
/// token proves identity, the Worker enforces roles and pulls platform
/// credentials from its encrypted vault — the app NEVER sees a hosting
/// secret after the one-time connect.
class StudioApiService {
  StudioApiService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = (baseUrl ?? kStorageBaseUrl).replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _baseUrl;

  Future<String> _idToken() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StudioApiException('Please sign in first.');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw StudioApiException('Could not verify your session.');
    }
    return token;
  }

  Map<String, String> _headers(String token) => {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      };

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    int timeoutSeconds = 120,
  }) async {
    final token = await _idToken();
    final uri = Uri.parse('$_baseUrl$path');
    final headers = _headers(token);

    late http.Response res;
    try {
      switch (method) {
        case 'POST':
          res = await _client
              .post(uri, headers: headers, body: jsonEncode(body ?? {}))
              .timeout(Duration(seconds: timeoutSeconds));
          break;
        case 'DELETE':
          res = await _client.delete(uri, headers: headers).timeout(const Duration(seconds: 30));
          break;
        default:
          res = await _client.get(uri, headers: headers).timeout(const Duration(seconds: 30));
      }
    } catch (e) {
      throw StudioApiException('Could not reach the Studio. $e');
    }

    Map<String, dynamic> json;
    try {
      json = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw StudioApiException('Studio returned an unexpected response (${res.statusCode}).');
    }
    if (res.statusCode >= 400) {
      throw StudioApiException((json['error'] as String?) ?? 'Request failed (${res.statusCode}).');
    }
    return json;
  }

  /// Poll a live run: status + every agent row so far (+ the finished site
  /// in the result payload when the run doc is done).
  Future<StudioRunStatus> pollRun(String runId) async {
    final json = await _send('GET', '/v1/studio/run?id=$runId');
    if (json['ok'] != true) {
      throw StudioApiException((json['error'] as String?) ?? 'Run not found.');
    }
    final result = json['result'] as Map<String, dynamic>?;
    return StudioRunStatus(
      status: (json['status'] as String?) ?? 'running',
      trace: ((json['trace'] as List?) ?? const [])
          .whereType<Map>()
          .map((r) => AgentRunRow.fromMap(r.cast<String, dynamic>()))
          .toList(),
      title: json['title'] as String?,
      error: json['error'] as String?,
      site: result == null
          ? null
          : StudioSite.fromMap(<String, dynamic>{
              ...result,
              'id': result['artifact_id'],
            }),
    );
  }

  /// Build a site: AI generates a complete branded page, hosted instantly
  /// at /sites/<id>. Long timeout — generation takes a while.
  ///
  /// Pass [runId] (client-generated, e.g. `b_x7g2k1abcd`) to make the build
  /// a WATCHABLE RUN: the Worker streams the team's trace into that run doc
  /// while the request is in flight; poll [pollRun] concurrently for the
  /// live agent feed. Old deployments simply ignore it.
  Future<StudioSite> buildSite({
    required String title,
    required String brief,
    required String kind,
    String? style,
    String? ctaText,
    String? ctaUrl,
    String? runId,
  }) async {
    final json = await _send('POST', '/v1/studio/build', body: {
      'title': title,
      'brief': brief,
      'kind': kind,
      if (runId != null && runId.isNotEmpty) 'run_id': runId,
      if (style != null && style.isNotEmpty) 'style': style,
      if (ctaText != null && ctaText.isNotEmpty) 'cta_text': ctaText,
      if (ctaUrl != null && ctaUrl.isNotEmpty) 'cta_url': ctaUrl,
    }, timeoutSeconds: 240);
    if (json['ok'] != true) {
      throw StudioApiException((json['error'] as String?) ?? 'The build did not finish.');
    }
    // The build endpoint returns the artifact at the top level with
    // artifact_id; StudioSite expects an `id` key like the sites list.
    return StudioSite.fromMap(<String, dynamic>{
      ...json,
      'id': json['artifact_id'],
    });
  }

  /// Refine an existing build with a change request. Returns the updated
  /// site (same id/URL, version bumped). When [sections] is non-empty the
  /// Worker re-codes ONLY those sections (surgical refine, seconds fast)
  /// and leaves the rest of the page byte-identical.
  Future<StudioSite> refineSite({
    required String artifactId,
    required String instruction,
    List<String> sections = const [],
  }) async {
    final json = await _send('POST', '/v1/studio/refine', body: {
      'artifact_id': artifactId,
      'instruction': instruction,
      if (sections.isNotEmpty) 'sections': sections,
    }, timeoutSeconds: 240);
    if (json['ok'] != true) {
      throw StudioApiException((json['error'] as String?) ?? 'The update did not finish.');
    }
    return StudioSite.fromMap(<String, dynamic>{
      ...json,
      'id': json['artifact_id'],
    });
  }

  /// Everything the agent has built for this user (sites + notes), with
  /// deployment history attached to each site.
  Future<List<StudioSite>> listSites() async {
    final json = await _send('GET', '/v1/studio/sites');
    final list = ((json['sites'] as List?) ?? const [])
        .whereType<Map>()
        .map((s) => StudioSite.fromMap(s.cast<String, dynamic>()))
        .toList();
    return list;
  }

  /// Platform registry + connected state.
  Future<List<HostingConnector>> listConnectors() async {
    final json = await _send('GET', '/v1/studio/connectors');
    return ((json['platforms'] as List?) ?? const [])
        .whereType<Map>()
        .map((p) => HostingConnector.fromMap(p.cast<String, dynamic>()))
        .toList();
  }

  /// Connect a platform once. Credentials are encrypted server-side;
  /// afterwards publishing needs no tokens anywhere in the app.
  Future<String> connectPlatform({
    required String connector,
    required Map<String, String> credentials,
    String? label,
  }) async {
    final json = await _send('POST', '/v1/studio/connect', body: {
      'connector': connector,
      ...credentials,
      if (label != null && label.isNotEmpty) 'label': label,
    });
    return (json['note'] as String?) ?? 'Connected.';
  }

  Future<void> disconnectPlatform(String connector) async {
    await _send('DELETE', '/v1/studio/connect?connector=$connector');
  }

  /// Publish a built site to a connected hosting platform. Returns the
  /// real public URL (github.io / vercel.app / web.app / custom domain).
  Future<SiteDeployment> publishSite({
    required String artifactId,
    required String connector,
    String? repo,
    String? domain,
    String? siteId,
  }) async {
    final json = await _send('POST', '/v1/studio/publish', body: {
      'artifact_id': artifactId,
      'connector': connector,
      if (repo != null && repo.isNotEmpty) 'repo': repo,
      if (domain != null && domain.isNotEmpty) 'domain': domain,
      if (siteId != null && siteId.isNotEmpty) 'site_id': siteId,
    });
    return SiteDeployment.fromMap(json);
  }

  /// Point a registrar domain host (CNAME) at a deployed site host.
  Future<String> pointDomain({
    required String connector,
    required String domain,
    required String target,
    String name = 'www',
  }) async {
    final json = await _send('POST', '/v1/studio/point-domain', body: {
      'connector': connector,
      'domain': domain,
      'name': name,
      'target': target,
    });
    return (json['note'] as String?) ?? 'DNS record set.';
  }

  /// Deployment history for one artifact.
  Future<List<SiteDeployment>> deployments(String artifactId) async {
    final json = await _send('GET', '/v1/studio/deployments?artifact_id=$artifactId');
    return ((json['deployments'] as List?) ?? const [])
        .whereType<Map>()
        .map((d) => SiteDeployment.fromMap(d.cast<String, dynamic>()))
        .toList();
  }
}

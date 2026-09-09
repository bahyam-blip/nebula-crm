/// Nebula Studio models — built sites, hosting platforms, deployments.
///
/// The Studio is the app's build → preview → publish surface: the agent
/// builds a site (Worker `/sites/<id>`), the app shows it LIVE in a
/// WebView, and one tap publishes it to the owner's own hosting platform
/// with credentials pulled from the server-side encrypted vault.
library;

/// One deployment of a site artifact to an external hosting platform.
class SiteDeployment {
  const SiteDeployment({
    required this.connector,
    required this.at,
    required this.ok,
    this.url,
    this.repo,
    this.domain,
    this.error,
    this.note,
  });

  final String connector;
  final String at;
  final bool ok;
  final String? url;
  final String? repo;
  final String? domain;
  final String? error;
  final String? note;

  bool get isLive => ok && (url?.isNotEmpty ?? false);

  factory SiteDeployment.fromMap(Map<String, dynamic> m) => SiteDeployment(
        connector: (m['connector'] as String?) ?? '',
        at: (m['at'] as String?) ?? '',
        ok: m['ok'] == true,
        url: m['url'] as String?,
        repo: m['repo'] as String?,
        domain: m['domain'] as String?,
        error: m['error'] as String?,
        note: m['note'] as String?,
      );
}

/// One artifact the agent has built: a hosted site (kind != 'note') or a
/// saved note/report. Sites carry a public URL and deployment history.
class StudioSite {
  const StudioSite({
    required this.id,
    required this.kind,
    required this.title,
    required this.at,
    required this.builder,
    this.url,
    this.bytes = 0,
    this.deployments = const [],
  });

  final String id;
  final String kind;
  final String title;
  final String at;
  final String builder;
  final String? url;
  final int bytes;
  final List<SiteDeployment> deployments;

  bool get isNote => kind == 'note';

  /// Emoji per artifact kind (no external assets needed).
  String get kindIcon {
    switch (kind) {
      case 'landing':
        return '🚀';
      case 'promo':
        return '🎉';
      case 'event':
        return '📅';
      case 'portfolio':
        return '🎨';
      case 'webapp':
        return '⚡';
      case 'report':
        return '📊';
      case 'note':
        return '📝';
      default:
        return '🌐';
    }
  }

  String get kindLabel {
    switch (kind) {
      case 'landing':
        return 'Landing page';
      case 'promo':
        return 'Offer page';
      case 'event':
        return 'Event invite';
      case 'portfolio':
        return 'Portfolio';
      case 'webapp':
        return 'Web app';
      case 'report':
        return 'Report';
      case 'note':
        return 'Note';
      default:
        return 'Site';
    }
  }

  /// Where the artifact is currently live (latest successful deployment).
  SiteDeployment? get latestDeployment {
    for (final d in deployments) {
      if (d.isLive) return d;
    }
    return null;
  }

  factory StudioSite.fromMap(Map<String, dynamic> m) => StudioSite(
        id: (m['id'] as String?) ?? '',
        kind: (m['kind'] as String?) ?? 'landing',
        title: (m['title'] as String?) ?? 'Untitled',
        at: (m['at'] as String?) ?? '',
        builder: (m['builder'] as String?) ?? 'agent',
        url: m['url'] as String?,
        bytes: (m['bytes'] as num?)?.toInt() ?? 0,
        deployments: ((m['deployments'] as List?) ?? const [])
            .whereType<Map>()
            .map((d) => SiteDeployment.fromMap(d.cast<String, dynamic>()))
            .toList(),
      );
}

/// A hosting/domain platform the business can connect (GitHub, Vercel,
/// Firebase Hosting, GoDaddy, Hostinger). Connection status comes from the
/// Worker; credentials themselves never travel back to the app.
class HostingConnector {
  const HostingConnector({
    required this.connector,
    required this.name,
    required this.kind,
    required this.what,
    required this.connected,
    this.connectedLabel,
    this.connectedAt,
  });

  final String connector;
  final String name;
  final String kind; // hosting | hosting+code | domains
  final String what;
  final bool connected;
  final String? connectedLabel;
  final String? connectedAt;

  bool get isRegistrar => kind == 'domains';
  bool get canPublish => connector == 'github' || connector == 'vercel' || connector == 'firebase';

  factory HostingConnector.fromMap(Map<String, dynamic> m) => HostingConnector(
        connector: (m['connector'] as String?) ?? '',
        name: (m['name'] as String?) ?? '',
        kind: (m['kind'] as String?) ?? 'hosting',
        what: (m['what'] as String?) ?? '',
        connected: m['connected'] == true,
        connectedLabel: m['connectedLabel'] as String?,
        connectedAt: m['connectedAt'] as String?,
      );
}

/// Nebula Studio models — built sites, hosting platforms, deployments.
///
/// The Studio is the app's build → preview → publish surface: the agent
/// builds a site (Worker `/sites/<id>`), the app shows it LIVE in a
/// WebView, and one tap publishes it to the owner's own hosting platform
/// with credentials pulled from the server-side encrypted vault.
library;

import 'package:flutter/material.dart';

/// The code an agent just wrote, streamed inside its trace row (v13).
/// The Studio expands it in a mono shell view — the user reads the real
/// code AS the team writes it.
class AgentCodeSnippet {
  const AgentCodeSnippet({
    required this.lang,
    required this.label,
    required this.preview,
    required this.lines,
    required this.chars,
  });

  final String lang;
  final String label;
  final String preview;
  final int lines;
  final int chars;

  factory AgentCodeSnippet.fromMap(Map<String, dynamic> m) => AgentCodeSnippet(
        lang: (m['lang'] as String?) ?? 'html',
        label: (m['label'] as String?) ?? '',
        preview: (m['preview'] as String?) ?? '',
        lines: (m['lines'] as num?)?.toInt() ?? 0,
        chars: (m['chars'] as num?)?.toInt() ?? 0,
      );
}

/// A deliverable event the team produced (design system, section plan,
/// photography, assembled site) — rendered as an artifact chip (v13).
class AgentArtifactEvent {
  const AgentArtifactEvent({
    required this.type,
    required this.label,
    required this.detail,
  });

  final String type;
  final String label;
  final String detail;

  IconData get glyph {
    switch (type) {
      case 'design':
        return Icons.palette_outlined;
      case 'plan':
        return Icons.account_tree_outlined;
      case 'photos':
        return Icons.photo_camera_outlined;
      case 'site':
        return Icons.integration_instructions_outlined;
      default:
        return Icons.dataset_outlined;
    }
  }

  factory AgentArtifactEvent.fromMap(Map<String, dynamic> m) => AgentArtifactEvent(
        type: (m['type'] as String?) ?? 'artifact',
        label: (m['label'] as String?) ?? '',
        detail: (m['detail'] as String?) ?? '',
      );
}

/// One live row from the agent team's trace, streamed by the Worker while
/// a build runs (Agent v9 live runs). The Studio shows these AS they land —
/// the user watches the real team work, not a paced ticker.
class AgentRunRow {
  const AgentRunRow({
    required this.agent,
    required this.emoji,
    required this.role,
    required this.action,
    required this.ok,
    required this.ai,
    required this.ms,
    this.detail = '',
    this.code,
    this.artifact,
  });

  final String agent;
  final String emoji;
  final String role;
  final String action;
  final bool ok;
  final bool ai;
  final int ms;
  final String detail;

  /// v13: the code this row shipped (expandable shell view).
  final AgentCodeSnippet? code;

  /// v13: a deliverable event (design/plan/photos/site).
  final AgentArtifactEvent? artifact;

  factory AgentRunRow.fromMap(Map<String, dynamic> m) => AgentRunRow(
        agent: (m['agent'] as String?) ?? 'Agent',
        emoji: (m['emoji'] as String?) ?? '🤖',
        role: (m['role'] as String?) ?? 'specialist',
        action: (m['action'] as String?) ?? 'working',
        ok: m['ok'] != false,
        ai: m['ai'] == true,
        ms: (m['ms'] as num?)?.toInt() ?? 0,
        detail: (m['detail'] as String?) ?? '',
        code: m['code'] is Map<String, dynamic>
            ? AgentCodeSnippet.fromMap((m['code'] as Map<String, dynamic>))
            : null,
        artifact: m['artifact'] is Map<String, dynamic>
            ? AgentArtifactEvent.fromMap((m['artifact'] as Map<String, dynamic>))
            : null,
      );
}

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
    this.repoUrl,
    this.actionsUrl,
    this.filesCommitted,
  });

  final String connector;
  final String at;
  final bool ok;
  final String? url;
  final String? repo;
  final String? domain;
  final String? error;
  final String? note;

  /// v15 GitHub power push — the repo/Actions links + project size.
  final String? repoUrl;
  final String? actionsUrl;
  final int? filesCommitted;

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
        repoUrl: m['repoUrl'] as String?,
        actionsUrl: m['actionsUrl'] as String?,
        filesCommitted: (m['filesCommitted'] as num?)?.toInt(),
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
    this.sha256,
    this.version = 1,
    this.updatedAt,
    this.lastRefine,
    this.deployments = const [],
  });

  final String id;
  final String kind;
  final String title;
  final String at;
  final String builder;
  final String? url;
  final int bytes;

  /// SHA-256 of the served HTML — the artifact's integrity digest
  /// (verifiable at /sites/<id>/meta and via X-Content-Sha256).
  final String? sha256;

  /// Bumped every refine — the same public URL serves the latest version.
  final int version;
  final String? updatedAt;
  final String? lastRefine;
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

  /// Grok-grade UI icon per artifact kind — monochrome Material glyphs
  /// instead of emoji (emoji in chrome reads as toy-grade).
  IconData get kindGlyph {
    switch (kind) {
      case 'landing':
        return Icons.rocket_launch_outlined;
      case 'promo':
        return Icons.local_offer_outlined;
      case 'event':
        return Icons.event_outlined;
      case 'portfolio':
        return Icons.palette_outlined;
      case 'webapp':
        return Icons.bolt_outlined;
      case 'report':
        return Icons.insert_chart_outlined;
      case 'note':
        return Icons.sticky_note_2_outlined;
      default:
        return Icons.public_outlined;
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
        sha256: m['sha256'] as String?,
        version: (m['version'] as num?)?.toInt() ?? 1,
        updatedAt: m['updated_at'] as String?,
        lastRefine: m['last_refine'] as String?,
        deployments: ((m['deployments'] as List?) ?? const [])
            .whereType<Map>()
            .map((d) => SiteDeployment.fromMap(d.cast<String, dynamic>()))
            .toList(),
      );
}

/// v13 BUILD REPORT — the deterministic handover sheet the team ships
/// with every build: the stack, the technology, the front end, the back
/// end, the quality gates and the crew that made it.
class BuildReport {
  const BuildReport({
    required this.title,
    required this.kind,
    required this.brand,
    required this.url,
    required this.builder,
    required this.bytes,
    required this.buildMs,
    this.overview = '',
    this.stack = const [],
    this.sections = const [],
    this.components = const [],
    this.images = 0,
    this.quality = const {},
    this.agentCount = 0,
    this.aiCalls = 0,
    this.crew = const [],
    this.research = '',
    this.skills = const [],
  });

  final String title;
  final String kind;
  final String brand;
  final String url;
  final String builder;
  final int bytes;
  final int buildMs;
  final String overview;
  final List<(String, String)> stack; // layer → detail
  final List<ReportSection> sections;
  final List<String> components;
  final int images;
  final Map<String, String> quality;
  final int agentCount;
  final int aiCalls;
  final List<(String, String)> crew; // agent → action
  final String research;
  final List<String> skills;

  static BuildReport? fromMap(Map<String, dynamic>? m) {
    if (m == null) return null;
    final qualityRaw = (m['quality'] as Map?)?.cast<String, dynamic>() ?? const {};
    final agents = (m['agents'] as Map?)?.cast<String, dynamic>() ?? const {};
    final research = (m['research'] as Map?)?.cast<String, dynamic>();
    final frontend = (m['frontend'] as Map?)?.cast<String, dynamic>() ?? const {};
    return BuildReport(
      title: (m['title'] as String?) ?? '',
      kind: (m['kind'] as String?) ?? '',
      brand: (m['brand'] as String?) ?? '',
      url: (m['url'] as String?) ?? '',
      builder: (m['builder'] as String?) ?? '',
      bytes: (m['bytes'] as num?)?.toInt() ?? 0,
      buildMs: (m['build_ms'] as num?)?.toInt() ?? 0,
      overview: (m['overview'] as String?) ?? '',
      stack: ((m['stack'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map((s) => ((s['layer'] as String?) ?? '', (s['detail'] as String?) ?? ''))
          .where((s) => s.$1.isNotEmpty)
          .toList(),
      sections: ((frontend['sections']) as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map((s) => ReportSection.fromMap(s))
          .toList(),
      components: ((frontend['components']) as List?)
              ?.whereType<String>()
              .toList() ??
          const <String>[],
      images: (frontend['images'] as num?)?.toInt() ?? 0,
      quality: qualityRaw.map((k, v) => MapEntry(k, v.toString())),
      agentCount: (agents['count'] as num?)?.toInt() ?? 0,
      aiCalls: (agents['ai_calls'] as num?)?.toInt() ?? 0,
      crew: ((agents['crew'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map((c) => ((c['agent'] as String?) ?? '', (c['action'] as String?) ?? ''))
          .toList(),
      research: research == null
          ? ''
          : [
              'mode: ${(research['mode'] as String?) ?? 'live web search'}',
              if (research['queries'] is List && (research['queries'] as List).isNotEmpty)
                'queries: ${(research['queries'] as List).join(' · ')}',
            ].join('  |  '),
      skills: ((m['skills'] as List?) ?? const []).whereType<String>().toList(),
    );
  }
}

/// One section line of the report's front-end breakdown.
class ReportSection {
  const ReportSection({
    required this.id,
    required this.name,
    required this.goal,
    required this.motion,
    this.chars,
  });

  final String id;
  final String name;
  final String goal;
  final String motion;
  final int? chars;

  factory ReportSection.fromMap(Map<String, dynamic> m) => ReportSection(
        id: (m['id'] as String?) ?? '',
        name: (m['name'] as String?) ?? '',
        goal: (m['goal'] as String?) ?? '',
        motion: (m['motion'] as String?) ?? '',
        chars: (m['chars'] as num?)?.toInt(),
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
  bool get isBackend => kind == 'backend';
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

/// v12 BILLING — one plan in the subscription catalog.
class PlanOption {
  const PlanOption({
    required this.id,
    required this.name,
    required this.priceInr,
    required this.tagline,
    required this.perks,
    this.current = false,
  });

  final String id;
  final String name;
  final int priceInr;
  final String tagline;
  final List<String> perks;
  final bool current;

  factory PlanOption.fromMap(Map<String, dynamic> m) => PlanOption(
        id: (m['id'] as String?) ?? '',
        name: (m['name'] as String?) ?? '',
        priceInr: (m['price_inr'] as num?)?.toInt() ?? 0,
        tagline: (m['tagline'] as String?) ?? '',
        perks: ((m['perks'] as List?) ?? const [])
            .whereType<String>()
            .toList(),
        current: m['current'] == true,
      );
}

/// v12 BILLING — the signed-in user's plan + usage snapshot.
class BillingSnapshot {
  const BillingSnapshot({
    required this.plan,
    required this.planName,
    required this.buildsUsed,
    required this.buildsLimit,
    required this.refinesUsed,
    required this.refinesLimit,
    this.status = 'active',
    this.until,
    this.catalog = const [],
  });

  final String plan;
  final String planName;
  final int buildsUsed;
  final int buildsLimit;
  final int refinesUsed;
  final int refinesLimit;
  final String status;
  final String? until;
  final List<PlanOption> catalog;

  int get buildsLeft => (buildsLimit - buildsUsed).clamp(0, buildsLimit);
  double get buildPct =>
      buildsLimit <= 0 ? 0 : (buildsUsed / buildsLimit).clamp(0.0, 1.0);
  bool get low => buildsLeft <= 1;
  bool get expired => status == 'expired';

  factory BillingSnapshot.fromMap(Map<String, dynamic> m) {
    final usage = (m['usage'] as Map?)?.cast<String, dynamic>() ?? const {};
    final limits = (m['limits'] as Map?)?.cast<String, dynamic>() ?? const {};
    return BillingSnapshot(
      plan: (m['plan'] as String?) ?? 'free',
      planName: (m['plan_name'] as String?) ?? 'Free',
      status: (m['status'] as String?) ?? 'active',
      until: m['until'] as String?,
      buildsUsed: (usage['builds'] as num?)?.toInt() ?? 0,
      buildsLimit: (limits['builds_per_month'] as num?)?.toInt() ?? 0,
      refinesUsed: (usage['refines'] as num?)?.toInt() ?? 0,
      refinesLimit: (limits['refines_per_month'] as num?)?.toInt() ?? 0,
      catalog: ((m['catalog'] as List?) ?? const [])
          .whereType<Map>()
          .map((p) => PlanOption.fromMap(p.cast<String, dynamic>()))
          .toList(),
    );
  }
}

/// v15 GITHUB POWER CONNECTOR — a repo on the connected GitHub account.
class GithubRepo {
  const GithubRepo({
    required this.fullName,
    required this.name,
    required this.isPrivate,
    required this.defaultBranch,
    required this.url,
    this.updatedAt,
  });

  final String fullName; // owner/name — what push/trigger calls take
  final String name;
  final bool isPrivate;
  final String defaultBranch;
  final String url;
  final String? updatedAt;

  factory GithubRepo.fromMap(Map<String, dynamic> m) => GithubRepo(
        fullName: (m['full_name'] as String?) ?? '',
        name: (m['name'] as String?) ?? '',
        isPrivate: m['private'] == true,
        defaultBranch: (m['default_branch'] as String?) ?? 'main',
        url: (m['url'] as String?) ?? '',
        updatedAt: m['updated_at'] as String?,
      );
}

/// v15 — one GitHub Actions run (the APK build / deploy status chip).
class WorkflowRun {
  const WorkflowRun({
    required this.id,
    required this.name,
    required this.workflow,
    required this.status,
    required this.branch,
    required this.url,
    this.conclusion,
    this.createdAt,
  });

  final int id;
  final String name;
  final String workflow; // e.g. build-apk.yml
  final String status; // queued | in_progress | completed
  final String? conclusion; // success | failure | null (still running)
  final String branch;
  final String url;
  final String? createdAt;

  bool get isRunning => status != 'completed';
  bool get isGreen => conclusion == 'success';

  factory WorkflowRun.fromMap(Map<String, dynamic> m) => WorkflowRun(
        id: (m['id'] as num?)?.toInt() ?? 0,
        name: (m['name'] as String?) ?? '',
        workflow: (m['workflow'] as String?) ?? '',
        status: (m['status'] as String?) ?? '',
        conclusion: m['conclusion'] as String?,
        branch: (m['branch'] as String?) ?? '',
        url: (m['url'] as String?) ?? '',
        createdAt: m['created_at'] as String?,
      );
}

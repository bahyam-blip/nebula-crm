import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../../core/services/storage_service.dart' show kStorageBaseUrl;

/// One scheduled/planned email inside an AI task.
class MailTaskEmail {
  const MailTaskEmail({
    required this.seq,
    this.sendAt = '',
    this.subject,
    this.campaignId,
    this.status = 'planned',
    this.error,
  });

  final int seq;
  final String sendAt;
  final String? subject;
  final String? campaignId;
  final String status;
  final String? error;

  factory MailTaskEmail.fromMap(Map<String, dynamic> m) => MailTaskEmail(
        seq: (m['seq'] as num?)?.toInt() ?? 0,
        sendAt: (m['sendAt'] as String?) ?? '',
        subject: m['subject'] as String?,
        campaignId: m['campaignId'] as String?,
        status: (m['status'] as String?) ?? 'planned',
        error: m['error'] as String?,
      );
}

/// One AI progress event on a task (what the mailer did and when).
class MailTaskEvent {
  const MailTaskEvent({
    required this.at,
    required this.kind,
    required this.text,
  });

  final String at;
  final String kind; // info | plan | write | send | error | cancel
  final String text;

  factory MailTaskEvent.fromMap(Map<String, dynamic> m) => MailTaskEvent(
        at: (m['at'] as String?) ?? '',
        kind: (m['kind'] as String?) ?? 'info',
        text: (m['text'] as String?) ?? '',
      );
}

/// Derived progress for a task (computed by the Worker).
class MailTaskProgress {
  const MailTaskProgress({
    this.total = 0,
    this.done = 0,
    this.failed = 0,
    this.pending = 0,
    this.nextSendAt = '',
  });

  final int total;
  final int done;
  final int failed;
  final int pending;
  final String nextSendAt;

  factory MailTaskProgress.fromMap(Map<String, dynamic> m) => MailTaskProgress(
        total: (m['total'] as num?)?.toInt() ?? 0,
        done: (m['done'] as num?)?.toInt() ?? 0,
        failed: (m['failed'] as num?)?.toInt() ?? 0,
        pending: (m['pending'] as num?)?.toInt() ?? 0,
        nextSendAt: (m['nextSendAt'] as String?) ?? '',
      );
}

/// An owner instruction given to the AI mailer, with its execution state.
class MailTask {
  const MailTask({
    required this.id,
    required this.instruction,
    required this.status,
    required this.createdAt,
    this.emails = const [],
    this.events = const [],
    this.progress = const MailTaskProgress(),
    this.error,
  });

  final String id;
  final String instruction;
  final String status; // pending|planning|active|done|failed|cancelled
  final String createdAt;
  final List<MailTaskEmail> emails;
  final List<MailTaskEvent> events;
  final MailTaskProgress progress;
  final String? error;

  bool get isActive =>
      status == 'pending' || status == 'planning' || status == 'active';

  bool get isCancelled => status == 'cancelled';

  factory MailTask.fromMap(Map<String, dynamic> m) => MailTask(
        id: (m['id'] as String?) ?? '',
        instruction: (m['instruction'] as String?) ?? '',
        status: (m['status'] as String?) ?? 'pending',
        createdAt: (m['createdAt'] as String?) ?? '',
        emails: ((m['emails'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => MailTaskEmail.fromMap(e.cast<String, dynamic>()))
            .toList(),
        events: ((m['events'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => MailTaskEvent.fromMap(e.cast<String, dynamic>()))
            .toList(),
        progress: MailTaskProgress.fromMap(
            ((m['progress'] as Map?) ?? const {}).cast<String, dynamic>()),
        error: m['error'] as String?,
      );
}

/// Worker + mailer configuration state (what is missing / is it live).
class MailStatus {
  const MailStatus({
    required this.configured,
    required this.missing,
    required this.dryRun,
    this.ready = false,
    this.warnings = const [],
    this.dryRunSource = '',
    this.stateBackend = '',
    this.timezone = 'Asia/Calcutta',
    this.senderEmail = '',
    this.senderName = '',
    this.deliveryMode = 'auto',
    this.suppressions = 0,
    this.businessType,
    this.lastRunAt,
  });

  final bool configured; // can send (MAILERCLOUD_API_KEY present)
  final List<String> missing; // missing for the FULL AI pipeline
  final bool dryRun;
  final bool ready; // full AI pipeline available
  final List<String> warnings;
  final String dryRunSource;
  final String stateBackend;
  final String timezone;
  final String senderEmail; // verified "from" address
  final String senderName;
  final String deliveryMode; // auto | transactional | campaign
  final int suppressions; // auto-learned bad addresses
  final String? businessType;
  final String? lastRunAt;

  factory MailStatus.fromMap(Map<String, dynamic> m) => MailStatus(
        configured: m['configured'] as bool? ?? false,
        missing: ((m['missing'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
        dryRun: m['dryRun'] as bool? ?? true,
        ready: m['ready'] as bool? ?? false,
        warnings: ((m['warnings'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
        dryRunSource: (m['dryRunSource'] as String?) ?? '',
        stateBackend: (m['stateBackend'] as String?) ?? '',
        timezone: (m['timezone'] as String?) ?? 'Asia/Calcutta',
        senderEmail:
            ((m['sender'] as Map?)?['from'] as String?) ?? '',
        senderName:
            ((m['sender'] as Map?)?['fromName'] as String?) ?? '',
        deliveryMode: (m['delivery_mode'] as String?) ?? 'auto',
        suppressions: (m['suppressions'] as num?)?.toInt() ?? 0,
        businessType:
            ((m['business_understood'] as Map?)?['type'] as String?),
        lastRunAt: ((m['last_run'] as Map?)?['at'] as String?),
      );
}

/// Aggregate numbers from the latest analytics snapshot.
class MailAnalytics {
  const MailAnalytics({
    required this.campaigns,
    required this.avgOpenRate,
    required this.avgClickRate,
    this.bestSendHour,
    this.recommendations = const [],
  });

  final int campaigns;
  final double avgOpenRate;
  final double avgClickRate;
  final int? bestSendHour;
  final List<String> recommendations;

  factory MailAnalytics.fromMap(Map<String, dynamic> m) {
    final list = ((m['campaigns'] as List?) ?? const [])
        .whereType<Map>()
        .map((c) => c.cast<String, dynamic>())
        .toList();
    double avg(String key) {
      final vals = list
          .map((c) => (c[key] as num?)?.toDouble())
          .whereType<double>()
          .toList();
      if (vals.isEmpty) return 0;
      return vals.reduce((a, b) => a + b) / vals.length;
    }

    final learnings = (m['learnings'] as Map?)?.cast<String, dynamic>();
    return MailAnalytics(
      campaigns: list.length,
      avgOpenRate: avg('open_rate'),
      avgClickRate: avg('click_rate'),
      bestSendHour: (learnings?['best_send_hour'] as num?)?.toInt(),
      recommendations: ((learnings?['recommendations'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
    );
  }
}

/// The AI mailer's long-term memory about the business — what it sells,
/// who buys, the brand voice, and the creative playbook it has learned
/// from real campaign results. Owner-taught facts always win.
class MailMemory {
  const MailMemory({
    this.businessType = '',
    this.industry = '',
    this.products = const [],
    this.audience = '',
    this.tone = '',
    this.offers = const [],
    this.insights = const [],
    this.notes = const [],
    this.updatedAt = '',
  });

  final String businessType;
  final String industry;
  final List<String> products;
  final String audience;
  final String tone;
  final List<String> offers;
  final List<MailInsight> insights;
  final List<String> notes;
  final String updatedAt;

  bool get isEmpty =>
      businessType.isEmpty &&
      industry.isEmpty &&
      products.isEmpty &&
      audience.isEmpty &&
      tone.isEmpty &&
      offers.isEmpty &&
      insights.isEmpty &&
      notes.isEmpty;

  int get factCount =>
      (businessType.isEmpty ? 0 : 1) +
      (industry.isEmpty ? 0 : 1) +
      (audience.isEmpty ? 0 : 1) +
      (tone.isEmpty ? 0 : 1) +
      products.length +
      offers.length;

  factory MailMemory.fromMap(Map<String, dynamic> m) {
    final facts = ((m['facts'] as Map?) ?? const {}).cast<String, dynamic>();
    List<String> strList(dynamic v) => ((v as List?) ?? const [])
        .map((e) => e.toString())
        .toList();
    return MailMemory(
      businessType: (facts['business_type'] as String?) ?? '',
      industry: (facts['industry'] as String?) ?? '',
      products: strList(facts['products']),
      audience: (facts['audience'] as String?) ?? '',
      tone: (facts['tone'] as String?) ?? '',
      offers: strList(facts['offers']),
      insights: ((m['insights'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => MailInsight.fromMap(e.cast<String, dynamic>()))
          .toList(),
      notes: strList(m['notes']),
      updatedAt: (m['updatedAt'] as String?) ?? '',
    );
  }
}

/// One learned lesson in the creative playbook.
class MailInsight {
  const MailInsight({
    required this.text,
    this.kind = 'observation',
    this.weight = 1,
    this.at = '',
  });

  final String text;
  final String kind; // recommendation | subject | timing | winner | flop | ...
  final int weight;
  final String at;

  factory MailInsight.fromMap(Map<String, dynamic> m) => MailInsight(
        text: (m['text'] as String?) ?? '',
        kind: (m['kind'] as String?) ?? 'observation',
        weight: (m['weight'] as num?)?.toInt() ?? 1,
        at: (m['at'] as String?) ?? '',
      );
}

class MailApiException implements Exception {
  MailApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Client for the Worker's AI-mailer endpoints (/v1/mail/*).
///
/// Same pattern as the AI assistant service: the caller's Firebase ID token
/// proves identity; the Worker enforces the campaign-manager roles.
class MailApiService {
  MailApiService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = (baseUrl ?? kStorageBaseUrl).replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _baseUrl;

  Future<String> _idToken() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw MailApiException('Please sign in first.');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw MailApiException('Could not verify your session.');
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
              .timeout(const Duration(seconds: 60));
          break;
        case 'DELETE':
          res = await _client
              .delete(uri, headers: headers)
              .timeout(const Duration(seconds: 60));
          break;
        default:
          res = await _client
              .get(uri, headers: headers)
              .timeout(const Duration(seconds: 60));
      }
    } catch (e) {
      throw MailApiException('Could not reach the mailer. $e');
    }

    if (res.statusCode == 403) {
      throw MailApiException(
          'Your account does not have access to this feature.');
    }
    if (res.statusCode >= 400) {
      String detail = 'Mailer error (${res.statusCode}).';
      try {
        final map = jsonDecode(res.body) as Map<String, dynamic>;
        final e =
            (map['error'] ?? map['detail'] ?? map['message'])?.toString();
        if (e != null && e.isNotEmpty) detail = e;
      } catch (_) {}
      throw MailApiException(detail);
    }
    if (res.body.isEmpty) return const {};
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<MailStatus> status() async =>
      MailStatus.fromMap(await _send('GET', '/v1/mail/status'));

  Future<MailTask> createTask(String instruction) async {
    final map = await _send('POST', '/v1/mail/tasks',
        body: {'instruction': instruction, 'source': 'app'});
    return MailTask.fromMap(
        (map['task'] as Map?)?.cast<String, dynamic>() ?? {});
  }

  Future<List<MailTask>> tasks() async {
    final map = await _send('GET', '/v1/mail/tasks');
    return ((map['tasks'] as List?) ?? const [])
        .whereType<Map>()
        .map((t) => MailTask.fromMap(t.cast<String, dynamic>()))
        .toList();
  }

  Future<void> deleteTask(String id) async {
    await _send('DELETE', '/v1/mail/tasks/$id');
  }

  /// Cancel a live task — nothing further will send for it.
  Future<MailTask> cancelTask(String id) async {
    final map = await _send('POST', '/v1/mail/tasks/$id/cancel', body: {});
    return MailTask.fromMap(
        (map['task'] as Map?)?.cast<String, dynamic>() ?? {});
  }

  /// Retry a failed task. A planning failure goes back to the AI; a partial
  /// send failure requeues only the failed emails (sent ones never resend).
  Future<MailTask> retryTask(String id) async {
    final map = await _send('POST', '/v1/mail/tasks/$id/retry', body: {});
    return MailTask.fromMap(
        (map['task'] as Map?)?.cast<String, dynamic>() ?? {});
  }

  Future<Map<String, dynamic>> run({bool force = false}) async {
    return _send('POST', '/v1/mail/run?force=${force ? 1 : 0}', body: {});
  }

  Future<Map<String, dynamic>> syncContacts() async {
    return _send('POST', '/v1/mail/sync', body: {});
  }

  Future<MailAnalytics?> analytics({bool refresh = false}) async {
    final map =
        await _send('GET', '/v1/mail/analytics?refresh=${refresh ? 1 : 0}');
    if (map.containsKey('message')) return null; // "No analytics yet"
    return MailAnalytics.fromMap(map);
  }

  /// Set the owner dry-run override. `null` resets to the server default.
  Future<void> setDryRun(bool? dryRun) async {
    await _send('POST', '/v1/mail/config', body: {'dry_run': dryRun});
  }

  /// What the AI currently knows about the business (facts + playbook).
  Future<MailMemory> memory() async {
    final map = await _send('GET', '/v1/mail/memory');
    return MailMemory.fromMap(
        ((map['memory'] as Map?) ?? const {}).cast<String, dynamic>());
  }

  /// Teach the AI: structured facts and/or a free-form note. The note is
  /// distilled into durable facts + insights by the AI on the server.
  Future<MailMemory> teach({
    String? businessType,
    String? industry,
    String? audience,
    String? tone,
    List<String>? products,
    List<String>? offers,
    String? note,
  }) async {
    final facts = <String, dynamic>{
      if (businessType != null && businessType.trim().isNotEmpty)
        'business_type': businessType.trim(),
      if (industry != null && industry.trim().isNotEmpty)
        'industry': industry.trim(),
      if (audience != null && audience.trim().isNotEmpty) 'audience': audience.trim(),
      if (tone != null && tone.trim().isNotEmpty) 'tone': tone.trim(),
      if (products != null && products.where((p) => p.trim().isNotEmpty).isNotEmpty)
        'products': products,
      if (offers != null && offers.where((o) => o.trim().isNotEmpty).isNotEmpty)
        'offers': offers,
    };
    final map = await _send('POST', '/v1/mail/memory', body: {
      if (facts.isNotEmpty) 'facts': facts,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
    return MailMemory.fromMap(
        ((map['memory'] as Map?) ?? const {}).cast<String, dynamic>());
  }

  /// Wipe the business memory (the AI starts learning from scratch).
  Future<void> resetMemory() async {
    await _send('POST', '/v1/mail/memory/reset', body: {});
  }

  /// Send ONE real email to [to] through the transactional endpoint
  /// (email-api.mailercloud.com/email) — the go-live check. Returns the
  /// full provider reply: {ok, sent_to, from, endpoint, provider, next_step}
  /// or {ok:false, provider_status, error, message} on failure.
  Future<Map<String, dynamic>> sendTestEmail(String to, {String? subject}) async {
    return _send('POST', '/v1/mail/test', body: {
      'to': to,
      if (subject != null && subject.trim().isNotEmpty) 'subject': subject,
    });
  }
}

final mailApiProvider = Provider<MailApiService>((ref) => MailApiService());

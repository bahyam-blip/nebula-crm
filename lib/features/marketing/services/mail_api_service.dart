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
    this.delivered,
    this.failed,
    this.deferred,
    this.recipients = const [],
  });

  final int seq;
  final String sendAt;
  final String? subject;
  final String? campaignId;
  final String status;
  final String? error;

  /// Provider truth after the send ran: accepted / rejected / retrying.
  /// Null until the email actually goes out.
  final int? delivered;
  final int? failed;
  final int? deferred;
  final List<String> recipients;

  bool get hasDelivery => delivered != null || failed != null || deferred != null;

  String get deliveryLabel {
    final d = delivered ?? 0;
    final f = failed ?? 0;
    final x = deferred ?? 0;
    final parts = <String>['$d delivered'];
    if (f > 0) parts.add('$f failed');
    if (x > 0) parts.add('$x pending retry');
    return parts.join(', ');
  }

  factory MailTaskEmail.fromMap(Map<String, dynamic> m) {
    final delivery = (m['delivery'] as Map?)?.cast<String, dynamic>();
    int? n(String k) =>
        delivery == null ? null : (delivery[k] as num?)?.toInt();
    return MailTaskEmail(
      seq: (m['seq'] as num?)?.toInt() ?? 0,
      sendAt: (m['sendAt'] as String?) ?? '',
      subject: m['subject'] as String?,
      campaignId: m['campaignId'] as String?,
      status: (m['status'] as String?) ?? 'planned',
      error: m['error'] as String?,
      delivered: n('sent'),
      failed: n('failed'),
      deferred: n('deferred'),
      recipients: ((m['recipients'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
    );
  }
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
    this.totals = const MailTotals(),
  });

  final int campaigns;
  final double avgOpenRate;
  final double avgClickRate;
  final int? bestSendHour;
  final List<String> recommendations;

  /// Fleet-wide delivery truth the owner asked for: how many emails went
  /// out, how many were delivered, how many people opened, how many failed.
  final MailTotals totals;

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

    int intOf(dynamic v) => v is num ? v.toInt() : (int.tryParse('$v') ?? 0);

    final learnings = (m['learnings'] as Map?)?.cast<String, dynamic>();
    final t = ((m['totals'] as Map?) ?? const {}).cast<String, dynamic>();
    return MailAnalytics(
      campaigns: (t['campaigns'] as num?)?.toInt() ?? list.length,
      avgOpenRate: avg('open_rate'),
      avgClickRate: avg('click_rate'),
      bestSendHour: (learnings?['best_send_hour'] as num?)?.toInt(),
      recommendations: ((learnings?['recommendations'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      totals: MailTotals(
        recipients: intOf(t['recipients']),
        delivered: intOf(t['delivered']),
        notDelivered: intOf(t['not_delivered']),
        opens: intOf(t['opens']),
        clicks: intOf(t['clicks']),
        deliveryRate: (t['delivery_rate'] as num?)?.toDouble(),
      ),
    );
  }
}

/// Summed delivery numbers across every recent campaign.
class MailTotals {
  const MailTotals({
    this.recipients = 0,
    this.delivered = 0,
    this.notDelivered = 0,
    this.opens = 0,
    this.clicks = 0,
    this.deliveryRate,
  });

  final int recipients;
  final int delivered;
  final int notDelivered;
  final int opens;
  final int clicks;
  final double? deliveryRate;
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

/// The owner's business identity — every email is sent under THIS brand
/// (From name, logo, footer, signature) and the AI writes all copy for it.
class BusinessProfile {
  const BusinessProfile({
    this.businessName = '',
    this.tagline = '',
    this.about = '',
    this.industry = '',
    this.logoUrl = '',
    this.brandColor = '',
    this.products = const [],
    this.audience = '',
    this.tone = '',
    this.offers = const [],
    this.website = '',
    this.address = '',
    this.phone = '',
    this.contactEmail = '',
    this.senderName = '',
    this.signatureName = '',
    this.defaultStyle = '',
    this.updatedAt = '',
  });

  final String businessName;
  final String tagline;
  final String about;
  final String industry;
  final String logoUrl;
  final String brandColor;
  final List<String> products;
  final String audience;
  final String tone;
  final List<String> offers;
  final String website;
  final String address;
  final String phone;
  final String contactEmail;
  final String senderName;
  final String signatureName;
  final String defaultStyle;
  final String updatedAt;

  bool get isEmpty => businessName.isEmpty && tagline.isEmpty && about.isEmpty;

  /// The name emails are actually sent as (sender name > business name).
  String get effectiveSenderName =>
      senderName.isNotEmpty ? senderName : (businessName.isNotEmpty ? businessName : '');

  /// The signature block: signature name > "Team <business>".
  String get effectiveSignature => signatureName.isNotEmpty
      ? signatureName
      : (businessName.isNotEmpty ? 'Team $businessName' : '');

  factory BusinessProfile.fromMap(Map<String, dynamic> m) {
    List<String> strList(dynamic v) =>
        ((v as List?) ?? const []).map((e) => e.toString()).toList();
    return BusinessProfile(
      businessName: (m['business_name'] as String?) ?? '',
      tagline: (m['tagline'] as String?) ?? '',
      about: (m['about'] as String?) ?? '',
      industry: (m['industry'] as String?) ?? '',
      logoUrl: (m['logo_url'] as String?) ?? '',
      brandColor: (m['brand_color'] as String?) ?? '',
      products: strList(m['products']),
      audience: (m['audience'] as String?) ?? '',
      tone: (m['tone'] as String?) ?? '',
      offers: strList(m['offers']),
      website: (m['website'] as String?) ?? '',
      address: (m['address'] as String?) ?? '',
      phone: (m['phone'] as String?) ?? '',
      contactEmail: (m['contact_email'] as String?) ?? '',
      senderName: (m['sender_name'] as String?) ?? '',
      signatureName: (m['signature_name'] as String?) ?? '',
      defaultStyle: (m['default_style'] as String?) ?? '',
      updatedAt: (m['updatedAt'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toPatch() => {
        'business_name': businessName,
        'tagline': tagline,
        'about': about,
        'industry': industry,
        'logo_url': logoUrl,
        'brand_color': brandColor,
        'products': products,
        'audience': audience,
        'tone': tone,
        'offers': offers,
        'website': website,
        'address': address,
        'phone': phone,
        'contact_email': contactEmail,
        'sender_name': senderName,
        'signature_name': signatureName,
        'default_style': defaultStyle,
      };

  BusinessProfile copyWith({
    String? businessName,
    String? tagline,
    String? about,
    String? industry,
    String? logoUrl,
    String? brandColor,
    List<String>? products,
    String? audience,
    String? tone,
    List<String>? offers,
    String? website,
    String? address,
    String? phone,
    String? contactEmail,
    String? senderName,
    String? signatureName,
    String? defaultStyle,
  }) =>
      BusinessProfile(
        businessName: businessName ?? this.businessName,
        tagline: tagline ?? this.tagline,
        about: about ?? this.about,
        industry: industry ?? this.industry,
        logoUrl: logoUrl ?? this.logoUrl,
        brandColor: brandColor ?? this.brandColor,
        products: products ?? this.products,
        audience: audience ?? this.audience,
        tone: tone ?? this.tone,
        offers: offers ?? this.offers,
        website: website ?? this.website,
        address: address ?? this.address,
        phone: phone ?? this.phone,
        contactEmail: contactEmail ?? this.contactEmail,
        senderName: senderName ?? this.senderName,
        signatureName: signatureName ?? this.signatureName,
        defaultStyle: defaultStyle ?? this.defaultStyle,
        updatedAt: updatedAt,
      );
}

/// Resolved brand info the Worker returns alongside the profile.
class MailBrand {
  const MailBrand({
    this.name = '',
    this.color = '#6C8CFF',
    this.fromName = '',
    this.signature = '',
    this.website = '',
    this.branded = false,
    this.defaultStyle = 'modern',
    this.templateStyles = const ['modern', 'classic', 'bold', 'minimal', 'gradient'],
  });

  final String name;
  final String color;
  final String fromName;
  final String signature;
  final String website;
  final bool branded;
  final String defaultStyle;
  final List<String> templateStyles;

  factory MailBrand.fromMap(Map<String, dynamic> m) => MailBrand(
        name: (m['name'] as String?) ?? '',
        color: (m['color'] as String?) ?? '#6C8CFF',
        fromName: (m['fromName'] as String?) ?? '',
        signature: (m['signature'] as String?) ?? '',
        website: (m['website'] as String?) ?? '',
        branded: m['branded'] as bool? ?? false,
        defaultStyle: (m['defaultStyle'] as String?) ?? 'modern',
        templateStyles: ((m['template_styles'] as List?) ??
                const ['modern', 'classic', 'bold', 'minimal', 'gradient'])
            .map((e) => e.toString())
            .toList(),
      );
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

  /// The business profile emails are branded with.
  Future<BusinessProfile> businessProfile() async {
    final map = await _send('GET', '/v1/mail/business');
    return BusinessProfile.fromMap(
        ((map['profile'] as Map?) ?? const {}).cast<String, dynamic>());
  }

  /// Save (partial patches merge server-side) the business profile. Returns
  /// the resolved brand so the UI can confirm "sending as <brand>".
  Future<MailBrand> saveBusinessProfile(BusinessProfile p) async {
    final map = await _send('POST', '/v1/mail/business', body: p.toPatch());
    return MailBrand.fromMap(
        ((map['brand'] as Map?) ?? const {}).cast<String, dynamic>());
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

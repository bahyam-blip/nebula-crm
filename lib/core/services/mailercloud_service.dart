import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'storage_service.dart' show kStorageBaseUrl;

/// A campaign returned by the MailerCloud Marketing API.
///
/// This is a lightweight view of what MailerCloud reports — name,
/// subject, status, and aggregate metrics. It complements the
/// Firestore-stored [Campaign] model, which holds what the CRM user
/// configured before the send.
class MailerCloudCampaign {
  const MailerCloudCampaign({
    required this.id,
    this.name = '',
    this.subject = '',
    this.status = '',
    this.sent = 0,
    this.delivered = 0,
    this.opens = 0,
    this.clicks = 0,
    this.bounces = 0,
    this.unsubscribes = 0,
    this.createdAt,
  });

  final String id;
  final String name;
  final String subject;
  final String status;
  final int sent;
  final int delivered;
  final int opens;
  final int clicks;
  final int bounces;
  final int unsubscribes;
  final DateTime? createdAt;

  double get openRate => sent > 0 ? (opens / sent) * 100 : 0;
  double get clickRate => sent > 0 ? (clicks / sent) * 100 : 0;

  factory MailerCloudCampaign.fromMap(Map<String, dynamic> m) {
    return MailerCloudCampaign(
      id: (m['id'] ?? m['campaign_id'] ?? '').toString(),
      name: (m['name'] ?? m['campaign_name'] ?? '').toString(),
      subject: (m['subject'] ?? '').toString(),
      status: (m['status'] ?? '').toString(),
      sent: _parseInt(m['sent'] ?? m['total_sent']),
      delivered: _parseInt(m['delivered'] ?? m['total_delivered']),
      opens: _parseInt(m['opens'] ?? m['total_opens']),
      clicks: _parseInt(m['clicks'] ?? m['total_clicks']),
      bounces: _parseInt(m['bounces'] ?? m['total_bounces']),
      unsubscribes: _parseInt(m['unsubscribes'] ?? m['total_unsubscribes']),
      createdAt: _parseDate(m['created_at'] ?? m['scheduled_at']),
    );
  }

  static int _parseInt(dynamic v) {
    if (v is int) return v;
    if (v is String) return int.tryParse(v) ?? 0;
    if (v is double) return v.toInt();
    return 0;
  }

  static DateTime? _parseDate(dynamic v) {
    if (v == null) return null;
    if (v is String) return DateTime.tryParse(v);
    return null;
  }
}

/// Talks to the MailerCloud integration through the Cloudflare Worker.
///
/// The Worker holds the MailerCloud API key as a secret; the Flutter app
/// never sees it. This service calls two Worker routes:
///   GET  /v1/mailercloud/campaigns — list recent campaigns + stats
///   POST /v1/mailercloud/send-daily — (cron only) trigger a daily send
///
/// The app uses [fetchCampaigns] to show real MailerCloud send metrics
/// on the marketing screen, alongside the Firestore-stored campaigns.
class MailerCloudService {
  MailerCloudService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl =
            (baseUrl ?? kStorageBaseUrl).replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _baseUrl;

  static const Duration _timeout = Duration(seconds: 30);

  Future<String> _idToken() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      throw Exception('You must be signed in to view MailerCloud campaigns.');
    }
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw Exception('Could not obtain an auth token.');
    }
    return token;
  }

  /// Fetch recent MailerCloud campaigns with send metrics.
  ///
  /// Returns an empty list if MailerCloud is not yet configured on the
  /// Worker, so the UI can gracefully show a "not configured" state.
  Future<List<MailerCloudCampaign>> fetchCampaigns() async {
    final token = await _idToken();

    final res = await _client
        .get(
          Uri.parse('$_baseUrl/v1/mailercloud/campaigns'),
          headers: {
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
          },
        )
        .timeout(_timeout);

    if (res.statusCode == 503) {
      // MailerCloud not configured — return empty so the UI can show a hint.
      return [];
    }
    if (res.statusCode != 200) {
      throw Exception('Failed to load MailerCloud campaigns (${res.statusCode}).');
    }

    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final list = body['campaigns'] as List? ?? [];
    return list
        .map((e) => MailerCloudCampaign.fromMap(e as Map<String, dynamic>))
        .toList();
  }
}

final mailerCloudServiceProvider = Provider<MailerCloudService>((ref) {
  return MailerCloudService();
});

/// Fetches MailerCloud campaigns on demand.
///
/// Used on the campaigns screen to show real send metrics (opens, clicks,
/// bounces) alongside the Firestore-stored campaign configurations.
final mailerCloudCampaignsProvider =
    FutureProvider<List<MailerCloudCampaign>>((ref) async {
  final service = ref.watch(mailerCloudServiceProvider);
  return service.fetchCampaigns();
});

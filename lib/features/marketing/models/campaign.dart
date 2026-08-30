import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

import '../../../core/services/remote/data_codec.dart';

/// Marketing campaign channel.
enum CampaignChannel { email, sms, push, inApp, whatsapp }

extension CampaignChannelX on CampaignChannel {
  String get label => name.toUpperCase();
}

/// A marketing campaign in `campaigns/{campaignId}`.
class Campaign extends Equatable {
  const Campaign({
    required this.id,
    required this.name,
    required this.channel,
    this.status = 'draft',
    this.ownerId,
    this.teamId,
    this.audienceSegmentIds = const [],
    this.audienceCount = 0,
    this.subject,
    this.previewText,
    this.bodyHtml,
    this.bodyPlainText,
    this.ctaLabel,
    this.ctaUrl,
    this.dripSequence = const [],
    this.abVariantOf,
    this.scheduleType = 'manual', // manual | once | recurring
    this.scheduledAt,
    this.startedAt,
    this.completedAt,
    this.metrics = const CampaignMetrics(),
    this.createdAt,
    this.updatedAt,
    this.tags = const [],
  });

  final String id;
  final String name;
  final CampaignChannel channel;
  final String status;
  final String? ownerId;
  final String? teamId;
  final List<String> audienceSegmentIds;
  final int audienceCount;
  final String? subject;
  final String? previewText;
  final String? bodyHtml;
  final String? bodyPlainText;
  final String? ctaLabel;
  final String? ctaUrl;
  final List<DripStep> dripSequence;
  final String? abVariantOf;
  final String scheduleType;
  final DateTime? scheduledAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final CampaignMetrics metrics;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final List<String> tags;

  factory Campaign.fromFirestore(DataDoc doc) {
    final data = doc.data;
    return Campaign(
      id: doc.id,
      name: data['name'] as String? ?? '',
      channel: _parseChannel(data['channel'] as String?),
      status: data['status'] as String? ?? 'draft',
      ownerId: data['ownerId'] as String?,
      teamId: data['teamId'] as String?,
      audienceSegmentIds:
          stringList(data['audienceSegmentIds']),
      audienceCount: data['audienceCount'] as int? ?? 0,
      subject: data['subject'] as String?,
      previewText: data['previewText'] as String?,
      bodyHtml: data['bodyHtml'] as String?,
      bodyPlainText: data['bodyPlainText'] as String?,
      ctaLabel: data['ctaLabel'] as String?,
      ctaUrl: data['ctaUrl'] as String?,
      dripSequence: (data['dripSequence'] as List? ?? const [])
          .map((e) => DripStep.fromMap(e as Map<String, dynamic>))
          .toList(),
      abVariantOf: data['abVariantOf'] as String?,
      scheduleType: data['scheduleType'] as String? ?? 'manual',
      scheduledAt: flexTs(data['scheduledAt']),
      startedAt: flexTs(data['startedAt']),
      completedAt: flexTs(data['completedAt']),
      metrics: CampaignMetrics.fromMap(
        data['metrics'] as Map<String, dynamic>? ?? const {},
      ),
      createdAt: flexTs(data['createdAt']),
      updatedAt: flexTs(data['updatedAt']),
      tags: stringList(data['tags']),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'name': name,
        'channel': channel.name,
        'status': status,
        'ownerId': ownerId,
        'teamId': teamId,
        'audienceSegmentIds': audienceSegmentIds,
        'audienceCount': audienceCount,
        'subject': subject,
        'previewText': previewText,
        'bodyHtml': bodyHtml,
        'bodyPlainText': bodyPlainText,
        'ctaLabel': ctaLabel,
        'ctaUrl': ctaUrl,
        'dripSequence': dripSequence.map((e) => e.toMap()).toList(),
        'abVariantOf': abVariantOf,
        'scheduleType': scheduleType,
        'scheduledAt':
            scheduledAt != null ? Timestamp.fromDate(scheduledAt!) : null,
        'startedAt':
            startedAt != null ? Timestamp.fromDate(startedAt!) : null,
        'completedAt':
            completedAt != null ? Timestamp.fromDate(completedAt!) : null,
        'metrics': metrics.toMap(),
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : const ServerTimestamp(),
        'updatedAt': const ServerTimestamp(),
        'tags': tags,
      };

  /// Derived: open rate as percent.
  double get openRate => metrics.sent > 0
      ? (metrics.opens / metrics.sent) * 100
      : 0;

  /// Derived: click rate as percent.
  double get clickRate => metrics.sent > 0
      ? (metrics.clicks / metrics.sent) * 100
      : 0;

  /// Derived: conversion rate as percent.
  double get conversionRate => metrics.sent > 0
      ? (metrics.conversions / metrics.sent) * 100
      : 0;

  static CampaignChannel _parseChannel(String? s) {
    return CampaignChannel.values.firstWhere(
      (e) => e.name == s,
      orElse: () => CampaignChannel.email,
    );
  }

  @override
  List<Object?> get props => [id, name, channel, status, ownerId, scheduledAt];
}

/// Aggregated campaign metrics (denormalized for fast list reads).
class CampaignMetrics extends Equatable {
  const CampaignMetrics({
    this.sent = 0,
    this.delivered = 0,
    this.opens = 0,
    this.clicks = 0,
    this.conversions = 0,
    this.bounces = 0,
    this.unsubscribes = 0,
    this.failed = 0,
    this.deferred = 0,
    this.revenue = 0,
    this.lastOpenAt = '',
    this.lastOpenEmail = '',
    this.lastClickAt = '',
    this.lastClickEmail = '',
    this.openedSample = const [],
    this.clickedSample = const [],
  });

  final int sent;
  final int delivered;
  final int opens;
  final int clicks;
  final int conversions;
  final int bounces;
  final int unsubscribes;

  /// Provider rejected the address at send time (hard failure).
  final int failed;

  /// Temporarily unavailable mailbox — retried by the provider, still counts
  /// as "not delivered" until it lands.
  final int deferred;
  final double revenue;

  // ── Engagement evidence (tracking pixel / click redirect) ──────
  /// ISO timestamp of the most recent verified open — empty when none.
  final String lastOpenAt;

  /// Address that opened last (resolved server-side from the token map).
  final String lastOpenEmail;
  final String lastClickAt;
  final String lastClickEmail;

  /// Newest-first [{email, at}] engagement trail (up to 24 rows).
  final List<Map<String, String>> openedSample;
  final List<Map<String, String>> clickedSample;

  /// True when ANY human engagement has been observed for this campaign —
  /// the owner's "are these real deliveries?" answer at a glance.
  bool get hasEngagement =>
      opens > 0 || clicks > 0 || lastOpenAt.isNotEmpty || lastClickAt.isNotEmpty;

  /// Emails that did NOT reach an inbox: everything sent minus everything
  /// confirmed delivered. Falls back to failed+deferred when the sender
  /// didn't stamp a delivered count.
  int get notDelivered {
    if (sent > 0) return (sent - delivered).clamp(0, sent).toInt();
    return (failed + deferred).clamp(0, 1 << 31).toInt();
  }

  /// Tolerant: provider/analytics numbers may arrive as double (12.0) —
  /// a hard `as int?` would throw for the whole metrics map.
  static int _int(dynamic v) => v is num ? v.toInt() : (int.tryParse('$v') ?? 0);

  static String _str(dynamic v) => v == null ? '' : '$v';

  static List<Map<String, String>> _sample(dynamic v) {
    if (v is! List) return const [];
    return v
        .whereType<Map>()
        .map((row) => {
              'email': _str(row['email']),
              'at': _str(row['at']),
            })
        .where((row) => row['email']!.isNotEmpty)
        .toList();
  }

  factory CampaignMetrics.fromMap(Map<String, dynamic> m) => CampaignMetrics(
        sent: _int(m['sent']),
        delivered: _int(m['delivered']),
        opens: _int(m['opens']),
        clicks: _int(m['clicks']),
        conversions: _int(m['conversions']),
        bounces: _int(m['bounces']),
        unsubscribes: _int(m['unsubscribes']),
        failed: _int(m['failed']),
        deferred: _int(m['deferred']),
        revenue: (m['revenue'] as num?)?.toDouble() ?? 0,
        lastOpenAt: _str(m['lastOpenAt']),
        lastOpenEmail: _str(m['lastOpenEmail']),
        lastClickAt: _str(m['lastClickAt']),
        lastClickEmail: _str(m['lastClickEmail']),
        openedSample: _sample(m['openedSample']),
        clickedSample: _sample(m['clickedSample']),
      );

  Map<String, dynamic> toMap() => {
        'sent': sent,
        'delivered': delivered,
        'opens': opens,
        'clicks': clicks,
        'conversions': conversions,
        'bounces': bounces,
        'unsubscribes': unsubscribes,
        'failed': failed,
        'deferred': deferred,
        'revenue': revenue,
      };

  @override
  List<Object?> get props => [
        sent, delivered, opens, clicks, conversions,
        bounces, unsubscribes, failed, deferred, revenue,
      ];
}

/// A single step in a drip sequence.
class DripStep extends Equatable {
  const DripStep({
    required this.id,
    required this.delayHours,
    required this.subject,
    this.bodyHtml,
    this.ctaLabel,
    this.ctaUrl,
    this.condition,
  });

  final String id;
  final int delayHours;
  final String subject;
  final String? bodyHtml;
  final String? ctaLabel;
  final String? ctaUrl;
  final String? condition; // e.g. "opened_previous" — empty for unconditional

  factory DripStep.fromMap(Map<String, dynamic> m) => DripStep(
        id: m['id'] as String? ?? '',
        delayHours: m['delayHours'] as int? ?? 24,
        subject: m['subject'] as String? ?? '',
        bodyHtml: m['bodyHtml'] as String?,
        ctaLabel: m['ctaLabel'] as String?,
        ctaUrl: m['ctaUrl'] as String?,
        condition: m['condition'] as String?,
      );

  Map<String, dynamic> toMap() => {
        'id': id,
        'delayHours': delayHours,
        'subject': subject,
        'bodyHtml': bodyHtml,
        'ctaLabel': ctaLabel,
        'ctaUrl': ctaUrl,
        'condition': condition,
      };

  @override
  List<Object?> get props => [id, delayHours, subject, condition];
}

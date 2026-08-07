import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

import '../../auth/models/app_user.dart';

/// Contact lifecycle stage.
enum ContactStatus { subscriber, lead, mql, sql, opportunity, customer, churned }

extension ContactStatusX on ContactStatus {
  String get label => name.toUpperCase();
  bool get isCustomer => this == ContactStatus.customer;
}

/// A contact / lead in `contacts/{contactId}`.
///
/// Designed for 360° view: tags, segments, social, lifecycle, owner,
/// and denormalized activity counts for fast list rendering.
class Contact extends Equatable {
  const Contact({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.company,
    this.jobTitle,
    this.photoUrl,
    this.status = ContactStatus.lead,
    this.ownerId,
    this.teamId,
    this.tags = const [],
    this.segments = const [],
    this.linkedin,
    this.twitter,
    this.website,
    this.address,
    this.notes,
    this.leadScore,
    this.lifetimeValue = 0,
    this.lastActivityAt,
    this.createdAt,
    this.updatedAt,
    this.customFields = const {},
    this.activityCount = 0,
    this.openDealsCount = 0,
  });

  final String id;
  final String name;
  final String? email;
  final String? phone;
  final String? company;
  final String? jobTitle;
  final String? photoUrl;
  final ContactStatus status;
  final String? ownerId;
  final String? teamId;
  final List<String> tags;
  final List<String> segments;
  final String? linkedin;
  final String? twitter;
  final String? website;
  final String? address;
  final String? notes;
  final double? leadScore;
  final double lifetimeValue;
  final DateTime? lastActivityAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final Map<String, dynamic> customFields;
  final int activityCount;
  final int openDealsCount;

  factory Contact.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Contact(
      id: doc.id,
      name: data['name'] as String? ?? '',
      email: data['email'] as String?,
      phone: data['phone'] as String?,
      company: data['company'] as String?,
      jobTitle: data['jobTitle'] as String?,
      photoUrl: data['photoUrl'] as String?,
      status: _parseStatus(data['status'] as String?),
      ownerId: data['ownerId'] as String?,
      teamId: data['teamId'] as String?,
      tags: List<String>.from(data['tags'] as List? ?? const []),
      segments: List<String>.from(data['segments'] as List? ?? const []),
      linkedin: data['linkedin'] as String?,
      twitter: data['twitter'] as String?,
      website: data['website'] as String?,
      address: data['address'] as String?,
      notes: data['notes'] as String?,
      leadScore: (data['leadScore'] as num?)?.toDouble(),
      lifetimeValue: (data['lifetimeValue'] as num?)?.toDouble() ?? 0,
      lastActivityAt: (data['lastActivityAt'] as Timestamp?)?.toDate(),
      createdAt: (data['createdAt'] as Timestamp?)?.toDate(),
      updatedAt: (data['updatedAt'] as Timestamp?)?.toDate(),
      customFields: Map<String, dynamic>.from(
        data['customFields'] as Map? ?? const {},
      ),
      activityCount: data['activityCount'] as int? ?? 0,
      openDealsCount: data['openDealsCount'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toFirestore() => {
        'name': name,
        'email': email,
        'phone': phone,
        'company': company,
        'jobTitle': jobTitle,
        'photoUrl': photoUrl,
        'status': status.name,
        'ownerId': ownerId,
        'teamId': teamId,
        'tags': tags,
        'segments': segments,
        'linkedin': linkedin,
        'twitter': twitter,
        'website': website,
        'address': address,
        'notes': notes,
        'leadScore': leadScore,
        'lifetimeValue': lifetimeValue,
        'lastActivityAt': lastActivityAt != null
            ? Timestamp.fromDate(lastActivityAt!)
            : FieldValue.serverTimestamp(),
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'customFields': customFields,
        'activityCount': activityCount,
        'openDealsCount': openDealsCount,
      };

  Contact copyWith({
    String? name,
    String? email,
    String? phone,
    String? company,
    String? jobTitle,
    String? photoUrl,
    ContactStatus? status,
    String? ownerId,
    String? teamId,
    List<String>? tags,
    List<String>? segments,
    String? linkedin,
    String? twitter,
    String? website,
    String? address,
    String? notes,
    double? leadScore,
    double? lifetimeValue,
    DateTime? lastActivityAt,
    Map<String, dynamic>? customFields,
    int? activityCount,
    int? openDealsCount,
  }) {
    return Contact(
      id: id,
      name: name ?? this.name,
      email: email ?? this.email,
      phone: phone ?? this.phone,
      company: company ?? this.company,
      jobTitle: jobTitle ?? this.jobTitle,
      photoUrl: photoUrl ?? this.photoUrl,
      status: status ?? this.status,
      ownerId: ownerId ?? this.ownerId,
      teamId: teamId ?? this.teamId,
      tags: tags ?? this.tags,
      segments: segments ?? this.segments,
      linkedin: linkedin ?? this.linkedin,
      twitter: twitter ?? this.twitter,
      website: website ?? this.website,
      address: address ?? this.address,
      notes: notes ?? this.notes,
      leadScore: leadScore ?? this.leadScore,
      lifetimeValue: lifetimeValue ?? this.lifetimeValue,
      lastActivityAt: lastActivityAt ?? this.lastActivityAt,
      createdAt: createdAt,
      updatedAt: DateTime.now(),
      customFields: customFields ?? this.customFields,
      activityCount: activityCount ?? this.activityCount,
      openDealsCount: openDealsCount ?? this.openDealsCount,
    );
  }

  static ContactStatus _parseStatus(String? s) {
    return ContactStatus.values.firstWhere(
      (e) => e.name == s,
      orElse: () => ContactStatus.lead,
    );
  }

  @override
  List<Object?> get props => [
        id, name, email, phone, company, jobTitle, photoUrl,
        status, ownerId, teamId, tags, segments, leadScore, lifetimeValue,
        lastActivityAt, activityCount, openDealsCount,
      ];
}

/// Activity log entry in `activities/{activityId}`.
class Activity extends Equatable {
  const Activity({
    required this.id,
    required this.type,
    required this.ownerId,
    this.contactId,
    this.dealId,
    this.ticketId,
    this.campaignId,
    this.title,
    this.description,
    this.metadata = const {},
    this.timestamp,
  });

  final String id;
  final String type; // call, email, meeting, note, task, etc.
  final String ownerId;
  final String? contactId;
  final String? dealId;
  final String? ticketId;
  final String? campaignId;
  final String? title;
  final String? description;
  final Map<String, dynamic> metadata;
  final DateTime? timestamp;

  factory Activity.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Activity(
      id: doc.id,
      type: data['type'] as String? ?? 'note',
      ownerId: data['ownerId'] as String? ?? '',
      contactId: data['contactId'] as String?,
      dealId: data['dealId'] as String?,
      ticketId: data['ticketId'] as String?,
      campaignId: data['campaignId'] as String?,
      title: data['title'] as String?,
      description: data['description'] as String?,
      metadata: Map<String, dynamic>.from(data['metadata'] as Map? ?? const {}),
      timestamp: (data['timestamp'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'type': type,
        'ownerId': ownerId,
        'contactId': contactId,
        'dealId': dealId,
        'ticketId': ticketId,
        'campaignId': campaignId,
        'title': title,
        'description': description,
        'metadata': metadata,
        'timestamp': timestamp != null
            ? Timestamp.fromDate(timestamp!)
            : FieldValue.serverTimestamp(),
      };

  @override
  List<Object?> get props => [id, type, ownerId, contactId, dealId, timestamp];
}

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

import '../../../core/constants/app_constants.dart' show AppConstants;
import '../../../core/services/remote/data_codec.dart';

/// Sales pipeline stage — kept as string for Firestore flexibility.
typedef DealStage = String;

/// Deal (opportunity) in `deals/{dealId}`.
class Deal extends Equatable {
  const Deal({
    required this.id,
    required this.title,
    required this.value,
    required this.stage,
    required this.ownerId,
    this.contactId,
    this.contactName,
    this.company,
    this.teamId,
    this.probability,
    this.expectedCloseDate,
    this.actualCloseDate,
    this.priority = 0,
    this.tags = const [],
    this.notes,
    this.aiInsight,
    this.aiConfidence,
    this.nextStep,
    this.weightedValue,
    this.createdAt,
    this.updatedAt,
    this.closedReason,
  });

  final String id;
  final String title;
  final double value;
  final DealStage stage;
  final String ownerId;
  final String? contactId;
  final String? contactName;
  final String? company;
  final String? teamId;
  final double? probability;
  final DateTime? expectedCloseDate;
  final DateTime? actualCloseDate;
  final int priority; // 0=normal, 1=starred, 2=critical
  final List<String> tags;
  final String? notes;
  final String? aiInsight;
  final double? aiConfidence; // 0..1
  final String? nextStep;
  final double? weightedValue;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String? closedReason;

  /// Effective weighted value = value * (probability ?? stageDefault).
  double get effectiveWeighted =>
      weightedValue ??
      value * (probability ?? AppConstants.stageProbabilities[stage] ?? 0.1);

  bool get isOpen => stage != 'won' && stage != 'lost';
  bool get isWon => stage == 'won';
  bool get isLost => stage == 'lost';

  factory Deal.fromFirestore(DataDoc doc) {
    final data = doc.data;
    return Deal(
      id: doc.id,
      title: data['title'] as String? ?? '',
      value: (data['value'] as num?)?.toDouble() ?? 0,
      stage: data['stage'] as String? ?? 'lead',
      ownerId: data['ownerId'] as String? ?? '',
      contactId: data['contactId'] as String?,
      contactName: data['contactName'] as String?,
      company: data['company'] as String?,
      teamId: data['teamId'] as String?,
      probability: (data['probability'] as num?)?.toDouble(),
      expectedCloseDate: (data['expectedCloseDate'] as Timestamp?)?.toDate(),
      actualCloseDate: (data['actualCloseDate'] as Timestamp?)?.toDate(),
      priority: data['priority'] as int? ?? 0,
      tags: List<String>.from(data['tags'] as List? ?? const []),
      notes: data['notes'] as String?,
      aiInsight: data['aiInsight'] as String?,
      aiConfidence: (data['aiConfidence'] as num?)?.toDouble(),
      nextStep: data['nextStep'] as String?,
      weightedValue: (data['weightedValue'] as num?)?.toDouble(),
      createdAt: (data['createdAt'] as Timestamp?)?.toDate(),
      updatedAt: (data['updatedAt'] as Timestamp?)?.toDate(),
      closedReason: data['closedReason'] as String?,
    );
  }

  Map<String, dynamic> toFirestore() => {
        'title': title,
        'value': value,
        'stage': stage,
        'ownerId': ownerId,
        'contactId': contactId,
        'contactName': contactName,
        'company': company,
        'teamId': teamId,
        'probability': probability,
        'expectedCloseDate': expectedCloseDate != null
            ? Timestamp.fromDate(expectedCloseDate!)
            : null,
        'actualCloseDate': actualCloseDate != null
            ? Timestamp.fromDate(actualCloseDate!)
            : null,
        'priority': priority,
        'tags': tags,
        'notes': notes,
        'aiInsight': aiInsight,
        'aiConfidence': aiConfidence,
        'nextStep': nextStep,
        'weightedValue': weightedValue,
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : const ServerTimestamp(),
        'updatedAt': const ServerTimestamp(),
        'closedReason': closedReason,
      };

  Deal copyWith({
    String? title,
    double? value,
    DealStage? stage,
    String? ownerId,
    String? contactId,
    String? contactName,
    String? company,
    String? teamId,
    double? probability,
    DateTime? expectedCloseDate,
    DateTime? actualCloseDate,
    int? priority,
    List<String>? tags,
    String? notes,
    String? aiInsight,
    double? aiConfidence,
    String? nextStep,
    String? closedReason,
  }) {
    return Deal(
      id: id,
      title: title ?? this.title,
      value: value ?? this.value,
      stage: stage ?? this.stage,
      ownerId: ownerId ?? this.ownerId,
      contactId: contactId ?? this.contactId,
      contactName: contactName ?? this.contactName,
      company: company ?? this.company,
      teamId: teamId ?? this.teamId,
      probability: probability ?? this.probability,
      expectedCloseDate: expectedCloseDate ?? this.expectedCloseDate,
      actualCloseDate: actualCloseDate ?? this.actualCloseDate,
      priority: priority ?? this.priority,
      tags: tags ?? this.tags,
      notes: notes ?? this.notes,
      aiInsight: aiInsight ?? this.aiInsight,
      aiConfidence: aiConfidence ?? this.aiConfidence,
      nextStep: nextStep ?? this.nextStep,
      weightedValue: weightedValue,
      createdAt: createdAt,
      updatedAt: DateTime.now(),
      closedReason: closedReason ?? this.closedReason,
    );
  }

  @override
  List<Object?> get props => [
        id, title, value, stage, ownerId, contactId, contactName,
        company, probability, expectedCloseDate, priority, tags,
      ];
}

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

import '../../../core/services/remote/data_codec.dart';
import '../../contacts/models/call_status.dart';

/// A single call attempt made by a telecaller against a contact.
///
/// Stored in `call_logs/{id}`. Kept as an append-only record: dispositions
/// change on the contact, but the history of what was tried never rewrites
/// itself, which is what makes coaching and dispute resolution possible.
class CallLog extends Equatable {
  const CallLog({
    required this.id,
    required this.contactId,
    required this.callerId,
    required this.teamId,
    required this.outcome,
    this.contactName = '',
    this.callerName = '',
    this.notes,
    this.durationSeconds = 0,
    this.followUpAt,
    this.createdAt,
  });

  final String id;
  final String contactId;
  final String callerId;
  final String teamId;
  final CallStatus outcome;
  final String contactName;
  final String callerName;
  final String? notes;
  final int durationSeconds;
  final DateTime? followUpAt;
  final DateTime? createdAt;

  factory CallLog.fromFirestore(DataDoc doc) {
    final data = doc.data;
    return CallLog(
      id: doc.id,
      contactId: data['contactId'] as String? ?? '',
      callerId: data['callerId'] as String? ?? '',
      teamId: data['teamId'] as String? ?? '',
      outcome: CallStatusX.parse(data['outcome'] as String?),
      contactName: data['contactName'] as String? ?? '',
      callerName: data['callerName'] as String? ?? '',
      notes: data['notes'] as String?,
      durationSeconds: (data['durationSeconds'] as num?)?.toInt() ?? 0,
      followUpAt: (data['followUpAt'] as Timestamp?)?.toDate(),
      createdAt: (data['createdAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'contactId': contactId,
        'callerId': callerId,
        'teamId': teamId,
        'outcome': outcome.name,
        'contactName': contactName,
        'callerName': callerName,
        'notes': notes,
        'durationSeconds': durationSeconds,
        'followUpAt':
            followUpAt != null ? Timestamp.fromDate(followUpAt!) : null,
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : const ServerTimestamp(),
      };

  @override
  List<Object?> get props => [id, contactId, callerId, outcome, createdAt];
}

/// An audit trail entry, written whenever a privileged action happens.
///
/// Super admins need to answer "who moved these 400 leads and when".
class AuditEntry extends Equatable {
  const AuditEntry({
    required this.id,
    required this.action,
    required this.actorId,
    this.actorName = '',
    this.teamId,
    this.targetId,
    this.summary = '',
    this.metadata = const {},
    this.createdAt,
  });

  final String id;
  final String action;
  final String actorId;
  final String actorName;
  final String? teamId;
  final String? targetId;
  final String summary;
  final Map<String, dynamic> metadata;
  final DateTime? createdAt;

  factory AuditEntry.fromFirestore(DataDoc doc) {
    final data = doc.data;
    return AuditEntry(
      id: doc.id,
      action: data['action'] as String? ?? '',
      actorId: data['actorId'] as String? ?? '',
      actorName: data['actorName'] as String? ?? '',
      teamId: data['teamId'] as String?,
      targetId: data['targetId'] as String?,
      summary: data['summary'] as String? ?? '',
      metadata: (data['metadata'] as Map<String, dynamic>?) ?? const {},
      createdAt: (data['createdAt'] as Timestamp?)?.toDate(),
    );
  }

  @override
  List<Object?> get props => [id, action, actorId, createdAt];
}

/// Per-caller performance rollup, computed client-side from call logs.
class CallerStats {
  CallerStats({
    required this.callerId,
    required this.callerName,
    this.assigned = 0,
    this.calls = 0,
    this.connected = 0,
    this.interested = 0,
    this.converted = 0,
    this.pending = 0,
    this.talkSeconds = 0,
  });

  final String callerId;
  final String callerName;
  int assigned;
  int calls;
  int connected;
  int interested;
  int converted;
  int pending;
  int talkSeconds;

  /// Share of call attempts that actually reached a human.
  double get connectRate => calls == 0 ? 0 : connected / calls;

  /// Share of connected calls that turned into a customer.
  double get conversionRate => connected == 0 ? 0 : converted / connected;

  /// Leads worked through, as a share of leads held.
  double get coverage => assigned == 0 ? 0 : (assigned - pending) / assigned;
}

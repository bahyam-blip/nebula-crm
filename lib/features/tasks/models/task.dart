import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

/// Where a task sits in its lifecycle (spec §8).
enum TaskStatus { pending, inProgress, completed, archived }

extension TaskStatusX on TaskStatus {
  String get label {
    switch (this) {
      case TaskStatus.pending:
        return 'Pending';
      case TaskStatus.inProgress:
        return 'In progress';
      case TaskStatus.completed:
        return 'Completed';
      case TaskStatus.archived:
        return 'Archived';
    }
  }

  bool get isOpen =>
      this == TaskStatus.pending || this == TaskStatus.inProgress;

  static TaskStatus parse(String? s) => TaskStatus.values.firstWhere(
        (v) => v.name == s,
        orElse: () => TaskStatus.pending,
      );
}

enum TaskPriority { low, medium, high, urgent }

extension TaskPriorityX on TaskPriority {
  String get label {
    switch (this) {
      case TaskPriority.low:
        return 'Low';
      case TaskPriority.medium:
        return 'Medium';
      case TaskPriority.high:
        return 'High';
      case TaskPriority.urgent:
        return 'Urgent';
    }
  }

  /// Higher sorts first in the task list.
  int get weight => TaskPriority.values.indexOf(this);

  static TaskPriority parse(String? s) => TaskPriority.values.firstWhere(
        (v) => v.name == s,
        orElse: () => TaskPriority.medium,
      );
}

/// What a reminder is attached to (spec §15).
enum ReminderKind { call, meeting, followUp, renewal, payment, birthday, other }

extension ReminderKindX on ReminderKind {
  String get label {
    switch (this) {
      case ReminderKind.call:
        return 'Call';
      case ReminderKind.meeting:
        return 'Meeting';
      case ReminderKind.followUp:
        return 'Follow-up';
      case ReminderKind.renewal:
        return 'Renewal';
      case ReminderKind.payment:
        return 'Payment';
      case ReminderKind.birthday:
        return 'Birthday';
      case ReminderKind.other:
        return 'Task';
    }
  }

  static ReminderKind parse(String? s) => ReminderKind.values.firstWhere(
        (v) => v.name == s,
        orElse: () => ReminderKind.other,
      );
}

/// A task or reminder, optionally linked to a customer record.
///
/// Tasks and reminders share one model deliberately: a reminder is just a
/// task whose value is the notification rather than the checkbox. Keeping
/// them apart would mean two queues to check and two places to forget
/// something.
class CrmTask extends Equatable {
  const CrmTask({
    required this.id,
    required this.title,
    required this.teamId,
    this.description,
    this.status = TaskStatus.pending,
    this.priority = TaskPriority.medium,
    this.kind = ReminderKind.other,
    this.assignedTo,
    this.assignedToName = '',
    this.createdBy,
    this.createdByName = '',
    this.relatedContactId,
    this.relatedContactName,
    this.dueAt,
    this.remindAt,
    this.completedAt,
    this.acknowledged = false,
    this.audienceRole,
    this.audienceEveryone = false,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String title;
  final String teamId;
  final String? description;
  final TaskStatus status;
  final TaskPriority priority;
  final ReminderKind kind;
  final String? assignedTo;
  final String assignedToName;
  final String? createdBy;
  final String createdByName;
  final String? relatedContactId;
  final String? relatedContactName;
  final DateTime? dueAt;
  final DateTime? remindAt;
  final DateTime? completedAt;

  /// Reminders keep surfacing until explicitly acknowledged (spec §15).
  final bool acknowledged;

  /// Broadcast targets. A task can go to one person (assignedTo), to a
  /// whole role such as every telecaller, or to the entire team. Storing
  /// the audience rather than fanning out one task per member keeps a
  /// single item to edit and a single place to see who it went to.
  final String? audienceRole;
  final bool audienceEveryone;

  bool get isBroadcast => audienceEveryone || audienceRole != null;

  /// Is this task addressed to [user]?
  bool targets(String userId, String roleName) =>
      assignedTo == userId ||
      audienceEveryone ||
      (audienceRole != null && audienceRole == roleName);

  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get isOverdue =>
      status.isOpen && dueAt != null && dueAt!.isBefore(DateTime.now());

  bool get isDueToday {
    if (dueAt == null) return false;
    final now = DateTime.now();
    return dueAt!.year == now.year &&
        dueAt!.month == now.month &&
        dueAt!.day == now.day;
  }

  /// A reminder that has come due and nobody has dismissed.
  bool get needsAttention =>
      status.isOpen &&
      !acknowledged &&
      remindAt != null &&
      remindAt!.isBefore(DateTime.now());

  factory CrmTask.fromFirestore(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>? ?? {};
    return CrmTask(
      id: doc.id,
      title: d['title'] as String? ?? 'Untitled',
      teamId: d['teamId'] as String? ?? '',
      description: d['description'] as String?,
      status: TaskStatusX.parse(d['status'] as String?),
      priority: TaskPriorityX.parse(d['priority'] as String?),
      kind: ReminderKindX.parse(d['kind'] as String?),
      assignedTo: d['assignedTo'] as String?,
      assignedToName: d['assignedToName'] as String? ?? '',
      createdBy: d['createdBy'] as String?,
      createdByName: d['createdByName'] as String? ?? '',
      relatedContactId: d['relatedContactId'] as String?,
      relatedContactName: d['relatedContactName'] as String?,
      dueAt: (d['dueAt'] as Timestamp?)?.toDate(),
      remindAt: (d['remindAt'] as Timestamp?)?.toDate(),
      completedAt: (d['completedAt'] as Timestamp?)?.toDate(),
      acknowledged: d['acknowledged'] as bool? ?? false,
      audienceRole: d['audienceRole'] as String?,
      audienceEveryone: d['audienceEveryone'] as bool? ?? false,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
      updatedAt: (d['updatedAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'title': title,
        'teamId': teamId,
        'description': description,
        'status': status.name,
        'priority': priority.name,
        'kind': kind.name,
        'assignedTo': assignedTo,
        'assignedToName': assignedToName,
        'createdBy': createdBy,
        'createdByName': createdByName,
        'relatedContactId': relatedContactId,
        'relatedContactName': relatedContactName,
        'dueAt': dueAt != null ? Timestamp.fromDate(dueAt!) : null,
        'remindAt': remindAt != null ? Timestamp.fromDate(remindAt!) : null,
        'completedAt':
            completedAt != null ? Timestamp.fromDate(completedAt!) : null,
        'acknowledged': acknowledged,
        'audienceRole': audienceRole,
        'audienceEveryone': audienceEveryone,
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };

  @override
  List<Object?> get props => [id, title, status, priority, dueAt, assignedTo];
}

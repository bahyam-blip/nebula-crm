import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

/// Ticket priority levels.
enum TicketPriority { low, medium, high, urgent }

extension TicketPriorityX on TicketPriority {
  String get label => name.toUpperCase();

  int get slaHours {
    switch (this) {
      case TicketPriority.low:
        return 24;
      case TicketPriority.medium:
        return 8;
      case TicketPriority.high:
        return 4;
      case TicketPriority.urgent:
        return 1;
    }
  }
}

/// Ticket status.
enum TicketStatus { open, inProgress, waitingOnCustomer, resolved, closed }

extension TicketStatusX on TicketStatus {
  String get label {
    switch (this) {
      case TicketStatus.open:
        return 'Open';
      case TicketStatus.inProgress:
        return 'In Progress';
      case TicketStatus.waitingOnCustomer:
        return 'Waiting';
      case TicketStatus.resolved:
        return 'Resolved';
      case TicketStatus.closed:
        return 'Closed';
    }
  }

  bool get isOpen =>
      this == TicketStatus.open ||
      this == TicketStatus.inProgress ||
      this == TicketStatus.waitingOnCustomer;
}

/// A support ticket in `tickets/{ticketId}`.
class Ticket extends Equatable {
  const Ticket({
    required this.id,
    required this.subject,
    required this.priority,
    required this.status,
    required this.ownerId,
    this.contactId,
    this.contactName,
    this.assigneeId,
    this.assigneeName,
    this.teamId,
    this.description,
    this.category,
    this.tags = const [],
    this.slaDeadline,
    this.firstResponseAt,
    this.resolvedAt,
    this.closedAt,
    this.attachments = const [],
    this.messageCount = 0,
    this.csatScore,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String subject;
  final TicketPriority priority;
  final TicketStatus status;
  final String ownerId;
  final String? contactId;
  final String? contactName;
  final String? assigneeId;
  final String? assigneeName;
  final String? teamId;
  final String? description;
  final String? category;
  final List<String> tags;
  final DateTime? slaDeadline;
  final DateTime? firstResponseAt;
  final DateTime? resolvedAt;
  final DateTime? closedAt;
  final List<String> attachments;
  final int messageCount;
  final int? csatScore; // 1..5, null = not yet rated
  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// SLA status: 'within' | 'at_risk' (<2h left) | 'breached'.
  String get slaStatus {
    if (slaDeadline == null) return 'within';
    if (status == TicketStatus.resolved || status == TicketStatus.closed) {
      return 'within';
    }
    final remaining = slaDeadline!.difference(DateTime.now());
    if (remaining.isNegative) return 'breached';
    if (remaining.inHours < 2) return 'at_risk';
    return 'within';
  }

  factory Ticket.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Ticket(
      id: doc.id,
      subject: data['subject'] as String? ?? '',
      priority: _parsePriority(data['priority'] as String?),
      status: _parseStatus(data['status'] as String?),
      ownerId: data['ownerId'] as String? ?? '',
      contactId: data['contactId'] as String?,
      contactName: data['contactName'] as String?,
      assigneeId: data['assigneeId'] as String?,
      assigneeName: data['assigneeName'] as String?,
      teamId: data['teamId'] as String?,
      description: data['description'] as String?,
      category: data['category'] as String?,
      tags: List<String>.from(data['tags'] as List? ?? const []),
      slaDeadline: (data['slaDeadline'] as Timestamp?)?.toDate(),
      firstResponseAt: (data['firstResponseAt'] as Timestamp?)?.toDate(),
      resolvedAt: (data['resolvedAt'] as Timestamp?)?.toDate(),
      closedAt: (data['closedAt'] as Timestamp?)?.toDate(),
      attachments: List<String>.from(data['attachments'] as List? ?? const []),
      messageCount: data['messageCount'] as int? ?? 0,
      csatScore: data['csatScore'] as int?,
      createdAt: (data['createdAt'] as Timestamp?)?.toDate(),
      updatedAt: (data['updatedAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'subject': subject,
        'priority': priority.name,
        'status': status.name,
        'ownerId': ownerId,
        'contactId': contactId,
        'contactName': contactName,
        'assigneeId': assigneeId,
        'assigneeName': assigneeName,
        'teamId': teamId,
        'description': description,
        'category': category,
        'tags': tags,
        'slaDeadline':
            slaDeadline != null ? Timestamp.fromDate(slaDeadline!) : null,
        'firstResponseAt': firstResponseAt != null
            ? Timestamp.fromDate(firstResponseAt!)
            : null,
        'resolvedAt':
            resolvedAt != null ? Timestamp.fromDate(resolvedAt!) : null,
        'closedAt': closedAt != null ? Timestamp.fromDate(closedAt!) : null,
        'attachments': attachments,
        'messageCount': messageCount,
        'csatScore': csatScore,
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };

  Ticket copyWith({
    String? subject,
    TicketPriority? priority,
    TicketStatus? status,
    String? assigneeId,
    String? assigneeName,
    String? description,
    String? category,
    DateTime? slaDeadline,
    DateTime? firstResponseAt,
    DateTime? resolvedAt,
    DateTime? closedAt,
    int? messageCount,
    int? csatScore,
  }) {
    return Ticket(
      id: id,
      subject: subject ?? this.subject,
      priority: priority ?? this.priority,
      status: status ?? this.status,
      ownerId: ownerId,
      contactId: contactId,
      contactName: contactName,
      assigneeId: assigneeId ?? this.assigneeId,
      assigneeName: assigneeName ?? this.assigneeName,
      teamId: teamId,
      description: description ?? this.description,
      category: category ?? this.category,
      tags: tags,
      slaDeadline: slaDeadline ?? this.slaDeadline,
      firstResponseAt: firstResponseAt ?? this.firstResponseAt,
      resolvedAt: resolvedAt ?? this.resolvedAt,
      closedAt: closedAt ?? this.closedAt,
      attachments: attachments,
      messageCount: messageCount ?? this.messageCount,
      csatScore: csatScore ?? this.csatScore,
      createdAt: createdAt,
      updatedAt: DateTime.now(),
    );
  }

  static TicketPriority _parsePriority(String? s) {
    return TicketPriority.values.firstWhere(
      (e) => e.name == s,
      orElse: () => TicketPriority.medium,
    );
  }

  static TicketStatus _parseStatus(String? s) {
    return TicketStatus.values.firstWhere(
      (e) => e.name == s,
      orElse: () => TicketStatus.open,
    );
  }

  @override
  List<Object?> get props => [
        id, subject, priority, status, ownerId, assigneeId,
        slaDeadline, messageCount,
      ];
}

/// Knowledge base article in `articles/{articleId}`.
class Article extends Equatable {
  const Article({
    required this.id,
    required this.title,
    required this.body,
    this.summary,
    this.category,
    this.tags = const [],
    this.views = 0,
    this.helpful = 0,
    this.notHelpful = 0,
    this.authorId,
    this.authorName,
    this.published = false,
    this.publishedAt,
    this.updatedAt,
  });

  final String id;
  final String title;
  final String body; // Quill Delta JSON or HTML
  final String? summary;
  final String? category;
  final List<String> tags;
  final int views;
  final int helpful;
  final int notHelpful;
  final String? authorId;
  final String? authorName;
  final bool published;
  final DateTime? publishedAt;
  final DateTime? updatedAt;

  double get helpfulRate {
    final total = helpful + notHelpful;
    if (total == 0) return 0;
    return (helpful / total) * 100;
  }

  factory Article.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Article(
      id: doc.id,
      title: data['title'] as String? ?? '',
      body: data['body'] as String? ?? '',
      summary: data['summary'] as String?,
      category: data['category'] as String?,
      tags: List<String>.from(data['tags'] as List? ?? const []),
      views: data['views'] as int? ?? 0,
      helpful: data['helpful'] as int? ?? 0,
      notHelpful: data['notHelpful'] as int? ?? 0,
      authorId: data['authorId'] as String?,
      authorName: data['authorName'] as String?,
      published: data['published'] as bool? ?? false,
      publishedAt: (data['publishedAt'] as Timestamp?)?.toDate(),
      updatedAt: (data['updatedAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'title': title,
        'body': body,
        'summary': summary,
        'category': category,
        'tags': tags,
        'views': views,
        'helpful': helpful,
        'notHelpful': notHelpful,
        'authorId': authorId,
        'authorName': authorName,
        'published': published,
        'publishedAt': publishedAt != null
            ? Timestamp.fromDate(publishedAt!)
            : null,
        'updatedAt': FieldValue.serverTimestamp(),
      };

  @override
  List<Object?> get props => [id, title, category, published, views];
}

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

import '../../../core/services/remote/data_codec.dart';

/// Role of a chat message sender.
enum ChatRole { user, assistant, system, tool }

extension ChatRoleX on ChatRole {
  String get name => switch (this) {
        ChatRole.user => 'user',
        ChatRole.assistant => 'assistant',
        ChatRole.system => 'system',
        ChatRole.tool => 'tool',
      };
}

/// Parse a string into a [ChatRole], defaulting to [ChatRole.assistant].
ChatRole parseChatRole(String? s) => switch (s) {
      'user' => ChatRole.user,
      'assistant' => ChatRole.assistant,
      'system' => ChatRole.system,
      'tool' => ChatRole.tool,
      _ => ChatRole.assistant,
    };

/// A single message in an AI assistant thread.
class ChatMessage extends Equatable {
  const ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    this.timestamp,
    this.metadata = const {},
    this.attachments = const [],
    this.isStreaming = false,
    this.tokensUsed,
    this.modelUsed,
    this.citations = const [],
  });

  final String id;
  final ChatRole role;
  final String content;
  final DateTime? timestamp;
  final Map<String, dynamic> metadata;
  final List<String> attachments;
  final bool isStreaming;
  final int? tokensUsed;
  final String? modelUsed;
  final List<String> citations;

  factory ChatMessage.fromFirestore(DataDoc doc) {
    final data = doc.data;
    return ChatMessage(
      id: doc.id,
      role: parseChatRole(data['role'] as String?),
      content: data['content'] as String? ?? '',
      timestamp: flexTs(data['timestamp']),
      metadata: Map<String, dynamic>.from(data['metadata'] as Map? ?? const {}),
      attachments:
          stringList(data['attachments']),
      isStreaming: data['isStreaming'] as bool? ?? false,
      tokensUsed: data['tokensUsed'] as int?,
      modelUsed: data['modelUsed'] as String?,
      citations: stringList(data['citations']),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'role': role.name,
        'content': content,
        'timestamp': timestamp != null
            ? Timestamp.fromDate(timestamp!)
            : const ServerTimestamp(),
        'metadata': metadata,
        'attachments': attachments,
        'isStreaming': isStreaming,
        'tokensUsed': tokensUsed,
        'modelUsed': modelUsed,
        'citations': citations,
      };

  @override
  List<Object?> get props => [id, role, content, timestamp, isStreaming];
}

/// Conversation thread — wraps a list of [ChatMessage]s.
class ChatThread extends Equatable {
  const ChatThread({
    required this.id,
    required this.userId,
    this.title = 'New conversation',
    this.messages = const [],
    this.lastMessageAt,
    this.createdAt,
    this.context = const {},
    this.tokenCount = 0,
  });

  final String id;
  final String userId;
  final String title;
  final List<ChatMessage> messages;
  final DateTime? lastMessageAt;
  final DateTime? createdAt;
  final Map<String, dynamic> context;
  final int tokenCount;

  ChatThread copyWith({
    String? title,
    List<ChatMessage>? messages,
    DateTime? lastMessageAt,
    Map<String, dynamic>? context,
    int? tokenCount,
  }) {
    return ChatThread(
      id: id,
      userId: userId,
      title: title ?? this.title,
      messages: messages ?? this.messages,
      lastMessageAt: lastMessageAt ?? this.lastMessageAt,
      createdAt: createdAt,
      context: context ?? this.context,
      tokenCount: tokenCount ?? this.tokenCount,
    );
  }

  @override
  List<Object?> get props => [id, userId, title, lastMessageAt, tokenCount];
}

/// Insight card types — surfaced on dashboard, deal detail, contact detail.
enum InsightType {
  nextBestAction,
  atRiskDeal,
  upsellOpportunity,
  sentimentShift,
  churnRisk,
  followUpReminder,
  anomaly,
  forecastAdjustment,
}

extension InsightTypeX on InsightType {
  String get label => switch (this) {
        InsightType.nextBestAction => 'Next Best Action',
        InsightType.atRiskDeal => 'At-Risk Deal',
        InsightType.upsellOpportunity => 'Upsell Opportunity',
        InsightType.sentimentShift => 'Sentiment Shift',
        InsightType.churnRisk => 'Churn Risk',
        InsightType.followUpReminder => 'Follow-up Reminder',
        InsightType.anomaly => 'Anomaly Detected',
        InsightType.forecastAdjustment => 'Forecast Adjustment',
      };
}

/// AI-generated insight in `insights/{insightId}`.
///
/// Rendered as a typed card with confidence, reasoning, and a CTA.
/// Never raw markdown blobs — always structured for the UI.
class Insight extends Equatable {
  const Insight({
    required this.id,
    required this.type,
    required this.title,
    required this.summary,
    this.confidence = 0.0,
    this.reasoning,
    this.recommendedAction,
    this.actionUrl,
    this.targetType, // 'deal' | 'contact' | 'ticket' | 'campaign'
    this.targetId,
    this.targetName,
    this.userId,
    this.teamId,
    this.dismissed = false,
    this.actedOn = false,
    this.metadata = const {},
    this.generatedAt,
    this.expiresAt,
  });

  final String id;
  final InsightType type;
  final String title;
  final String summary;
  final double confidence; // 0..1
  final String? reasoning;
  final String? recommendedAction;
  final String? actionUrl;
  final String? targetType;
  final String? targetId;
  final String? targetName;
  final String? userId;
  final String? teamId;
  final bool dismissed;
  final bool actedOn;
  final Map<String, dynamic> metadata;
  final DateTime? generatedAt;
  final DateTime? expiresAt;

  /// Confidence label for UI.
  String get confidenceLabel {
    if (confidence >= 0.85) return 'High confidence';
    if (confidence >= 0.65) return 'Medium confidence';
    return 'Low confidence';
  }

  factory Insight.fromFirestore(DataDoc doc) {
    final data = doc.data;
    return Insight(
      id: doc.id,
      type: InsightType.values.firstWhere(
        (e) => e.name == data['type'],
        orElse: () => InsightType.nextBestAction,
      ),
      title: data['title'] as String? ?? '',
      summary: data['summary'] as String? ?? '',
      confidence: (data['confidence'] as num?)?.toDouble() ?? 0,
      reasoning: data['reasoning'] as String?,
      recommendedAction: data['recommendedAction'] as String?,
      actionUrl: data['actionUrl'] as String?,
      targetType: data['targetType'] as String?,
      targetId: data['targetId'] as String?,
      targetName: data['targetName'] as String?,
      userId: data['userId'] as String?,
      teamId: data['teamId'] as String?,
      dismissed: data['dismissed'] as bool? ?? false,
      actedOn: data['actedOn'] as bool? ?? false,
      metadata: Map<String, dynamic>.from(data['metadata'] as Map? ?? const {}),
      generatedAt: flexTs(data['generatedAt']),
      expiresAt: flexTs(data['expiresAt']),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'type': type.name,
        'title': title,
        'summary': summary,
        'confidence': confidence,
        'reasoning': reasoning,
        'recommendedAction': recommendedAction,
        'actionUrl': actionUrl,
        'targetType': targetType,
        'targetId': targetId,
        'targetName': targetName,
        'userId': userId,
        'teamId': teamId,
        'dismissed': dismissed,
        'actedOn': actedOn,
        'metadata': metadata,
        'generatedAt': generatedAt != null
            ? Timestamp.fromDate(generatedAt!)
            : const ServerTimestamp(),
        'expiresAt':
            expiresAt != null ? Timestamp.fromDate(expiresAt!) : null,
      };

  @override
  List<Object?> get props =>
      [id, type, title, summary, confidence, targetType, targetId, dismissed];
}

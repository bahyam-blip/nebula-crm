import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/ai_service.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/insight.dart';

/// All AI-generated insights for the current user.
final insightsProvider = StreamProvider<List<Insight>>((ref) {
  final userId = ref.watch(currentUserIdProvider);
  final db = FirebaseFirestore.instance;
  return db
      .collection(AppConstants.colInsights)
      .where('userId', isEqualTo: userId)
      .where('dismissed', isEqualTo: false)
      .orderBy('generatedAt', descending: true)
      .limit(20)
      .snapshots()
      .map((snap) => snap.docs.map(Insight.fromFirestore).toList());
});

/// Current chat thread id (created on demand).
final currentThreadIdProvider = StateProvider<String?>((ref) => null);

/// Chat messages for the current thread.
final chatMessagesProvider =
    StreamProvider.family<List<ChatMessage>, String>((ref, threadId) {
  final db = FirebaseFirestore.instance;
  return db
      .collection(AppConstants.colChatThreads)
      .doc(threadId)
      .collection('messages')
      .orderBy('timestamp', descending: false)
      .limit(100)
      .snapshots()
      .map((snap) => snap.docs.map(ChatMessage.fromFirestore).toList());
});

/// Async notifier for the chat thread + send message actions.
class ChatController extends AsyncNotifier<void> {
  final _uuid = const Uuid();

  @override
  Future<void> build() async {}

  /// Create a new thread, return its id.
  Future<String> newThread() async {
    final userId = ref.read(currentUserIdProvider);
    final id = _uuid.v4();
    await FirebaseFirestore.instance
        .collection(AppConstants.colChatThreads)
        .doc(id)
        .set({
      'userId': userId,
      'title': 'New conversation',
      'createdAt': FieldValue.serverTimestamp(),
      'lastMessageAt': FieldValue.serverTimestamp(),
    });
    ref.read(currentThreadIdProvider.notifier).state = id;
    return id;
  }

  /// Send a user message and stream the assistant response.
  Future<void> send(String message) async {
    final threadId = ref.read(currentThreadIdProvider);
    if (threadId == null) return;

    final userId = ref.read(currentUserIdProvider);
    final ai = ref.read(aiServiceProvider);
    final db = FirebaseFirestore.instance;
    final threadRef =
        db.collection(AppConstants.colChatThreads).doc(threadId);
    final messagesCol = threadRef.collection('messages');

    // 1. Persist user message
    await messagesCol.add({
      'role': 'user',
      'content': message,
      'timestamp': FieldValue.serverTimestamp(),
    });

    // 2. Create a placeholder assistant message (for streaming UI).
    final assistantDoc = await messagesCol.add({
      'role': 'assistant',
      'content': '',
      'isStreaming': true,
      'timestamp': FieldValue.serverTimestamp(),
    });

    // 3. Pull recent history (last 20 messages) for context.
    final historySnap = await messagesCol
        .orderBy('timestamp', descending: true)
        .limit(21)
        .get();
    final history = historySnap.docs.reversed
        .where((d) => d.id != assistantDoc.id)
        .map((d) => {
              'role': (d.data()['role'] as String?) ?? 'user',
              'content': (d.data()['content'] as String?) ?? '',
            })
        .toList();

    // 4. Stream the response, accumulating into the placeholder.
    final buffer = StringBuffer();
    try {
      await for (final chunk in ai.streamChat(
        message: message,
        history: history,
        context: {'threadId': threadId, 'userId': userId},
      )) {
        buffer.write(chunk);
        await assistantDoc.update({'content': buffer.toString()});
      }
      await assistantDoc.update({
        'content': buffer.toString(),
        'isStreaming': false,
        'modelUsed': 'gpt-4o-mini',
      });
    } catch (e) {
      await assistantDoc.update({
        'content':
            buffer.isEmpty ? 'Sorry, something went wrong.' : buffer.toString(),
        'isStreaming': false,
        'metadata': {'error': e.toString()},
      });
    }

    // 5. Update thread metadata.
    await threadRef.update({
      'lastMessageAt': FieldValue.serverTimestamp(),
      'title': message.length > 40 ? '${message.substring(0, 40)}…' : message,
    });
  }
}

final chatControllerProvider =
    AsyncNotifierProvider<ChatController, void>(ChatController.new);

/// Async notifier for dismissing / acting on insights.
class InsightActionsNotifier extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<void> dismiss(String insightId) async {
    final db = FirebaseFirestore.instance;
    await db
        .collection(AppConstants.colInsights)
        .doc(insightId)
        .update({'dismissed': true});
  }

  Future<void> markActedOn(String insightId) async {
    final db = FirebaseFirestore.instance;
    await db
        .collection(AppConstants.colInsights)
        .doc(insightId)
        .update({'actedOn': true});
  }
}

final insightActionsProvider =
    AsyncNotifierProvider<InsightActionsNotifier, void>(
        InsightActionsNotifier.new);

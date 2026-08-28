import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/ai_service.dart';
import '../../../core/services/remote/data_api.dart';
import '../../../core/services/remote/data_codec.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/insight.dart';

/// All AI-generated insights for the current user.
final insightsProvider = StreamProvider<List<Insight>>((ref) {
  final userId = ref.watch(currentUserIdProvider);
  final ds = ref.watch(remoteDataServiceProvider);
  return ds.watchList(
    () async {
      final docs = await ds.list(
        AppConstants.colInsights,
        where: [WhereEq('userId', userId), const WhereEq('dismissed', false)],
        limit: 20,
      );
      final list = docs.map(Insight.fromFirestore).toList()
        ..sort((a, b) => (b.generatedAt ?? DateTime(0))
            .compareTo(a.generatedAt ?? DateTime(0)));
      return list;
    },
    interval: const Duration(seconds: 45),
  );
});

/// Current chat thread id (created on demand).
final currentThreadIdProvider = StateProvider<String?>((ref) => null);

/// Chat messages for the current thread (subcollection path
/// `chat_threads/{tid}/messages` — the D1 store treats the full path as the
/// collection key).
final chatMessagesProvider =
    StreamProvider.family<List<ChatMessage>, String>((ref, threadId) {
  final ds = ref.watch(remoteDataServiceProvider);
  final col = '${AppConstants.colChatThreads}/$threadId/messages';
  return ds.watchList(
    () => ds.list(col, limit: 100).then((docs) {
      final list = docs.map(ChatMessage.fromFirestore).toList()
        ..sort((a, b) => (a.timestamp ?? DateTime(0))
            .compareTo(b.timestamp ?? DateTime(0)));
      return list;
    }),
    interval: const Duration(seconds: 8),
  );
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
    await ref.read(remoteDataServiceProvider).set(
      AppConstants.colChatThreads,
      id,
      {
        'userId': userId,
        'title': 'New conversation',
        'createdAt': const ServerTimestamp(),
        'lastMessageAt': const ServerTimestamp(),
        'participants': [userId],
      },
    );
    ref.read(currentThreadIdProvider.notifier).state = id;
    return id;
  }

  /// Send a user message and stream the assistant response.
  Future<void> send(String message) async {
    final threadId = ref.read(currentThreadIdProvider);
    if (threadId == null) return;

    final userId = ref.read(currentUserIdProvider);
    final ai = ref.read(aiServiceProvider);
    final ds = ref.read(remoteDataServiceProvider);
    final messagesCol = '${AppConstants.colChatThreads}/$threadId/messages';

    // 1. Persist user message
    await ds.set(messagesCol, null, {
      'role': 'user',
      'content': message,
      'timestamp': const ServerTimestamp(),
    });

    // 2. Create a placeholder assistant message (for streaming UI).
    final assistantId = await ds.set(messagesCol, null, {
      'role': 'assistant',
      'content': '',
      'isStreaming': true,
      'timestamp': const ServerTimestamp(),
    });

    // 3. Pull recent history (last 20 messages) for context.
    final historyDocs = await ds.list(messagesCol, limit: 21);
    final history = historyDocs.reversed
        .where((d) => d.id != assistantId)
        .map((d) => {
              'role': (d.data['role'] as String?) ?? 'user',
              'content': (d.data['content'] as String?) ?? '',
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
        await ds.update(messagesCol, assistantId, {'content': buffer.toString()});
      }
      await ds.update(messagesCol, assistantId, {
        'content': buffer.toString(),
        'isStreaming': false,
        'modelUsed': 'gpt-4o-mini',
      });
    } catch (e) {
      await ds.update(messagesCol, assistantId, {
        'content':
            buffer.isEmpty ? 'Sorry, something went wrong.' : buffer.toString(),
        'isStreaming': false,
        'metadata': {'error': e.toString()},
      });
    }

    // 5. Update thread metadata.
    await ds.update(AppConstants.colChatThreads, threadId, {
      'lastMessageAt': const ServerTimestamp(),
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
    await ref
        .read(remoteDataServiceProvider)
        .update(AppConstants.colInsights, insightId, {'dismissed': true});
  }

  Future<void> markActedOn(String insightId) async {
    await ref
        .read(remoteDataServiceProvider)
        .update(AppConstants.colInsights, insightId, {'actedOn': true});
  }
}

final insightActionsProvider =
    AsyncNotifierProvider<InsightActionsNotifier, void>(
        InsightActionsNotifier.new);

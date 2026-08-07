import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:logger/logger.dart';

import '../../features/assistant/models/insight.dart';

final logger = Logger(printer: PrettyPrinter(methodCount: 0));

/// AI gateway configuration.
///
/// All LLM calls are routed through a Cloud Function (or any HTTP endpoint).
/// This keeps API keys server-side and lets you swap providers (OpenAI,
/// Anthropic, Vertex AI) without shipping an app update.
class AiGatewayConfig {
  const AiGatewayConfig({
    required this.baseUrl,
    this.apiKey,
    this.defaultModel = 'gpt-4o-mini',
    this.timeoutSeconds = 60,
  });

  /// Base URL of the AI gateway (Cloud Function).
  final String baseUrl;

  /// Optional bearer token — usually the Firebase ID token, sent by the
  /// wrapper, not stored here.
  final String? apiKey;

  final String defaultModel;
  final int timeoutSeconds;
}

/// Default config — replace [baseUrl] with your deployed Cloud Function URL.
final aiGatewayConfigProvider = Provider<AiGatewayConfig>((ref) {
  return const AiGatewayConfig(
    baseUrl: 'https://us-central1-your-project.cloudfunctions.net/aiGateway',
    defaultModel: 'gpt-4o-mini',
  );
});

final dioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 30),
    receiveTimeout: const Duration(seconds: 90),
    sendTimeout: const Duration(seconds: 30),
  ));
});

/// Result type for AI operations.
sealed class AiResult {
  const AiResult();
}

class AiSuccess extends AiResult {
  const AiSuccess(this.payload);
  final Map<String, dynamic> payload;
}

class AiFailure extends AiResult {
  const AiFailure(this.message, {this.code});
  final String message;
  final String? code;
}

/// Centralized AI service. All methods return [AiResult] — never throw.
///
/// Pattern: the app sends a *structured intent* to the gateway; the
/// gateway orchestrates LLM + RAG + tools and returns a typed JSON
/// payload. The app then renders that payload as a typed card.
class AiService {
  AiService(this._ref);

  final Ref _ref;

  Dio get _dio => _ref.read(dioProvider);
  AiGatewayConfig get _config => _ref.read(aiGatewayConfigProvider);

  /// Send a chat message and get a streamed response.
  ///
  /// [history] is the prior conversation as a list of `{role, content}` maps.
  /// [context] carries structured references like `dealId`, `contactId`.
  Stream<String> streamChat({
    required String message,
    required List<Map<String, dynamic>> history,
    Map<String, dynamic> context = const {},
    String? idToken,
  }) async* {
    try {
      final response = await _dio.post(
        '${_config.baseUrl}/chat',
        data: jsonEncode({
          'message': message,
          'history': history,
          'context': context,
          'model': _config.defaultModel,
          'stream': true,
        }),
        options: Options(
          headers: {
            'Content-Type': 'application/json',
            if (idToken != null) 'Authorization': 'Bearer $idToken',
          },
          responseType: ResponseType.stream,
        ),
      );

      final stream = response.data.stream as Stream<List<int>>;
      await for (final chunk in stream) {
        final text = utf8.decode(chunk);
        // SSE-style: lines starting with "data: "
        for (final line in text.split('\n')) {
          if (line.startsWith('data: ')) {
            final payload = line.substring(6).trim();
            if (payload == '[DONE]') return;
            try {
              final json = jsonDecode(payload) as Map<String, dynamic>;
              final delta = json['delta'] as String?;
              if (delta != null && delta.isNotEmpty) yield delta;
            } catch (_) {
              // Partial chunk — ignore.
            }
          }
        }
      }
    } on DioException catch (e) {
      logger.e('AI chat stream failed: ${e.message}');
      rethrow;
    }
  }

  /// Request a non-streamed insight (e.g. next-best-action for a deal).
  Future<AiResult> requestInsight({
    required InsightType type,
    required Map<String, dynamic> context,
    String? idToken,
  }) async {
    try {
      final response = await _dio.post(
        '${_config.baseUrl}/insight',
        data: jsonEncode({
          'type': type.name,
          'context': context,
        }),
        options: Options(headers: {
          'Content-Type': 'application/json',
          if (idToken != null) 'Authorization': 'Bearer $idToken',
        }),
      );
      return AiSuccess(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      final code = e.response?.statusCode?.toString();
      final msg = e.response?.data?['error'] as String? ??
          e.message ??
          'AI request failed';
      return AiFailure(msg, code: code);
    } catch (e) {
      return AiFailure('Unexpected error: $e');
    }
  }

  /// Generate a forecast adjustment for the current pipeline.
  Future<AiResult> forecastAdjustment({
    required Map<String, dynamic> pipelineSnapshot,
    String? idToken,
  }) async {
    return requestInsight(
      type: InsightType.forecastAdjustment,
      context: {'pipeline': pipelineSnapshot},
      idToken: idToken,
    );
  }

  /// Summarize a call transcript (or any long text).
  Future<AiResult> summarizeText({
    required String text,
    String? idToken,
  }) async {
    try {
      final response = await _dio.post(
        '${_config.baseUrl}/summarize',
        data: jsonEncode({'text': text}),
        options: Options(headers: {
          'Content-Type': 'application/json',
          if (idToken != null) 'Authorization': 'Bearer $idToken',
        }),
      );
      return AiSuccess(response.data as Map<String, dynamic>);
    } catch (e) {
      return AiFailure('Summarization failed: $e');
    }
  }

  /// Sentiment analysis on a snippet (e.g. recent ticket messages).
  Future<AiResult> analyzeSentiment({
    required String text,
    String? idToken,
  }) async {
    try {
      final response = await _dio.post(
        '${_config.baseUrl}/sentiment',
        data: jsonEncode({'text': text}),
        options: Options(headers: {
          'Content-Type': 'application/json',
          if (idToken != null) 'Authorization': 'Bearer $idToken',
        }),
      );
      return AiSuccess(response.data as Map<String, dynamic>);
    } catch (e) {
      return AiFailure('Sentiment analysis failed: $e');
    }
  }
}

final aiServiceProvider = Provider<AiService>((ref) => AiService(ref));

import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'storage_service.dart' show kStorageBaseUrl;

/// One thing the AI is allowed to do.
///
/// The model never touches the database. It returns a named action plus
/// arguments; the app validates it and performs the write using the
/// signed-in user's own Firestore permissions. A telecaller asking the AI
/// to reassign the whole team's leads still gets denied by the rules.
class AiAction {
  const AiAction({required this.name, required this.args, this.reply = ''});

  final String name;
  final Map<String, dynamic> args;
  final String reply;

  bool get isChat => name == 'reply';
}

class AiException implements Exception {
  AiException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Talks to Sarvam through the storage Worker.
class AiAgentService {
  AiAgentService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = (baseUrl ?? kStorageBaseUrl).replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _baseUrl;

  /// Actions the model may emit. Keep this list and the prompt in sync.
  static const String _toolSpec = '''
distribute_leads   {count?: int, to: [names], status?: "open"|"all", source?: "unassigned"|"all"}
                   Share leads evenly (round robin) across the named people.
assign_leads       {count?: int, to: name}      Give leads to one person.
create_task        {title: str, assignee?: name, due?: "YYYY-MM-DD", priority?: "low"|"medium"|"high"}
create_contact     {name: str, phone?: str, email?: str, company?: str}
log_call           {contact: str, outcome: "connected"|"callback"|"interested"|"notInterested"|"wrongNumber"|"doNotCall"|"converted", notes?: str}
summarise          {topic: "pipeline"|"team"|"leads"|"today"}
reply              {}                            Just answer in text.
''';

  String _systemPrompt(Map<String, dynamic> context) => '''
You are the assistant inside Nebula CRM, an Indian sales and telecalling app.
You help managers run their team by answering questions AND by performing
actions on their behalf.

Reply with ONE JSON object and nothing else. No markdown, no code fences.

Shape:
{"action": "<name>", "args": { ... }, "reply": "<short sentence for the user>"}

Available actions:
$_toolSpec

Rules:
- If the user is asking a question, use action "reply" and put the answer in "reply".
- Match people by the names listed in context. Use the exact name given.
- If a request is ambiguous or names someone not on the team, use "reply"
  and ask one short clarifying question. Never guess a person.
- "reply" must always be present and be plain, friendly English, one or two
  sentences. Amounts are in Indian rupees.

Current context:
${jsonEncode(context)}
''';

  Future<String> _idToken() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw AiException('Please sign in first.');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw AiException('Could not verify your session.');
    }
    return token;
  }

  /// Send [prompt] with [context] and get back an action to run.
  Future<AiAction> ask({
    required String prompt,
    required Map<String, dynamic> context,
    List<Map<String, String>> history = const [],
  }) async {
    final token = await _idToken();

    final messages = <Map<String, String>>[
      {'role': 'system', 'content': _systemPrompt(context)},
      ...history,
      {'role': 'user', 'content': prompt},
    ];

    late http.Response res;
    try {
      res = await _client
          .post(
            Uri.parse('$_baseUrl/v1/ai'),
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'messages': messages, 'temperature': 0.1}),
          )
          .timeout(const Duration(seconds: 45));
    } catch (e) {
      throw AiException('Could not reach the assistant. $e');
    }

    if (res.statusCode == 503) {
      throw AiException('The assistant is not configured yet.');
    }
    if (res.statusCode != 200) {
      throw AiException('Assistant error (${res.statusCode}).');
    }

    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    final choices = decoded['choices'] as List?;
    final content = choices == null || choices.isEmpty
        ? ''
        : ((choices.first as Map)['message'] as Map?)?['content'] as String? ??
            '';

    return _parse(content);
  }

  /// Extract the action from the model's reply.
  ///
  /// Models wrap JSON in prose or fences often enough that trusting a clean
  /// response is not worth the crash; fall back to treating it as chat.
  AiAction _parse(String raw) {
    var text = raw.trim();
    text = text.replaceAll(RegExp(r'```(?:json)?'), '').trim();

    final start = text.indexOf('{');
    final end = text.lastIndexOf('}');
    if (start == -1 || end <= start) {
      return AiAction(name: 'reply', args: const {}, reply: text);
    }

    try {
      final obj = jsonDecode(text.substring(start, end + 1))
          as Map<String, dynamic>;
      return AiAction(
        name: (obj['action'] as String?) ?? 'reply',
        args: (obj['args'] as Map?)?.cast<String, dynamic>() ?? const {},
        reply: (obj['reply'] as String?) ?? '',
      );
    } catch (_) {
      return AiAction(name: 'reply', args: const {}, reply: text);
    }
  }
}

final aiAgentServiceProvider = Provider<AiAgentService>((ref) {
  return AiAgentService();
});

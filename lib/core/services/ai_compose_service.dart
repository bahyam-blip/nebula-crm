import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'storage_service.dart' show kStorageBaseUrl;

/// What kind of text we want the model to produce.
enum AiTask {
  email,
  proposal,
  meetingSummary,
  callAnalysis,
  leadScore,
  dealPrediction,
  followUp,
  sentiment,
  forecast,
}

extension AiTaskX on AiTask {
  String get label {
    switch (this) {
      case AiTask.email:
        return 'Email writer';
      case AiTask.proposal:
        return 'Proposal generator';
      case AiTask.meetingSummary:
        return 'Meeting summary';
      case AiTask.callAnalysis:
        return 'Call analysis';
      case AiTask.leadScore:
        return 'Lead scoring';
      case AiTask.dealPrediction:
        return 'Deal prediction';
      case AiTask.followUp:
        return 'Follow-up suggestion';
      case AiTask.sentiment:
        return 'Customer sentiment';
      case AiTask.forecast:
        return 'Sales forecast';
    }
  }

  String get blurb {
    switch (this) {
      case AiTask.email:
        return 'Draft a message using what the CRM knows about the contact.';
      case AiTask.proposal:
        return 'Turn a few details into a structured proposal.';
      case AiTask.meetingSummary:
        return 'Summary, decisions, action items and owners.';
      case AiTask.callAnalysis:
        return 'Mood, intent, objections and the next move.';
      case AiTask.leadScore:
        return 'Rank leads by how promising they look right now.';
      case AiTask.dealPrediction:
        return 'Chance of closing, timeline and risks.';
      case AiTask.followUp:
        return 'The single best next action for this customer.';
      case AiTask.sentiment:
        return 'Whether a customer looks happy, cooling or at risk.';
      case AiTask.forecast:
        return 'Expected revenue from the current pipeline.';
    }
  }

  /// Free-text notes only make sense for the generative tasks; the analytical
  /// ones work purely from CRM data.
  bool get needsBrief =>
      this == AiTask.email ||
      this == AiTask.proposal ||
      this == AiTask.meetingSummary ||
      this == AiTask.callAnalysis;

  String get systemPrompt {
    const base =
        'You work inside Nebula CRM, used by an Indian sales team. Amounts '
        'are Indian rupees. Be concrete and brief; never invent facts that '
        'are not in the supplied data. Plain text only, no markdown.';
    switch (this) {
      case AiTask.email:
        return '$base Write a ready-to-send email. Start with "Subject:" on '
            'the first line, then a blank line, then the body. Warm but '
            'professional, under 150 words.';
      case AiTask.proposal:
        return '$base Write a proposal with these sections: Overview, '
            'Understanding of needs, What we propose, Pricing, Timeline, '
            'Next steps. Mark anything you cannot determine as [to confirm] '
            'instead of guessing.';
      case AiTask.meetingSummary:
        return '$base Produce four sections: Summary, Decisions, Action '
            'items (each with an owner), Deadlines. If the notes do not say '
            'who owns something, write "owner unassigned" rather than '
            'picking someone.';
      case AiTask.callAnalysis:
        return '$base Report: Mood, Buying intent (high/medium/low), '
            'Objections, Positive signals, Recommended follow-up. One or two '
            'lines each.';
      case AiTask.leadScore:
        return '$base Score each listed lead 0-100 for how promising it is, '
            'and give a one-line reason. Weigh recency of contact, call '
            'outcome, and whether anyone owns it. List the strongest first.';
      case AiTask.dealPrediction:
        return '$base For each deal give: chance of closing as a percentage, '
            'likely timeline, the main risk, and the recommended next action. '
            'Base it on stage, value, expected close date and staleness.';
      case AiTask.followUp:
        return '$base Recommend the single best next action per customer and '
            'why, in one line each. Prefer doing nothing over a pointless '
            'touch if the customer was contacted very recently.';
      case AiTask.sentiment:
        return '$base Classify each customer as Happy, Neutral, Cooling or '
            'At risk, with a one-line reason drawn from call outcomes and how '
            'long since anyone spoke to them.';
      case AiTask.forecast:
        return '$base Give: expected revenue this month and next, best and '
            'worst case, which deals carry the forecast, and what would most '
            'improve it. Show the reasoning in one short paragraph.';
    }
  }
}

class AiComposeException implements Exception {
  AiComposeException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Generates text and analysis from CRM data.
///
/// Shares the Worker proxy with the agent, so the Sarvam key stays server
/// side. This class only produces text; nothing here writes to Firestore.
class AiComposeService {
  AiComposeService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = (baseUrl ?? kStorageBaseUrl).replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _baseUrl;

  Future<String> run({
    required AiTask task,
    required Map<String, dynamic> data,
    String brief = '',
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw AiComposeException('Please sign in first.');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw AiComposeException('Could not verify your session.');
    }

    final userContent = StringBuffer()
      ..writeln('CRM data:')
      ..writeln(jsonEncode(data));
    if (brief.trim().isNotEmpty) {
      userContent
        ..writeln()
        ..writeln('What the user asked for:')
        ..writeln(brief.trim());
    }

    late http.Response res;
    try {
      res = await _client
          .post(
            Uri.parse('$_baseUrl/v1/ai'),
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'messages': [
                {'role': 'system', 'content': task.systemPrompt},
                {'role': 'user', 'content': userContent.toString()},
              ],
              'temperature': task == AiTask.email ? 0.4 : 0.2,
              'max_tokens': 1400,
            }),
          )
          .timeout(const Duration(seconds: 60));
    } catch (e) {
      throw AiComposeException('Could not reach the assistant. $e');
    }

    if (res.statusCode == 503) {
      throw AiComposeException('AI is not configured on the server yet.');
    }
    if (res.statusCode != 200) {
      throw AiComposeException('Assistant error (${res.statusCode}).');
    }

    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    final choices = decoded['choices'] as List?;
    final text = choices == null || choices.isEmpty
        ? ''
        : ((choices.first as Map)['message'] as Map?)?['content'] as String? ??
            '';

    if (text.trim().isEmpty) {
      throw AiComposeException('The assistant returned nothing. Try again.');
    }
    return text.trim();
  }
}

final aiComposeServiceProvider = Provider<AiComposeService>((ref) {
  return AiComposeService();
});

/// Deterministic lead score, computed locally.
///
/// Runs instantly and offline, and gives the AI a baseline to reason from
/// rather than inventing numbers. Recency dominates: a lead nobody has
/// touched in a fortnight is cold regardless of how it started.
int heuristicLeadScore({
  required DateTime? lastActivityAt,
  required int callAttempts,
  required String callStatus,
  required bool assigned,
  required bool hasPhone,
  required bool hasEmail,
}) {
  var score = 40;

  final days = lastActivityAt == null
      ? 999
      : DateTime.now().difference(lastActivityAt).inDays;
  if (days <= 1) {
    score += 25;
  } else if (days <= 3) {
    score += 18;
  } else if (days <= 7) {
    score += 10;
  } else if (days <= 14) {
    score += 2;
  } else if (days > 30) {
    score -= 15;
  }

  switch (callStatus) {
    case 'interested':
      score += 25;
    case 'callback':
      score += 15;
    case 'connected':
      score += 8;
    case 'attempted':
      score += 2;
    case 'notInterested':
      score -= 30;
    case 'wrongNumber':
    case 'doNotCall':
      score -= 45;
    case 'converted':
      score += 30;
  }

  // Persistence helps, but chasing forever is a signal in itself.
  if (callAttempts >= 6) {
    score -= 10;
  } else if (callAttempts >= 1) {
    score += 5;
  }

  if (assigned) score += 5;
  if (hasPhone) score += 5;
  if (hasEmail) score += 3;

  return score.clamp(0, 100);
}

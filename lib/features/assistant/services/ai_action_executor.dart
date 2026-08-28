import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/ai_agent_service.dart';
import '../../../core/services/remote/data_api.dart';
import '../../../core/services/remote/data_codec.dart';
import '../../auth/models/app_user.dart';
import '../../contacts/models/call_status.dart';
import '../../contacts/models/contact.dart';
import '../../telecalling/providers/telecalling_provider.dart';

/// Result of running an AI action.
class AiResult {
  const AiResult(this.message, {this.ok = true});
  final String message;
  final bool ok;
}

/// Turns an [AiAction] into real writes.
///
/// Everything here runs as the signed-in user, so security rules are the
/// backstop: if a telecaller talks the model into reassigning the whole
/// team's pipeline, Firestore still refuses. The model influences intent,
/// never authority.
class AiActionExecutor {
  AiActionExecutor(this._ref);

  final Ref _ref;

  Future<AiResult> run(AiAction action, AppUser me) async {
    switch (action.name) {
      case 'distribute_leads':
        return _distribute(action, me);
      case 'assign_leads':
        return _assign(action, me);
      case 'create_task':
        return _createTask(action, me);
      case 'create_contact':
        return _createContact(action, me);
      case 'log_call':
        return _logCall(action, me);
      case 'summarise':
      case 'reply':
        return AiResult(action.reply);
      default:
        return AiResult(
          action.reply.isNotEmpty
              ? action.reply
              : "I didn't understand that request.",
          ok: false,
        );
    }
  }

  List<AppUser> get _team =>
      _ref.read(teamMembersListProvider).valueOrNull ?? const [];

  List<Contact> get _leads =>
      _ref.read(teamLeadsProvider).valueOrNull ?? const [];

  /// Resolve a person by loose name match, so "give these to Asha" works.
  AppUser? _findUser(String? name) {
    if (name == null || name.trim().isEmpty) return null;
    final needle = name.trim().toLowerCase();
    for (final u in _team) {
      final n = u.displayName.toLowerCase();
      if (n == needle) return u;
    }
    for (final u in _team) {
      final n = u.displayName.toLowerCase();
      if (n.startsWith(needle) || n.split(' ').first == needle) return u;
    }
    for (final u in _team) {
      if (u.displayName.toLowerCase().contains(needle)) return u;
      if (u.email.toLowerCase() == needle) return u;
    }
    return null;
  }

  List<String> _pickLeads(Map<String, dynamic> args) {
    final source = (args['source'] as String?) ?? 'all';
    final status = (args['status'] as String?) ?? 'open';

    var pool = _leads.where((c) {
      if (status == 'open' && !c.callStatus.isOpen) return false;
      if (source == 'unassigned' && c.assignedTo != null) return false;
      return true;
    }).toList()
      // Oldest first, so "the first hundred" means the longest waiting.
      ..sort((a, b) => (a.createdAt ?? DateTime(0))
          .compareTo(b.createdAt ?? DateTime(0)));

    final count = (args['count'] as num?)?.toInt();
    if (count != null && count > 0 && count < pool.length) {
      pool = pool.sublist(0, count);
    }
    return pool.map((c) => c.id).toList();
  }

  Future<AiResult> _distribute(AiAction action, AppUser me) async {
    if (!me.role.canManageTeam) {
      return const AiResult('Only managers can distribute leads.', ok: false);
    }

    final rawNames = (action.args['to'] as List?) ?? const [];
    final targets = <AppUser>[];
    final missing = <String>[];
    for (final n in rawNames) {
      final u = _findUser(n.toString());
      if (u == null) {
        missing.add(n.toString());
      } else {
        targets.add(u);
      }
    }
    if (targets.isEmpty) {
      return AiResult(
        missing.isEmpty
            ? 'Tell me who should receive the leads.'
            : "I couldn't find ${missing.join(', ')} on your team.",
        ok: false,
      );
    }

    final ids = _pickLeads(action.args);
    if (ids.isEmpty) return const AiResult('No matching leads to share.', ok: false);

    await _ref.read(telecallingServiceProvider).distribute(
          contactIds: ids,
          userIds: targets.map((u) => u.id).toList(),
          actor: me,
        );

    final names = targets.map((u) => u.displayName).join(', ');
    final note = missing.isEmpty ? '' : " I skipped ${missing.join(', ')}.";
    return AiResult('Shared ${ids.length} leads across $names.$note');
  }

  Future<AiResult> _assign(AiAction action, AppUser me) async {
    if (!me.role.canManageTeam) {
      return const AiResult('Only managers can assign leads.', ok: false);
    }
    final target = _findUser(action.args['to'] as String?);
    if (target == null) {
      return const AiResult('Who should get them?', ok: false);
    }
    final ids = _pickLeads(action.args);
    if (ids.isEmpty) return const AiResult('No matching leads.', ok: false);

    await _ref.read(telecallingServiceProvider).reassign(
          contactIds: ids,
          toUserId: target.id,
          actor: me,
        );
    return AiResult('Gave ${ids.length} leads to ${target.displayName}.');
  }

  Future<AiResult> _createTask(AiAction action, AppUser me) async {
    final title = (action.args['title'] as String?)?.trim();
    if (title == null || title.isEmpty) {
      return const AiResult('What should the task say?', ok: false);
    }
    final assignee = _findUser(action.args['assignee'] as String?) ?? me;

    DateTime? due;
    final rawDue = action.args['due'] as String?;
    if (rawDue != null) due = DateTime.tryParse(rawDue);

    await _ref.read(remoteDataServiceProvider).set('tasks', null, {
      'title': title,
      'description': '',
      'status': 'pending',
      'priority': (action.args['priority'] as String?) ?? 'medium',
      'assigneeId': assignee.id,
      'assigneeName': assignee.displayName,
      'createdBy': me.id,
      'teamId': me.teamId,
      'dueDate': due == null ? null : Timestamp.fromDate(due),
      'createdAt': const ServerTimestamp(),
      'updatedAt': const ServerTimestamp(),
    });
    return AiResult('Task created for ${assignee.displayName}.');
  }

  Future<AiResult> _createContact(AiAction action, AppUser me) async {
    final name = (action.args['name'] as String?)?.trim();
    if (name == null || name.isEmpty) {
      return const AiResult('What is their name?', ok: false);
    }
    await _ref.read(remoteDataServiceProvider).set(AppConstants.colContacts, null, {
      'name': name,
      'phone': action.args['phone'],
      'email': action.args['email'],
      'company': action.args['company'],
      'status': ContactStatus.lead.name,
      'callStatus': CallStatus.notCalled.name,
      'ownerId': me.id,
      'assignedTo': me.id,
      'teamId': me.teamId,
      'source': 'ai_assistant',
      'tags': <String>[],
      'createdAt': const ServerTimestamp(),
      'updatedAt': const ServerTimestamp(),
      'lastActivityAt': const ServerTimestamp(),
    });
    return AiResult('Added $name to your contacts.');
  }

  Future<AiResult> _logCall(AiAction action, AppUser me) async {
    final needle = (action.args['contact'] as String?)?.toLowerCase().trim();
    if (needle == null || needle.isEmpty) {
      return const AiResult('Which contact was the call with?', ok: false);
    }
    Contact? match;
    for (final c in _leads) {
      if (c.name.toLowerCase().contains(needle)) {
        match = c;
        break;
      }
    }
    if (match == null) {
      return AiResult("I couldn't find a contact matching that.", ok: false);
    }

    await _ref.read(telecallingServiceProvider).logCall(
          contact: match,
          caller: me,
          outcome: CallStatusX.parse(action.args['outcome'] as String?),
          notes: action.args['notes'] as String?,
        );
    return AiResult('Logged the call with ${match.name}.');
  }
}

final aiActionExecutorProvider = Provider<AiActionExecutor>((ref) {
  return AiActionExecutor(ref);
});

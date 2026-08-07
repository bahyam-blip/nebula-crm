import 'package:cloud_firestore/cloud_firestore.dart';

import '../../../core/constants/app_constants.dart';
import '../../auth/models/app_user.dart';
import '../../contacts/models/contact.dart';
import '../../contacts/models/call_status.dart';
import '../models/call_log.dart';

/// Firestore collections owned by the telecalling feature.
class TeleCollections {
  static const String callLogs = 'call_logs';
  static const String auditLogs = 'audit_logs';
}

/// Writes for the calling workflow: dispositions, reassignment, rebalancing.
class TelecallingService {
  TelecallingService(this._db);

  final FirebaseFirestore _db;

  static const int _batchLimit = 400;

  // ── Disposition ──────────────────────────────────────────────

  /// Record the result of a call.
  ///
  /// Writes an immutable [CallLog] and updates the denormalised fields the
  /// lead queue sorts on, in one atomic batch so a lead can never show a
  /// disposition that has no matching log entry.
  Future<void> logCall({
    required Contact contact,
    required AppUser caller,
    required CallStatus outcome,
    String? notes,
    DateTime? followUpAt,
    int durationSeconds = 0,
  }) async {
    final batch = _db.batch();

    final logRef = _db.collection(TeleCollections.callLogs).doc();
    batch.set(logRef, {
      'contactId': contact.id,
      'contactName': contact.name,
      'callerId': caller.id,
      'callerName': caller.displayName,
      'teamId': caller.teamId,
      'outcome': outcome.name,
      'notes': notes,
      'durationSeconds': durationSeconds,
      'followUpAt':
          followUpAt != null ? Timestamp.fromDate(followUpAt) : null,
      'createdAt': FieldValue.serverTimestamp(),
    });

    final contactRef =
        _db.collection(AppConstants.colContacts).doc(contact.id);
    batch.update(contactRef, {
      'callStatus': outcome.name,
      'callAttempts': FieldValue.increment(1),
      'lastCallAt': FieldValue.serverTimestamp(),
      'lastCallOutcome': outcome.name,
      'lastCallBy': caller.id,
      'followUpAt':
          followUpAt != null ? Timestamp.fromDate(followUpAt) : null,
      'lastActivityAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
      // A converted lead graduates out of the calling funnel.
      if (outcome == CallStatus.converted)
        'status': ContactStatus.customer.name,
    });

    await batch.commit();
  }

  // ── Assignment ───────────────────────────────────────────────

  /// Reassign specific contacts to one owner.
  Future<void> reassign({
    required List<String> contactIds,
    required String? toUserId,
    required AppUser actor,
  }) async {
    for (var i = 0; i < contactIds.length; i += _batchLimit) {
      final end = (i + _batchLimit).clamp(0, contactIds.length);
      final batch = _db.batch();
      for (final id in contactIds.sublist(i, end)) {
        batch.update(_db.collection(AppConstants.colContacts).doc(id), {
          'assignedTo': toUserId,
          'ownerId': toUserId,
          'assignedBy': actor.id,
          'assignedAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    await _audit(
      action: 'leads.reassign',
      actor: actor,
      targetId: toUserId,
      summary: toUserId == null
          ? 'Unassigned ${contactIds.length} leads'
          : 'Reassigned ${contactIds.length} leads',
      metadata: {'count': contactIds.length, 'toUserId': toUserId},
    );
  }

  /// Spread [contactIds] evenly across [userIds], round robin.
  Future<Map<String, int>> distribute({
    required List<String> contactIds,
    required List<String> userIds,
    required AppUser actor,
  }) async {
    if (userIds.isEmpty) return {};

    final tally = <String, int>{for (final u in userIds) u: 0};

    for (var i = 0; i < contactIds.length; i += _batchLimit) {
      final end = (i + _batchLimit).clamp(0, contactIds.length);
      final batch = _db.batch();
      for (var j = i; j < end; j++) {
        final assignee = userIds[j % userIds.length];
        tally[assignee] = (tally[assignee] ?? 0) + 1;
        batch.update(
          _db.collection(AppConstants.colContacts).doc(contactIds[j]),
          {
            'assignedTo': assignee,
            'ownerId': assignee,
            'assignedBy': actor.id,
            'assignedAt': FieldValue.serverTimestamp(),
            'updatedAt': FieldValue.serverTimestamp(),
          },
        );
      }
      await batch.commit();
    }

    await _audit(
      action: 'leads.distribute',
      actor: actor,
      summary:
          'Distributed ${contactIds.length} leads across ${userIds.length} callers',
      metadata: {'count': contactIds.length, 'callers': userIds.length},
    );
    return tally;
  }

  /// Even out open leads so every caller holds a similar number.
  ///
  /// Only *open* leads move. Dragging a lead away from the person who just
  /// spoke to it destroys context, so anything already worked stays put.
  Future<Map<String, int>> rebalance({
    required List<Contact> openLeads,
    required List<String> userIds,
    required AppUser actor,
  }) async {
    if (userIds.isEmpty || openLeads.isEmpty) return {};

    final held = <String, List<Contact>>{for (final u in userIds) u: []};
    final loose = <Contact>[];

    for (final c in openLeads) {
      final owner = c.assignedTo;
      if (owner != null && held.containsKey(owner)) {
        held[owner]!.add(c);
      } else {
        loose.add(c);
      }
    }

    final total = openLeads.length;
    final target = (total / userIds.length).floor();

    // Pull the surplus off over-loaded callers.
    for (final u in userIds) {
      final list = held[u]!;
      while (list.length > target + 1) {
        loose.add(list.removeLast());
      }
    }

    // Hand the pool to whoever is furthest below target.
    final moves = <String, String>{}; // contactId -> userId
    loose.sort((a, b) => a.name.compareTo(b.name));
    for (final c in loose) {
      var lowest = userIds.first;
      for (final u in userIds) {
        if (held[u]!.length < held[lowest]!.length) lowest = u;
      }
      held[lowest]!.add(c);
      moves[c.id] = lowest;
    }

    for (var i = 0; i < moves.length; i += _batchLimit) {
      final slice = moves.entries.skip(i).take(_batchLimit);
      final batch = _db.batch();
      for (final e in slice) {
        batch.update(_db.collection(AppConstants.colContacts).doc(e.key), {
          'assignedTo': e.value,
          'ownerId': e.value,
          'assignedBy': actor.id,
          'assignedAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    await _audit(
      action: 'leads.rebalance',
      actor: actor,
      summary: 'Rebalanced ${moves.length} open leads across '
          '${userIds.length} callers',
      metadata: {'moved': moves.length, 'callers': userIds.length},
    );

    return {for (final u in userIds) u: held[u]!.length};
  }

  // ── Audit ────────────────────────────────────────────────────

  Future<void> _audit({
    required String action,
    required AppUser actor,
    required String summary,
    String? targetId,
    Map<String, dynamic> metadata = const {},
  }) async {
    await _db.collection(TeleCollections.auditLogs).add({
      'action': action,
      'actorId': actor.id,
      'actorName': actor.displayName,
      'teamId': actor.teamId,
      'targetId': targetId,
      'summary': summary,
      'metadata': metadata,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  /// Public wrapper so screens can record their own privileged actions.
  Future<void> recordAudit({
    required String action,
    required AppUser actor,
    required String summary,
    String? targetId,
    Map<String, dynamic> metadata = const {},
  }) =>
      _audit(
        action: action,
        actor: actor,
        summary: summary,
        targetId: targetId,
        metadata: metadata,
      );

  // ── Aggregation ──────────────────────────────────────────────

  /// Roll call logs and lead ownership up into per-caller stats.
  static List<CallerStats> buildStats({
    required List<AppUser> callers,
    required List<Contact> contacts,
    required List<CallLog> logs,
  }) {
    final byId = {
      for (final c in callers)
        c.id: CallerStats(callerId: c.id, callerName: c.displayName),
    };

    for (final c in contacts) {
      final owner = c.assignedTo ?? c.ownerId;
      final s = byId[owner];
      if (s == null) continue;
      s.assigned++;
      if (c.callStatus.isOpen) s.pending++;
    }

    for (final l in logs) {
      final s = byId[l.callerId];
      if (s == null) continue;
      s.calls++;
      s.talkSeconds += l.durationSeconds;
      switch (l.outcome) {
        case CallStatus.connected:
        case CallStatus.interested:
        case CallStatus.notInterested:
        case CallStatus.callback:
        case CallStatus.converted:
          s.connected++;
        default:
          break;
      }
      if (l.outcome == CallStatus.interested) s.interested++;
      if (l.outcome == CallStatus.converted) s.converted++;
    }

    final list = byId.values.toList()
      ..sort((a, b) => b.calls.compareTo(a.calls));
    return list;
  }
}

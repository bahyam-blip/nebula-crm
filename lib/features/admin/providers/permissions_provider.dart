import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/firestore_service.dart';
import '../../auth/models/app_user.dart';
import '../../auth/providers/auth_provider.dart';

/// Areas of the business a super admin can open up to an admin.
///
/// These are monitoring scopes, not a second security system. Firestore
/// rules remain the hard boundary - an admin who is denied a scope here
/// simply does not see that section, and the rules independently decide
/// what data any role may read. Treating UI toggles as security would be a
/// mistake; treating them as "what should this person be watching" is the
/// point.
enum MonitorScope {
  contacts,
  pipeline,
  telecalling,
  performance,
  commissions,
  team,
  tickets,
  campaigns,
}

extension MonitorScopeX on MonitorScope {
  String get label {
    switch (this) {
      case MonitorScope.contacts:
        return 'Contacts and leads';
      case MonitorScope.pipeline:
        return 'Sales pipeline';
      case MonitorScope.telecalling:
        return 'Telecalling activity';
      case MonitorScope.performance:
        return 'Calling performance';
      case MonitorScope.commissions:
        return 'Commissions and payouts';
      case MonitorScope.team:
        return 'Team members';
      case MonitorScope.tickets:
        return 'Support tickets';
      case MonitorScope.campaigns:
        return 'Marketing campaigns';
    }
  }

  String get blurb {
    switch (this) {
      case MonitorScope.contacts:
        return 'See and distribute the whole contact base';
      case MonitorScope.pipeline:
        return 'Deals, stages and forecast';
      case MonitorScope.telecalling:
        return 'Call logs and lead queues';
      case MonitorScope.performance:
        return 'Per-caller stats and leaderboards';
      case MonitorScope.commissions:
        return 'Who earned what, approve payouts';
      case MonitorScope.team:
        return 'Roster and roles';
      case MonitorScope.tickets:
        return 'Support queue';
      case MonitorScope.campaigns:
        return 'Marketing activity';
    }
  }
}

/// What one admin is allowed to monitor.
class MonitorPermissions {
  const MonitorPermissions(this.scopes);

  final Set<MonitorScope> scopes;

  bool has(MonitorScope s) => scopes.contains(s);

  static const MonitorPermissions none = MonitorPermissions(<MonitorScope>{});

  /// Everything, used for super admins who are never restricted.
  static MonitorPermissions get all =>
      MonitorPermissions(MonitorScope.values.toSet());

  factory MonitorPermissions.fromList(List<dynamic>? raw) {
    if (raw == null) return none;
    return MonitorPermissions(
      raw
          .map((e) => MonitorScope.values
              .where((s) => s.name == e.toString())
              .firstOrNull)
          .whereType<MonitorScope>()
          .toSet(),
    );
  }

  List<String> toList() => scopes.map((s) => s.name).toList();
}

extension _First<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

/// Permissions for the signed-in user.
///
/// A super admin always has everything; a manager gets the operational
/// scopes; everyone else gets none, because monitoring screens are for
/// people who supervise others.
final myMonitorPermissionsProvider = Provider<MonitorPermissions>((ref) {
  final me = ref.watch(currentAppUserValueProvider);
  if (me == null) return MonitorPermissions.none;

  if (me.role == UserRole.superAdmin) return MonitorPermissions.all;

  if (me.role == UserRole.admin) {
    final granted = ref.watch(grantedPermissionsProvider).valueOrNull;
    // Until a super admin decides otherwise, a new admin can monitor the
    // day-to-day but not money or roles.
    return granted?[me.id] ??
        const MonitorPermissions({
          MonitorScope.contacts,
          MonitorScope.pipeline,
          MonitorScope.telecalling,
          MonitorScope.performance,
        });
  }

  if (me.role == UserRole.manager) {
    return const MonitorPermissions({
      MonitorScope.contacts,
      MonitorScope.telecalling,
      MonitorScope.performance,
    });
  }

  return MonitorPermissions.none;
});

/// Per-admin grants, stored on the team settings document.
final grantedPermissionsProvider =
    StreamProvider<Map<String, MonitorPermissions>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const {});
  return ref
      .watch(firestoreProvider)
      .collection(AppConstants.colSettings)
      .doc(teamId)
      .snapshots()
      .map((doc) {
    final raw = (doc.data() ?? const {})['monitorPermissions']
        as Map<String, dynamic>?;
    if (raw == null) return <String, MonitorPermissions>{};
    return raw.map((k, v) =>
        MapEntry(k, MonitorPermissions.fromList(v as List<dynamic>?)));
  });
});

class PermissionService {
  PermissionService(this._db);
  final FirebaseFirestore _db;

  Future<void> grant({
    required String teamId,
    required String userId,
    required MonitorPermissions permissions,
  }) async {
    await _db.collection(AppConstants.colSettings).doc(teamId).set({
      'monitorPermissions': {userId: permissions.toList()},
    }, SetOptions(merge: true));
  }
}

final permissionServiceProvider = Provider<PermissionService>((ref) {
  return PermissionService(ref.watch(firestoreProvider));
});

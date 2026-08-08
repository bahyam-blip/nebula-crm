import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/capabilities.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/firestore_service.dart';
import '../models/app_user.dart';
import 'auth_provider.dart';

/// What the signed-in user may actually do.
///
/// Resolution order matches how Salesforce and Zoho behave: the role
/// supplies a baseline profile, and an explicit per-user list overrides it
/// entirely once someone has customised it. Null means untouched; an empty
/// list means deliberately stripped, and those must not be confused.
final myCapabilitiesProvider = Provider<Set<Capability>>((ref) {
  final me = ref.watch(currentAppUserValueProvider);
  return capabilitiesOf(me);
});

Set<Capability> capabilitiesOf(AppUser? user) {
  if (user == null) return const {};

  // A super admin is never locked out of their own workspace - otherwise a
  // mis-tap in the permission editor could leave nobody able to fix it.
  if (user.role == UserRole.superAdmin) return Capability.values.toSet();

  final custom = user.capabilities;
  if (custom == null) return defaultCapabilitiesFor(user.role);

  return custom
      .map(CapabilityX.parse)
      .whereType<Capability>()
      .toSet();
}

/// Convenience for widgets: `ref.can(Capability.contactsImport)`.
extension CapabilityCheck on WidgetRef {
  bool can(Capability c) => read(myCapabilitiesProvider).contains(c);
}

extension CapabilityWatch on Set<Capability> {
  bool can(Capability c) => contains(c);
}

class CapabilityService {
  CapabilityService(this._db);
  final FirebaseFirestore _db;

  /// Replace one person's capability list.
  Future<void> setFor(String userId, Set<Capability> caps) async {
    await _db.collection(AppConstants.colUsers).doc(userId).update({
      'capabilities': caps.map((c) => c.id).toList()..sort(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Drop customisations so the person follows their role again.
  Future<void> resetToRoleDefaults(String userId, UserRole role) async {
    await _db.collection(AppConstants.colUsers).doc(userId).update({
      'capabilities': defaultCapabilityIdsFor(role),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}

final capabilityServiceProvider = Provider<CapabilityService>((ref) {
  return CapabilityService(ref.watch(firestoreProvider));
});

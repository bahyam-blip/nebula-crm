import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

import '../../../core/services/remote/data_codec.dart';

/// User role within a team.
///
/// Hierarchy:
///   superAdmin  — full god-mode (manages admins + team settings across all teams)
///   admin       — manages team members and all team data
///   manager     — views/manages all team deals/tickets
///   salesRep    — manages own contacts/deals
///   supportAgent — manages assigned tickets + reads all contacts
///   viewer      — read-only access to team data
enum UserRole { superAdmin, admin, manager, salesRep, supportAgent, viewer }

extension UserRoleX on UserRole {
  String get label {
    switch (this) {
      case UserRole.superAdmin:
        return 'Super Admin';
      case UserRole.admin:
        return 'Admin';
      case UserRole.manager:
        return 'Manager';
      case UserRole.salesRep:
        return 'Sales Rep';
      case UserRole.supportAgent:
        return 'Support Agent';
      case UserRole.viewer:
        return 'Viewer';
    }
  }

  /// Short label for chips/badges.
  String get shortLabel {
    switch (this) {
      case UserRole.superAdmin:
        return 'SUPER';
      case UserRole.admin:
        return 'ADMIN';
      case UserRole.manager:
        return 'MGR';
      case UserRole.salesRep:
        return 'SALES';
      case UserRole.supportAgent:
        return 'SUPPORT';
      case UserRole.viewer:
        return 'VIEWER';
    }
  }

  /// True if this role can edit deals (create/update/delete).
  bool get canEditDeals =>
      this == UserRole.superAdmin ||
      this == UserRole.admin ||
      this == UserRole.manager ||
      this == UserRole.salesRep;

  /// True if this role can manage the entire team (invite, remove, assign roles).
  bool get canManageTeam =>
      this == UserRole.superAdmin || this == UserRole.admin;

  /// True if this role can promote/demote other users.
  bool get canChangeRoles =>
      this == UserRole.superAdmin || this == UserRole.admin;

  /// True if this role can manage marketing campaigns.
  bool get canManageCampaigns =>
      this == UserRole.superAdmin ||
      this == UserRole.admin ||
      this == UserRole.manager;

  /// True if this role can manage tickets (assign, change status, etc.).
  bool get canManageTickets =>
      this == UserRole.superAdmin ||
      this == UserRole.admin ||
      this == UserRole.manager ||
      this == UserRole.supportAgent;

  /// True if this role can edit knowledge base articles.
  bool get canEditKnowledgeBase =>
      this == UserRole.superAdmin ||
      this == UserRole.admin ||
      this == UserRole.manager;

  /// Numeric rank for comparison (higher = more privileged).
  int get rank {
    switch (this) {
      case UserRole.superAdmin:
        return 100;
      case UserRole.admin:
        return 80;
      case UserRole.manager:
        return 60;
      case UserRole.salesRep:
        return 40;
      case UserRole.supportAgent:
        return 40;
      case UserRole.viewer:
        return 20;
    }
  }

  /// True if this user outranks [other] (strictly).
  bool outranks(UserRole other) => rank > other.rank;

  /// Color for role badges — used in UI.
  /// (Returns a hex string to avoid coupling this model to Flutter.)
  String get badgeColorHex {
    switch (this) {
      case UserRole.superAdmin:
        return '#FF5C8A'; // magenta — highest
      case UserRole.admin:
        return '#B07CFF'; // purple
      case UserRole.manager:
        return '#6C8CFF'; // indigo
      case UserRole.salesRep:
        return '#3DD8D8'; // cyan
      case UserRole.supportAgent:
        return '#3DD9A0'; // green
      case UserRole.viewer:
        return '#9AA3BC'; // gray
    }
  }
}

/// A user document in `users/{uid}`.
class AppUser extends Equatable {
  const AppUser({
    required this.id,
    required this.email,
    required this.displayName,
    this.photoUrl,
    this.role = UserRole.salesRep,
    this.teamId,
    this.phone,
    this.capabilities,
    this.title,
    this.lastActiveAt,
    this.createdAt,
    this.preferences = const UserPreferences(),
  });

  final String id;
  final String email;
  final String displayName;
  final String? photoUrl;
  final UserRole role;
  final String? teamId;
  final String? phone;

  /// Effective capability ids for this person.
  ///
  /// Null means "never customised" - fall back to the role's defaults. An
  /// empty list is meaningfully different: it means an admin deliberately
  /// revoked everything.
  final List<String>? capabilities;
  final String? title;
  final DateTime? lastActiveAt;
  final DateTime? createdAt;
  final UserPreferences preferences;

  factory AppUser.fromFirestore(DataDoc doc) {
    final data = doc.data;
    return AppUser(
      id: doc.id,
      email: data['email'] as String? ?? '',
      displayName: data['displayName'] as String? ?? '',
      photoUrl: data['photoUrl'] as String?,
      role: _parseRole(data['role'] as String?),
      teamId: data['teamId'] as String?,
      phone: data['phone'] as String?,
      capabilities: (data['capabilities'] as List?)
          ?.map((e) => e.toString())
          .toList(),
      title: data['title'] as String?,
      lastActiveAt: (data['lastActiveAt'] as Timestamp?)?.toDate(),
      createdAt: (data['createdAt'] as Timestamp?)?.toDate(),
      preferences: UserPreferences.fromMap(
        data['preferences'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'email': email,
        'displayName': displayName,
        'photoUrl': photoUrl,
        'role': role.name,
        'teamId': teamId,
        'phone': phone,
        'capabilities': capabilities,
        'title': title,
        'lastActiveAt': lastActiveAt != null
            ? Timestamp.fromDate(lastActiveAt!)
            : const ServerTimestamp(),
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : const ServerTimestamp(),
        'preferences': preferences.toMap(),
      };

  AppUser copyWith({
    String? email,
    String? displayName,
    String? photoUrl,
    UserRole? role,
    String? teamId,
    String? phone,
    List<String>? capabilities,
    String? title,
    DateTime? lastActiveAt,
    UserPreferences? preferences,
  }) {
    return AppUser(
      id: id,
      email: email ?? this.email,
      displayName: displayName ?? this.displayName,
      photoUrl: photoUrl ?? this.photoUrl,
      role: role ?? this.role,
      teamId: teamId ?? this.teamId,
      phone: phone ?? this.phone,
      capabilities: capabilities ?? this.capabilities,
      title: title ?? this.title,
      lastActiveAt: lastActiveAt ?? this.lastActiveAt,
      createdAt: createdAt,
      preferences: preferences ?? this.preferences,
    );
  }

  static UserRole _parseRole(String? s) {
    return UserRole.values.firstWhere(
      (r) => r.name == s,
      orElse: () => UserRole.salesRep,
    );
  }

  @override
  List<Object?> get props =>
      [id, email, displayName, photoUrl, role, teamId, phone, title, lastActiveAt];
}

/// Per-user UI preferences.
class UserPreferences extends Equatable {
  const UserPreferences({
    this.notifyDealUpdates = true,
    this.notifyNewLeads = true,
    this.notifyTicketAssignments = true,
    this.notifyAiInsights = true,
    this.weeklyDigest = true,
    this.startScreen = 'dashboard',
  });

  final bool notifyDealUpdates;
  final bool notifyNewLeads;
  final bool notifyTicketAssignments;
  final bool notifyAiInsights;
  final bool weeklyDigest;
  final String startScreen;

  factory UserPreferences.fromMap(Map<String, dynamic> m) => UserPreferences(
        notifyDealUpdates: m['notifyDealUpdates'] as bool? ?? true,
        notifyNewLeads: m['notifyNewLeads'] as bool? ?? true,
        notifyTicketAssignments: m['notifyTicketAssignments'] as bool? ?? true,
        notifyAiInsights: m['notifyAiInsights'] as bool? ?? true,
        weeklyDigest: m['weeklyDigest'] as bool? ?? true,
        startScreen: m['startScreen'] as String? ?? 'dashboard',
      );

  Map<String, dynamic> toMap() => {
        'notifyDealUpdates': notifyDealUpdates,
        'notifyNewLeads': notifyNewLeads,
        'notifyTicketAssignments': notifyTicketAssignments,
        'notifyAiInsights': notifyAiInsights,
        'weeklyDigest': weeklyDigest,
        'startScreen': startScreen,
      };

  @override
  List<Object?> get props => [
        notifyDealUpdates, notifyNewLeads, notifyTicketAssignments,
        notifyAiInsights, weeklyDigest, startScreen,
      ];
}

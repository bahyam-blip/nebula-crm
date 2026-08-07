import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:equatable/equatable.dart';

/// User role within a team.
enum UserRole { owner, admin, manager, salesRep, supportAgent, viewer }

extension UserRoleX on UserRole {
  String get label {
    switch (this) {
      case UserRole.owner:
        return 'Owner';
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

  bool get canEditDeals =>
      this == UserRole.owner ||
      this == UserRole.admin ||
      this == UserRole.manager ||
      this == UserRole.salesRep;

  bool get canManageTeam =>
      this == UserRole.owner || this == UserRole.admin;
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
  final String? title;
  final DateTime? lastActiveAt;
  final DateTime? createdAt;
  final UserPreferences preferences;

  factory AppUser.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return AppUser(
      id: doc.id,
      email: data['email'] as String? ?? '',
      displayName: data['displayName'] as String? ?? '',
      photoUrl: data['photoUrl'] as String?,
      role: _parseRole(data['role'] as String?),
      teamId: data['teamId'] as String?,
      phone: data['phone'] as String?,
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
        'title': title,
        'lastActiveAt': lastActiveAt != null
            ? Timestamp.fromDate(lastActiveAt!)
            : FieldValue.serverTimestamp(),
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : FieldValue.serverTimestamp(),
        'preferences': preferences.toMap(),
      };

  AppUser copyWith({
    String? email,
    String? displayName,
    String? photoUrl,
    UserRole? role,
    String? teamId,
    String? phone,
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

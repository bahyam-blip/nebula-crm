import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../auth/models/app_user.dart';
import '../../auth/providers/auth_provider.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/firestore_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/extensions.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common_widgets.dart';

/// Stream of all users in the current user's team (admin only).
final teamMembersProvider = StreamProvider<List<AppUser>>((ref) async* {
  final currentUser = ref.watch(currentAppUserValueProvider);
  if (currentUser == null) {
    yield [];
    return;
  }
  final db = FirebaseFirestore.instance;
  yield* db
      .collection(AppConstants.colUsers)
      .where('teamId', isEqualTo: currentUser.teamId)
      .snapshots()
      .map((snap) => snap.docs.map((d) => AppUser.fromFirestore(d)).toList());
});

/// All users across all teams — superAdmin only.
final allUsersProvider = StreamProvider<List<AppUser>>((ref) {
  return FirebaseFirestore.instance
      .collection(AppConstants.colUsers)
      .snapshots()
      .map((snap) => snap.docs.map((d) => AppUser.fromFirestore(d)).toList());
});

class TeamManagementScreen extends ConsumerWidget {
  const TeamManagementScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentUser = ref.watch(currentAppUserValueProvider);
    if (currentUser == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }

    final isSuperAdmin = currentUser.role == UserRole.superAdmin;
    final usersAsync = isSuperAdmin
        ? ref.watch(allUsersProvider)
        : ref.watch(teamMembersProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(isSuperAdmin ? 'All Users' : 'Team Members'),
      ),
      body: usersAsync.when(
        data: (users) {
          if (users.isEmpty) {
            return const EmptyState(
              icon: Icons.people_outline,
              title: 'No users yet',
              subtitle: 'Invite team members to get started.',
            );
          }
          // Sort by role rank (highest first)
          users.sort((a, b) => b.role.rank.compareTo(a.role.rank));
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: users.length,
            separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
            itemBuilder: (_, i) => _UserTile(
              user: users[i],
              isCurrentUser: users[i].id == currentUser.id,
              canManage: currentUser.role.canChangeRoles &&
                  currentUser.role.outranks(users[i].role),
              onRoleChanged: (newRole) =>
                  _changeRole(ref, users[i], newRole, context),
              onDelete: () => _confirmDelete(context, ref, users[i]),
            ),
          );
        },
        loading: () => const Center(
            child: CircularProgressIndicator(strokeWidth: 2)),
        error: (e, _) => ErrorState(message: 'Failed to load users: $e'),
      ),
    );
  }

  Future<void> _changeRole(
    WidgetRef ref,
    AppUser user,
    UserRole newRole,
    BuildContext context,
  ) async {
    try {
      await FirebaseFirestore.instance
          .collection(AppConstants.colUsers)
          .doc(user.id)
          .update({
        'role': newRole.name,
        'updatedAt': FieldValue.serverTimestamp(),
      });
      if (!context.mounted) return;
      context.showSuccess('${user.displayName} is now ${newRole.label}');
    } catch (e) {
      if (!context.mounted) return;
      context.showError('Failed: $e');
    }
  }

  Future<void> _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    AppUser user,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Remove user?'),
        content: Text(
          'This will remove ${user.displayName} from the team. '
          'Their contacts and deals will remain but be unowned.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await FirebaseFirestore.instance
          .collection(AppConstants.colUsers)
          .doc(user.id)
          .delete();
      if (!context.mounted) return;
      context.showSuccess('User removed');
    } catch (e) {
      if (!context.mounted) return;
      context.showError('Failed: $e');
    }
  }
}

class _UserTile extends StatelessWidget {
  const _UserTile({
    required this.user,
    required this.isCurrentUser,
    required this.canManage,
    required this.onRoleChanged,
    required this.onDelete,
  });

  final AppUser user;
  final bool isCurrentUser;
  final bool canManage;
  final void Function(UserRole) onRoleChanged;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final color = _hexToColor(user.role.badgeColorHex);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      leading: CircleAvatar(
        radius: 22,
        backgroundColor: color.withValues(alpha: 0.2),
        backgroundImage: user.photoUrl != null
            ? NetworkImage(user.photoUrl!)
            : null,
        child: user.photoUrl == null
            ? Text(
                user.displayName.initials,
                style: context.textTheme.titleSmall?.copyWith(color: color),
              )
            : null,
      ),
      title: Row(
        children: [
          Expanded(
            child: Text(
              user.displayName + (isCurrentUser ? ' (You)' : ''),
              style: context.textTheme.titleSmall,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Text(
            user.email,
            style: context.textTheme.bodySmall
                ?.copyWith(color: AppColors.textSecondary),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                      color: color.withValues(alpha: 0.3), width: 0.5),
                ),
                child: Text(
                  user.role.shortLabel,
                  style: context.textTheme.labelSmall?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (user.lastActiveAt != null) ...[
                const SizedBox(width: 8),
                Text(
                  'Active ${Formatters.timeAgo(user.lastActiveAt!)}',
                  style: context.textTheme.labelSmall,
                ),
              ],
            ],
          ),
        ],
      ),
      trailing: canManage
          ? PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert, size: 20),
              onSelected: (v) {
                if (v == 'delete') {
                  onDelete();
                } else {
                  final role = UserRole.values.firstWhere(
                    (r) => r.name == v,
                    orElse: () => UserRole.viewer,
                  );
                  onRoleChanged(role);
                }
              },
              itemBuilder: (_) => [
                const PopupMenuHeader(label: 'Change role'),
                for (final role in UserRole.values)
                  PopupMenuItem(
                    value: role.name,
                    enabled: role != user.role,
                    child: Row(
                      children: [
                        Icon(
                          role == user.role
                              ? Icons.radio_button_checked
                              : Icons.radio_button_unchecked,
                          size: 16,
                          color: AppColors.textSecondary,
                        ),
                        const SizedBox(width: 8),
                        Text(role.label),
                      ],
                    ),
                  ),
                const PopupMenuDivider(),
                const PopupMenuItem(
                  value: 'delete',
                  child: Row(
                    children: [
                      Icon(Icons.delete_outline, color: AppColors.danger, size: 18),
                      SizedBox(width: 8),
                      Text('Remove from team',
                          style: TextStyle(color: AppColors.danger)),
                    ],
                  ),
                ),
              ],
            )
          : null,
    );
  }

  Color _hexToColor(String hex) {
    final clean = hex.replaceAll('#', '');
    return Color(int.parse('FF$clean', radix: 16));
  }
}

class PopupMenuHeader extends PopupMenuEntry<String> {
  const PopupMenuHeader({super.key, required this.label});
  final String label;

  @override
  double get height => 32;

  @override
  bool represents(String? value) => false;

  @override
  State<PopupMenuHeader> createState() => _PopupMenuHeaderState();
}

class _PopupMenuHeaderState extends State<PopupMenuHeader> {
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Text(
        widget.label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: AppColors.textTertiary,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

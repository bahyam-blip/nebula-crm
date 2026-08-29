import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/services/firebase_boot.dart';
import '../../../../core/services/remote/data_api.dart';
import '../../../../core/services/remote/data_codec.dart';
import '../../../../core/services/storage_service.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/services/auth_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../models/app_user.dart';
import '../../providers/auth_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(currentAppUserProvider);
    final user = userAsync.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit, size: 20),
            onPressed: user == null ? null : () => context.push('/profile/edit'),
          ),
        ],
      ),
      // A failed load must be VISIBLE and retryable — a bare spinner here
      // read as "the profile page never opens" whenever one network tick
      // failed, with no way to recover short of killing the app.
      body: user == null
          ? _LoadingOrError(state: userAsync)
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                // ── Avatar + name ─────────────────────────────────
                Center(
                  child: Column(
                    children: [
                      GestureDetector(
                        onTap: () => _changeAvatar(context, ref, user.id),
                        child: Stack(
                          alignment: Alignment.bottomRight,
                          children: [
                            CircleAvatar(
                              radius: 56,
                              backgroundColor:
                                  _hexToColor(user.role.badgeColorHex)
                                      .withValues(alpha: 0.2),
                              backgroundImage: user.photoUrl != null
                                  ? NetworkImage(resolveMediaUrl(user.photoUrl))
                                  : null,
                              child: user.photoUrl == null
                                  ? Text(
                                      user.displayName.initials,
                                      style: context.textTheme.displaySmall
                                          ?.copyWith(
                                        color: _hexToColor(
                                            user.role.badgeColorHex),
                                      ),
                                    )
                                  : null,
                            ),
                            Container(
                              padding: const EdgeInsets.all(6),
                              decoration: const BoxDecoration(
                                color: AppColors.primary,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.camera_alt,
                                  size: 16, color: Colors.white),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        user.displayName,
                        style: context.textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        user.email,
                        style: context.textTheme.bodySmall
                            ?.copyWith(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: 12),
                      _RoleBadge(role: user.role),
                    ],
                  ),
                ),

                const SizedBox(height: 32),

                // ── Account info ──────────────────────────────────
                _SectionLabel('Account'),
                Card(
                  child: Column(
                    children: [
                      ListTile(
                        leading: const Icon(Icons.badge_outlined, size: 20),
                        title: const Text('Title'),
                        subtitle: Text(user.title ?? 'Not set'),
                      ),
                      const Divider(height: 1, indent: 56),
                      ListTile(
                        leading: const Icon(Icons.phone_outlined, size: 20),
                        title: const Text('Phone'),
                        subtitle: Text(user.phone ?? 'Not set'),
                      ),
                      const Divider(height: 1, indent: 56),
                      ListTile(
                        leading:
                            const Icon(Icons.calendar_today_outlined, size: 20),
                        title: const Text('Joined'),
                        subtitle: Text(user.createdAt != null
                            ? Formatters.date(user.createdAt!)
                            : '—'),
                      ),
                      const Divider(height: 1, indent: 56),
                      ListTile(
                        leading: const Icon(Icons.access_time, size: 20),
                        title: const Text('Last active'),
                        subtitle: Text(user.lastActiveAt != null
                            ? Formatters.timeAgo(user.lastActiveAt!)
                            : '—'),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 20),

                // ── Team info ─────────────────────────────────────
                _SectionLabel('Team'),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.group_outlined, size: 20),
                    title: const Text('Team ID'),
                    subtitle: Text(user.teamId ?? 'No team'),
                    trailing: user.teamId == null || user.teamId!.isEmpty
                        ? (user.role.canManageTeam
                            ? const Icon(Icons.chevron_right, size: 20)
                            : null)
                        : const Icon(Icons.copy, size: 18),
                    onTap: user.teamId == null || user.teamId!.isEmpty
                        ? (user.role.canManageTeam ? () => context.push('/team') : null)
                        : () async {
                            await Clipboard.setData(
                                ClipboardData(text: user.teamId!));
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content: Text('Team ID copied to clipboard')),
                            );
                          },
                  ),
                ),

                const SizedBox(height: 20),

                // ── Notification preferences ─────────────────────
                _SectionLabel('Notifications'),
                _PreferencesCard(user: user),

                const SizedBox(height: 20),

                // ── Permissions summary ──────────────────────────
                _SectionLabel('Your permissions'),
                Card(
                  child: Column(
                    children: [
                      _PermissionTile(
                        icon: Icons.view_kanban,
                        label: 'Edit deals',
                        granted: user.role.canEditDeals,
                      ),
                      const Divider(height: 1, indent: 56),
                      _PermissionTile(
                        icon: Icons.people,
                        label: 'Manage team members',
                        granted: user.role.canManageTeam,
                      ),
                      const Divider(height: 1, indent: 56),
                      _PermissionTile(
                        icon: Icons.campaign,
                        label: 'Manage campaigns',
                        granted: user.role.canManageCampaigns,
                      ),
                      const Divider(height: 1, indent: 56),
                      _PermissionTile(
                        icon: Icons.support_agent,
                        label: 'Manage tickets',
                        granted: user.role.canManageTickets,
                      ),
                      const Divider(height: 1, indent: 56),
                      _PermissionTile(
                        icon: Icons.menu_book,
                        label: 'Edit knowledge base',
                        granted: user.role.canEditKnowledgeBase,
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 20),

                // ── Team management shortcut (admin+) ────────────
                if (user.role.canManageTeam)
                  FilledButton.icon(
                    onPressed: () => context.push('/team'),
                    icon: const Icon(Icons.group, size: 18),
                    label: const Text('Manage team members'),
                  ),

                const SizedBox(height: 12),

                // ── Sign out ──────────────────────────────────────
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: const BorderSide(color: AppColors.danger, width: 1),
                  ),
                  onPressed: () async {
                    final confirmed = await showDialog<bool>(
                      context: context,
                      builder: (_) => AlertDialog(
                        title: const Text('Sign out?'),
                        content: const Text(
                            'You will be returned to the login screen.'),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(context, false),
                            child: const Text('Cancel'),
                          ),
                          FilledButton(
                            onPressed: () => Navigator.pop(context, true),
                            child: const Text('Sign out'),
                          ),
                        ],
                      ),
                    );
                    if (confirmed != true) return;
                    await ref.read(authServiceProvider).signOut();
                  },
                  icon: const Icon(Icons.logout, size: 18),
                  label: const Text('Sign out'),
                ),

                const SizedBox(height: 40),
              ],
            ),
    );
  }

  Color _hexToColor(String hex) {
    final clean = hex.replaceAll('#', '');
    return Color(int.parse('FF$clean', radix: 16));
  }
}

/// Spinner while the profile loads; explicit error + retry when a load
/// failed and there is nothing to show. Never a silent infinite spinner.
class _LoadingOrError extends ConsumerWidget {
  const _LoadingOrError({required this.state});

  final AsyncValue<AppUser?> state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // AsyncData(null) with no error used to spin forever (the stream's
    // self-heal swallowed failures). Give BOTH failure shapes an exit:
    // an error shows its message; a null profile shows a nudge + retry.
    if (!state.hasError && state.value != null) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2));
    }
    final message = state.hasError
        ? '${state.error}'
        : 'Your profile is not available yet. This can happen right after '
            'sign-in or on a flaky connection — try again in a moment.';
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 40, color: AppColors.textSecondary),
            const SizedBox(height: 12),
            Text(
              'Couldn\'t load your profile',
              style: context.textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => ref.invalidate(currentAppUserProvider),
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleBadge extends StatelessWidget {
  const _RoleBadge({required this.role});
  final UserRole role;

  @override
  Widget build(BuildContext context) {
    final color = _hexToColor(role.badgeColorHex);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.shield, size: 14, color: color),
          const SizedBox(width: 6),
          Text(
            role.label,
            style: context.textTheme.labelMedium?.copyWith(
              color: color,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Color _hexToColor(String hex) {
    final clean = hex.replaceAll('#', '');
    return Color(int.parse('FF$clean', radix: 16));
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 8),
      child: Text(
        text,
        style: context.textTheme.labelMedium
            ?.copyWith(color: AppColors.textSecondary),
      ),
    );
  }
}

/// Per-user notification switches, persisted on the user document
/// (`preferences` map). Toggling writes the whole map back — the field is
/// not role-privileged, so every teammate can manage their own.
class _PreferencesCard extends ConsumerWidget {
  const _PreferencesCard({required this.user});
  final AppUser user;

  Future<void> _toggle(
    WidgetRef ref,
    BuildContext context,
    UserPreferences current, {
    bool? notifyDealUpdates,
    bool? notifyNewLeads,
    bool? notifyTicketAssignments,
    bool? notifyAiInsights,
    bool? weeklyDigest,
  }) async {
    final next = UserPreferences(
      notifyDealUpdates: notifyDealUpdates ?? current.notifyDealUpdates,
      notifyNewLeads: notifyNewLeads ?? current.notifyNewLeads,
      notifyTicketAssignments:
          notifyTicketAssignments ?? current.notifyTicketAssignments,
      notifyAiInsights: notifyAiInsights ?? current.notifyAiInsights,
      weeklyDigest: weeklyDigest ?? current.weeklyDigest,
      startScreen: current.startScreen,
    );
    try {
      await withFirestoreRetry(
        () => ref.read(remoteDataServiceProvider).update('users', user.id, {
          'preferences': next.toMap(),
          'updatedAt': const ServerTimestamp(),
        }),
      );
      // Refresh immediately instead of waiting for the 60 s poll.
      ref.invalidate(currentAppUserProvider);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(describeFirestoreError(e))),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = user.preferences;
    return Card(
      child: Column(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.inventory_2_outlined, size: 20),
            title: const Text('Deal updates'),
            value: p.notifyDealUpdates,
            onChanged: (v) => _toggle(ref, context, p, notifyDealUpdates: v),
          ),
          const Divider(height: 1, indent: 56),
          SwitchListTile(
            secondary: const Icon(Icons.person_add_alt_1_outlined, size: 20),
            title: const Text('New leads'),
            value: p.notifyNewLeads,
            onChanged: (v) => _toggle(ref, context, p, notifyNewLeads: v),
          ),
          const Divider(height: 1, indent: 56),
          SwitchListTile(
            secondary: const Icon(Icons.assignment_outlined, size: 20),
            title: const Text('Ticket assignments'),
            value: p.notifyTicketAssignments,
            onChanged: (v) =>
                _toggle(ref, context, p, notifyTicketAssignments: v),
          ),
          const Divider(height: 1, indent: 56),
          SwitchListTile(
            secondary: const Icon(Icons.auto_awesome_outlined, size: 20),
            title: const Text('AI insights'),
            value: p.notifyAiInsights,
            onChanged: (v) => _toggle(ref, context, p, notifyAiInsights: v),
          ),
          const Divider(height: 1, indent: 56),
          SwitchListTile(
            secondary: const Icon(Icons.mark_email_read_outlined, size: 20),
            title: const Text('Weekly digest'),
            value: p.weeklyDigest,
            onChanged: (v) => _toggle(ref, context, p, weeklyDigest: v),
          ),
        ],
      ),
    );
  }
}

class _PermissionTile extends StatelessWidget {
  const _PermissionTile({
    required this.icon,
    required this.label,
    required this.granted,
  });
  final IconData icon;
  final String label;
  final bool granted;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, size: 20,
          color: granted ? AppColors.success : AppColors.textTertiary),
      title: Text(label),
      trailing: Icon(
        granted ? Icons.check_circle : Icons.cancel,
        size: 18,
        color: granted ? AppColors.success : AppColors.textTertiary,
      ),
    );
  }
}

/// Pick a photo, push it to R2 through the storage Worker, then save the
/// resulting URL on the user document.
///
/// Images are downscaled before upload: a modern phone camera produces
/// several megabytes for what renders as a 112px avatar.
Future<void> _changeAvatar(
  BuildContext context,
  WidgetRef ref,
  String uid,
) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 512,
      maxHeight: 512,
      imageQuality: 85,
    );
    if (picked == null) return;

    messenger.showSnackBar(
      const SnackBar(content: Text('Uploading photo...')),
    );

    final bytes = await picked.readAsBytes();
    final ext = picked.name.contains('.')
        ? picked.name.split('.').last.toLowerCase()
        : 'jpg';

    final url = await ref.read(storageServiceProvider).uploadBytes(
          key: StorageService.avatarKey(uid, ext),
          bytes: bytes,
          contentType: StorageService.contentTypeFor(picked.name),
        );

    await withFirestoreRetry(
      () => ref.read(remoteDataServiceProvider).update('users', uid, {
        'photoUrl': url,
        'updatedAt': const ServerTimestamp(),
      }),
    );

    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      const SnackBar(content: Text('Photo updated')),
    );
  } catch (e) {
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(content: Text('$e')));
  }
}

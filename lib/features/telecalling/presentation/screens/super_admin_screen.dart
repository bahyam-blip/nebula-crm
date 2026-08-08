import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/services/firebase_boot.dart';
import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../auth/models/app_user.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../../contacts/models/call_status.dart';
import '../../../contacts/models/contact.dart';
import '../../../../core/services/data_migration.dart';
import '../../../../core/auth/capabilities.dart';
import '../../../auth/providers/capability_provider.dart';
import '../../../auth/services/invite_service.dart';
import '../../providers/telecalling_provider.dart';

/// Cross-team control panel. Super admins only.
class SuperAdminScreen extends ConsumerWidget {
  const SuperAdminScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(currentAppUserValueProvider);

    // Deliberately checks superAdmin specifically, not isAdmin. A team
    // admin must not be able to see or edit other teams.
    if (me?.role != UserRole.superAdmin) {
      return Scaffold(
        appBar: AppBar(title: const Text('Super admin')),
        body: const EmptyState(
          icon: Icons.shield,
          title: 'Restricted',
          subtitle: 'Only super admins can open this area.',
        ),
      );
    }

    return DefaultTabController(
      length: 5,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Super admin'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Teams'),
              Tab(text: 'People'),
              Tab(text: 'Invites'),
              Tab(text: 'Access'),
              Tab(text: 'Audit'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _TeamsTab(),
            _PeopleTab(),
            _InvitesTab(),
            _AccessTab(),
            _AuditTab(),
          ],
        ),
      ),
    );
  }
}

class _TeamsTab extends ConsumerWidget {
  const _TeamsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final usersAsync = ref.watch(allUsersGlobalProvider);
    final contactsAsync = ref.watch(allContactsGlobalProvider);

    if (usersAsync.hasError) {
      return ErrorState(
        message: describeFirestoreError(usersAsync.error!),
        onRetry: () => ref.invalidate(allUsersGlobalProvider),
      );
    }
    final users = usersAsync.valueOrNull;
    final contacts = contactsAsync.valueOrNull;
    if (users == null || contacts == null) {
      return const Center(child: CircularProgressIndicator());
    }

    // Group by team, treating a missing teamId as its own bucket so
    // orphaned users stay visible rather than silently vanishing.
    final teamIds = <String>{
      ...users.map((u) => u.teamId ?? '—'),
      ...contacts.map((c) => c.teamId ?? '—'),
    }.toList()
      ..sort();

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: teamIds.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) {
        final t = teamIds[i];
        final teamUsers =
            users.where((u) => (u.teamId ?? '—') == t).toList();
        final teamContacts =
            contacts.where((c) => (c.teamId ?? '—') == t).toList();
        final open =
            teamContacts.where((c) => c.callStatus.isOpen).length;

        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surfaceElevated,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(t == '—' ? 'No team assigned' : t,
                        style: context.textTheme.titleSmall,
                        overflow: TextOverflow.ellipsis),
                  ),
                  StatusBadge(
                    label: '${teamUsers.length} people',
                    color: AppColors.primary,
                    outlined: true,
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                '${teamContacts.length} leads · $open open',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: teamUsers
                    .map((u) => Chip(
                          padding: EdgeInsets.zero,
                          labelStyle: context.textTheme.bodySmall,
                          label: Text(
                              '${u.displayName} · ${u.role.shortLabel}'),
                        ))
                    .toList(),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _PeopleTab extends ConsumerWidget {
  const _PeopleTab();

  Future<void> _changeRole(
    BuildContext context,
    WidgetRef ref,
    AppUser target,
  ) async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;

    final picked = await showModalBottomSheet<UserRole>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: UserRole.values
              .map((r) => ListTile(
                    leading: Icon(
                      r == target.role
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                      size: 18,
                    ),
                    title: Text(r.label),
                    onTap: () => Navigator.pop(ctx, r),
                  ))
              .toList(),
        ),
      ),
    );
    if (picked == null || picked == target.role) return;

    try {
      await withFirestoreRetry(() async {
        await ref
            .read(firestoreProvider)
            .collection(AppConstants.colUsers)
            .doc(target.id)
            .update({
          'role': picked.name,
          // Reset to the new role's baseline. Carrying old grants across a
          // demotion is exactly how someone keeps powers they should have
          // just lost.
          'capabilities': defaultCapabilityIdsFor(picked),
          'updatedAt': FieldValue.serverTimestamp(),
        });
        await ref.read(telecallingServiceProvider).recordAudit(
              action: 'user.role_change',
              actor: me,
              targetId: target.id,
              summary: '${target.displayName}: '
                  '${target.role.label} → ${picked.label}',
              metadata: {'from': target.role.name, 'to': picked.name},
            );
      });
      if (context.mounted) {
        context.showSuccess('${target.displayName} is now ${picked.label}');
      }
    } catch (e) {
      if (context.mounted) context.showError(describeFirestoreError(e));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final usersAsync = ref.watch(allUsersGlobalProvider);
    final me = ref.watch(currentAppUserValueProvider);

    return usersAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => ErrorState(
        message: describeFirestoreError(e),
        onRetry: () => ref.invalidate(allUsersGlobalProvider),
      ),
      data: (users) {
        final sorted = [...users]
          ..sort((a, b) => b.role.rank.compareTo(a.role.rank));
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: sorted.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (_, i) {
            final u = sorted[i];
            final isSelf = u.id == me?.id;
            return ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                backgroundColor: AppColors.surfaceHigh,
                child: Text(Formatters.initials(u.displayName),
                    style: context.textTheme.bodySmall),
              ),
              title: Text(u.displayName),
              subtitle: Text(
                '${u.email} · ${u.teamId ?? 'no team'}',
                overflow: TextOverflow.ellipsis,
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textTertiary),
              ),
              trailing: TextButton(
                // Removing your own super-admin rights would lock everyone
                // out of this screen, so self-edits are blocked.
                onPressed:
                    isSelf ? null : () => _changeRole(context, ref, u),
                child: Text(isSelf ? 'You' : u.role.shortLabel),
              ),
            );
          },
        );
      },
    );
  }
}

class _AuditTab extends ConsumerWidget {
  const _AuditTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auditAsync = ref.watch(auditLogProvider);

    return auditAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => ErrorState(
        message: describeFirestoreError(e),
        onRetry: () => ref.invalidate(auditLogProvider),
      ),
      data: (entries) {
        if (entries.isEmpty) {
          return const EmptyState(
            icon: Icons.history,
            title: 'No activity recorded',
            subtitle: 'Imports, reassignments and role changes appear here.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: entries.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (_, i) {
            final e = entries[i];
            return ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(_iconFor(e.action),
                  size: 20, color: AppColors.textSecondary),
              title: Text(e.summary),
              subtitle: Text(
                '${e.actorName} · '
                '${e.createdAt == null ? '' : Formatters.timeAgo(e.createdAt!)}',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textTertiary),
              ),
            );
          },
        );
      },
    );
  }

  IconData _iconFor(String action) {
    if (action.startsWith('user.')) return Icons.badge_outlined;
    if (action.contains('distribute')) return Icons.shuffle;
    if (action.contains('rebalance')) return Icons.balance;
    if (action.contains('reassign')) return Icons.swap_horiz;
    return Icons.info;
  }
}

/// Add people to the workspace and give them a role up front.
class _InvitesTab extends ConsumerStatefulWidget {
  const _InvitesTab();

  @override
  ConsumerState<_InvitesTab> createState() => _InvitesTabState();
}

class _InvitesTabState extends ConsumerState<_InvitesTab> {
  final _email = TextEditingController();
  UserRole _role = UserRole.salesRep;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(inviteServiceProvider).invite(
            email: _email.text,
            role: _role,
            actor: me,
          );
      if (!mounted) return;
      _email.clear();
      context.showSuccess('Invite saved. They get this role when they sign up.');
    } catch (e) {
      if (mounted) context.showError('$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runMigration() async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;
    setState(() => _busy = true);
    try {
      final results = await ref.read(dataMigrationProvider).backfillTeamId(
            teamId: me.teamId ?? '',
            actorId: me.id,
          );
      final total = results.values.fold<int>(0, (a, b) => a + b);
      if (!mounted) return;
      context.showSuccess('Repaired $total records.');
    } catch (e) {
      if (mounted) context.showError('$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final invites = ref.watch(pendingInvitesProvider);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Add someone', style: context.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Accounts are created by the person signing up. Record their email '
          'and role here and it is applied automatically on first login.',
          style: context.textTheme.bodySmall
              ?.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Work email'),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<UserRole>(
          initialValue: _role,
          decoration: const InputDecoration(labelText: 'Role'),
          items: UserRole.values
              .where((r) => r != UserRole.superAdmin)
              .map((r) => DropdownMenuItem(value: r, child: Text(r.label)))
              .toList(),
          onChanged: (v) => setState(() => _role = v ?? UserRole.salesRep),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _send,
          icon: const Icon(Icons.person_add, size: 18),
          label: const Text('Save invite'),
        ),
        const Divider(height: 32),
        Text('Pending invites', style: context.textTheme.titleMedium),
        const SizedBox(height: 8),
        invites.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => Text(describeFirestoreError(e),
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.danger)),
          data: (list) => list.isEmpty
              ? Text('None yet.',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.textTertiary))
              : Column(
                  children: list
                      .map((i) => ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: Icon(
                              i.isAccepted
                                  ? Icons.check_circle
                                  : Icons.hourglass_empty,
                              size: 18,
                              color: i.isAccepted
                                  ? AppColors.success
                                  : AppColors.textTertiary,
                            ),
                            title: Text(i.email),
                            subtitle: Text(
                              '${i.role.label}'
                              '${i.isAccepted ? ' · joined' : ' · pending'}',
                              style: context.textTheme.bodySmall,
                            ),
                            trailing: IconButton(
                              icon: const Icon(Icons.delete_outline, size: 18),
                              onPressed: () => ref
                                  .read(inviteServiceProvider)
                                  .revoke(i.email),
                            ),
                          ))
                      .toList(),
                ),
        ),
        const Divider(height: 32),
        Text('Repair old data', style: context.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Records created before the shared workspace existed carry the '
          'wrong team and stay invisible to security rules. This stamps the '
          'current team onto them. Safe to run more than once.',
          style: context.textTheme.bodySmall
              ?.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _busy ? null : _runMigration,
          icon: const Icon(Icons.build, size: 18),
          label: const Text('Repair records'),
        ),
        const SizedBox(height: 40),
      ],
    );
  }
}

/// Per-person permission editor.
///
/// Mirrors how Salesforce and Zoho work: the role sets a baseline, and
/// individual capabilities are then granted or revoked without inventing a
/// new role for every exception.
class _AccessTab extends ConsumerWidget {
  const _AccessTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final users = ref.watch(allUsersGlobalProvider).valueOrNull ?? const [];
    final me = ref.watch(currentAppUserValueProvider);
    final editable =
        users.where((u) => u.role != UserRole.superAdmin).toList()
          ..sort((a, b) => b.role.rank.compareTo(a.role.rank));

    if (editable.isEmpty) {
      return const EmptyState(
        icon: Icons.tune,
        title: 'Nobody to configure yet',
        subtitle: 'Invite someone, then set exactly what they can do here.',
      );
    }

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Text(
          'Each role starts from a baseline. Adjust anything here without '
          'creating a new role. Changing someone\'s role resets them to that '
          "role's baseline.",
          style: context.textTheme.bodySmall
              ?.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 12),
        ...editable.map((u) => _UserCard(user: u, actor: me)),
        const SizedBox(height: 30),
      ],
    );
  }
}

class _UserCard extends ConsumerWidget {
  const _UserCard({required this.user, required this.actor});

  final AppUser user;
  final AppUser? actor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = capabilitiesOf(user);
    final grouped = <String, List<Capability>>{};
    for (final c in Capability.values) {
      grouped.putIfAbsent(c.group, () => []).add(c);
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 12),
          title: Text(user.displayName, style: context.textTheme.titleSmall),
          subtitle: Text(
            '${user.role.label} · ${current.length} of '
            '${Capability.values.length} permissions',
            style: context.textTheme.bodySmall
                ?.copyWith(color: AppColors.textTertiary),
          ),
          children: [
            for (final entry in grouped.entries)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(entry.key,
                        style: context.textTheme.labelMedium
                            ?.copyWith(color: AppColors.textTertiary)),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: entry.value.map((cap) {
                        final on = current.contains(cap);
                        return FilterChip(
                          selected: on,
                          visualDensity: VisualDensity.compact,
                          // Sensitive powers are marked so granting one is a
                          // deliberate act rather than a stray tap.
                          avatar: cap.isSensitive
                              ? Icon(Icons.warning_amber,
                                  size: 13,
                                  color: on
                                      ? AppColors.warning
                                      : AppColors.textTertiary)
                              : null,
                          label: Text(cap.label,
                              style: const TextStyle(fontSize: 11)),
                          onSelected: (v) async {
                            final next = {...current};
                            if (v) {
                              next.add(cap);
                            } else {
                              next.remove(cap);
                            }
                            try {
                              await ref
                                  .read(capabilityServiceProvider)
                                  .setFor(user.id, next);
                            } catch (e) {
                              if (context.mounted) {
                                context.showError(
                                    describeFirestoreError(e));
                              }
                            }
                          },
                        );
                      }).toList(),
                    ),
                  ],
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
              child: Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => ref
                      .read(capabilityServiceProvider)
                      .resetToRoleDefaults(user.id, user.role),
                  icon: const Icon(Icons.restart_alt, size: 15),
                  label: Text('Reset to ${user.role.label} defaults'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

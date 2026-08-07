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
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Super admin'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Teams'),
              Tab(text: 'People'),
              Tab(text: 'Audit'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _TeamsTab(),
            _PeopleTab(),
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

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../models/contact.dart';
import '../../providers/contact_provider.dart';

class ContactsListScreen extends ConsumerStatefulWidget {
  const ContactsListScreen({super.key});

  @override
  ConsumerState<ContactsListScreen> createState() =>
      _ContactsListScreenState();
}

class _ContactsListScreenState extends ConsumerState<ContactsListScreen> {
  @override
  Widget build(BuildContext context) {
    final contacts = ref.watch(contactsProvider);
    final search = ref.watch(contactSearchProvider);

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar.large(
            title: const Text('Contacts'),
            pinned: true,
            stretch: true,
            flexibleSpace: FlexibleSpaceBar(
              title: Text('Contacts', style: context.textTheme.titleLarge),
              background: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppColors.surface, AppColors.background],
                  ),
                ),
              ),
            ),
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(72),
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: TextField(
                  onChanged: (v) => ref
                      .read(contactSearchProvider.notifier)
                      .state = v,
                  decoration: InputDecoration(
                    hintText: 'Search by name, email, company',
                    prefixIcon: const Icon(Icons.search, size: 18),
                    suffixIcon: search.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: () => ref
                                .read(contactSearchProvider.notifier)
                                .state = '',
                          )
                        : null,
                    isDense: true,
                  ),
                ),
              ),
            ),
          ),
          contacts.when(
            data: (list) {
              if (list.isEmpty) {
                return const SliverFillRemaining(
                  hasScrollBody: false,
                  child: EmptyState(
                    icon: Icons.account_circle,
                    title: 'No contacts yet',
                    subtitle: 'Add your first contact to start building your pipeline.',
                    actionLabel: 'Add contact',
                  ),
                );
              }
              return SliverList.separated(
                itemCount: list.length,
                separatorBuilder: (_, __) => const Divider(height: 1, indent: 76),
                itemBuilder: (_, i) {
                  final c = list[i];
                  return _ContactTile(contact: c)
                      .animate()
                      .fadeIn(duration: 200.ms, delay: (i * 30).ms);
                },
              );
            },
            loading: () => const SliverFillRemaining(
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
            ),
            error: (e, _) => SliverFillRemaining(
              child: ErrorState(message: 'Failed to load contacts: $e'),
            ),
          ),
          const SliverToBoxBox(child: SizedBox(height: 80)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/contacts/new'),
        icon: const Icon(Icons.add, size: 20),
        label: const Text('Add Contact'),
      ),
    );
  }
}

class _ContactTile extends StatelessWidget {
  const _ContactTile({required this.contact});
  final Contact contact;

  @override
  Widget build(BuildContext context) {
    final statusColor = _statusColor(contact.status);
    return ListTile(
      onTap: () => context.push('/contacts/${contact.id}'),
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      leading: _Avatar(contact: contact),
      title: Row(
        children: [
          Expanded(
            child: Text(
              contact.name,
              style: context.textTheme.titleSmall,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (contact.openDealsCount > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                '${contact.openDealsCount} open',
                style: context.textTheme.labelSmall?.copyWith(
                  color: AppColors.primary,
                ),
              ),
            ),
          ],
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Text(
            _contactSubtitle(contact),
            style: context.textTheme.bodySmall?.copyWith(
              color: AppColors.textSecondary,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              StatusBadge(
                label: contact.status.label,
                color: statusColor,
                outlined: true,
              ),
              if (contact.lastActivityAt != null) ...[
                const SizedBox(width: 8),
                Text(
                  'Last: ${Formatters.timeAgo(contact.lastActivityAt!)}',
                  style: context.textTheme.labelSmall,
                ),
              ],
            ],
          ),
        ],
      ),
      trailing: const Icon(Icons.chevron_right,
          color: AppColors.textTertiary, size: 18),
    );
  }

  Color _statusColor(ContactStatus s) {
    return switch (s) {
      ContactStatus.subscriber => AppColors.textTertiary,
      ContactStatus.lead => AppColors.stageLead,
      ContactStatus.mql => AppColors.stageQualified,
      ContactStatus.sql => AppColors.stageProposal,
      ContactStatus.opportunity => AppColors.stageNegotiation,
      ContactStatus.customer => AppColors.stageWon,
      ContactStatus.churned => AppColors.stageLost,
    };
  }
}

/// Build a single-line subtitle for a contact tile.
String _contactSubtitle(Contact c) {
  final parts = <String>[];
  if (c.jobTitle != null && c.company != null) {
    parts.add('${c.jobTitle} · ${c.company}');
  } else if (c.company != null) {
    parts.add(c.company!);
  } else if (c.jobTitle != null) {
    parts.add(c.jobTitle!);
  }
  if (c.email != null) parts.add(c.email!);
  return parts.join(' · ');
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.contact});
  final Contact contact;

  @override
  Widget build(BuildContext context) {
    if (contact.photoUrl != null) {
      return CircleAvatar(
        radius: 22,
        backgroundImage: NetworkImage(contact.photoUrl!),
      );
    }
    return CircleAvatar(
      radius: 22,
      backgroundColor: AppColors.primary.withValues(alpha: 0.15),
      child: Text(
        contact.name.initials,
        style: context.textTheme.titleSmall?.copyWith(color: AppColors.primary),
      ),
    );
  }
}

/// Workaround for SliverToBoxAdapter that I keep typing wrong.
class SliverToBoxBox extends StatelessWidget {
  const SliverToBoxBox({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => SliverToBoxAdapter(child: child);
}

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/auth/capabilities.dart';
import '../../../auth/providers/capability_provider.dart';
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
          // A plain pinned bar. SliverAppBar.large combined with a
          // FlexibleSpaceBar title AND a bottom widget double-rendered the
          // title and pushed the search field into the middle of the screen.
          SliverAppBar(
            title: const Text('Contacts'),
            pinned: true,
            actions: [
              // Bulk import is one of the riskiest actions in the app, so
              // the entry point disappears unless it is granted.
              if (ref.watch(myCapabilitiesProvider)
                  .can(Capability.contactsImport))
                IconButton(
                  tooltip: 'Import from CSV',
                  icon: const Icon(Icons.upload_file),
                  onPressed: () => context.push('/contacts/import'),
                ),
            ],
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(100),
              child: Padding(
                padding:
                    const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      height: 34,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: ContactScope.values.map((sc) {
                          final on = ref.watch(contactScopeProvider) == sc;
                          return Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: ChoiceChip(
                              label: Text(sc.label),
                              selected: on,
                              visualDensity: VisualDensity.compact,
                              onSelected: (_) => ref
                                  .read(contactScopeProvider.notifier)
                                  .state = sc,
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                    const SizedBox(height: 6),
                    TextField(
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
                    fillColor: AppColors.surfaceElevated,
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(999),
                      borderSide: const BorderSide(
                          color: AppColors.border, width: 1),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(999),
                      borderSide: const BorderSide(
                          color: AppColors.primary, width: 1.5),
                    ),
                  ),
                    ),
                  ],
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
                      .fadeIn(duration: 200.ms, delay: (i * 30).ms)
                      .slideX(begin: 0.02, duration: 200.ms);
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
      leading: _Avatar(contact: contact, statusColor: statusColor),
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
  const _Avatar({required this.contact, this.statusColor});
  final Contact contact;
  final Color? statusColor;

  @override
  Widget build(BuildContext context) {
    return GlowAvatar(
      radius: 21,
      photoUrl: contact.photoUrl,
      initials: contact.name.initials,
      statusColor: statusColor,
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

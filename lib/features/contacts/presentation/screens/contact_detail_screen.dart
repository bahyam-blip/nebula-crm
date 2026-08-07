import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../models/contact.dart';
import '../../providers/contact_provider.dart';
import '../../../dashboard/presentation/widgets/recent_activity.dart';

class ContactDetailScreen extends ConsumerWidget {
  const ContactDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contact = ref.watch(contactByIdProvider(id));
    return Scaffold(
      body: contact.when<Widget>(
        data: (Contact? c) {
          if (c == null) {
            return const EmptyState(
              icon: Icons.person_remove,
              title: 'Contact not found',
            );
          }
          return CustomScrollView(
            slivers: [
              SliverAppBar(
                expandedHeight: 240,
                pinned: true,
                actions: [
                  IconButton(
                    icon: const Icon(Icons.edit),
                    onPressed: () => context.push('/contacts/new?id=$id'),
                  ),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert),
                    onSelected: (v) {
                      if (v == 'delete') {
                        _confirmDelete(context, ref);
                      }
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'delete', child: Text('Delete')),
                    ],
                  ),
                ],
                flexibleSpace: FlexibleSpaceBar(
                  background: Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [AppColors.surface, AppColors.background],
                      ),
                    ),
                    child: SafeArea(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const SizedBox(height: 16),
                          CircleAvatar(
                            radius: 44,
                            backgroundColor:
                                AppColors.primary.withValues(alpha: 0.2),
                            backgroundImage: c.photoUrl != null
                                ? NetworkImage(c.photoUrl!)
                                : null,
                            child: c.photoUrl == null
                                ? Text(
                                    c.name.initials,
                                    style: context.textTheme.headlineMedium
                                        ?.copyWith(color: AppColors.primary),
                                  )
                                : null,
                          ),
                          const SizedBox(height: 12),
                          Text(c.name,
                              style: context.textTheme.headlineSmall),
                          if (c.jobTitle != null || c.company != null) ...[
                            const SizedBox(height: 2),
                            Text(
                              [c.jobTitle, c.company]
                                  .where((s) => s != null)
                                  .join(' · '),
                              style: context.textTheme.bodySmall
                                  ?.copyWith(color: AppColors.textSecondary),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── Quick actions ────────────────────────────
                    Padding(
                      padding: const EdgeInsets.all(20),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          _QuickAction(
                            icon: Icons.phone,
                            label: 'Call',
                            color: AppColors.success,
                            onTap: () => _launchUrl(context, 'tel:${c.phone}'),
                          ),
                          _QuickAction(
                            icon: Icons.email,
                            label: 'Email',
                            color: AppColors.info,
                            onTap: () => _launchUrl(context, 'mailto:${c.email}'),
                          ),
                          _QuickAction(
                            icon: Icons.view_kanban,
                            label: 'Deal',
                            color: AppColors.primary,
                            onTap: () => context.push('/deals/new?contactId=$id'),
                          ),
                          _QuickAction(
                            icon: Icons.edit_note,
                            label: 'Note',
                            color: AppColors.tertiary,
                            onTap: () => _showNoteSheet(context, ref, id),
                          ),
                        ],
                      ),
                    ),

                    // ── Contact info ─────────────────────────────
                    const SectionHeader(title: 'Details'),
                    _DetailsCard(contact: c),

                    // ── Tags ─────────────────────────────────────
                    if (c.tags.isNotEmpty) ...[
                      const SectionHeader(title: 'Tags'),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            for (final t in c.tags)
                              Chip(
                                label: Text(t),
                                visualDensity: VisualDensity.compact,
                                materialTapTargetSize:
                                    MaterialTapTargetSize.shrinkWrap,
                              ),
                          ],
                        ),
                      ),
                    ],

                    // ── Lifetime value / Lead score ─────────────
                    const SectionHeader(title: 'Insights'),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Row(
                        children: [
                          Expanded(
                            child: _StatTile(
                              label: 'Lifetime Value',
                              value: Formatters.currency(c.lifetimeValue),
                              color: AppColors.success,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _StatTile(
                              label: 'Lead Score',
                              value: c.leadScore != null
                                  ? c.leadScore!.toStringAsFixed(0)
                                  : '—',
                              color: AppColors.accent,
                            ),
                          ),
                        ],
                      ),
                    ),

                    // ── Activity timeline ────────────────────────
                    const SectionHeader(
                        title: 'Activity Timeline',
                        actionLabel: 'See all'),
                    const RecentActivity(),

                    const SizedBox(height: 80),
                  ],
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator(strokeWidth: 2)),
        error: (e, _) => ErrorState(message: 'Failed to load contact: $e'),
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete contact?'),
        content: const Text(
          'This will permanently remove the contact and all associated activities. This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(firestoreServiceProvider).deleteContact(id);
    if (!context.mounted) return;
    context.pop();
  }

  void _showNoteSheet(BuildContext context, WidgetRef ref, String contactId) {
    final controller = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: 20 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Add note', style: context.textTheme.titleMedium),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              maxLines: 4,
              autofocus: true,
              decoration: const InputDecoration(
                hintText: 'What did you discuss?',
              ),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () async {
                if (controller.text.trim().isEmpty) return;
                final user = ref.read(currentAppUserValueProvider);
                await ref.read(firestoreServiceProvider).logActivity(
                      Activity(
                        id: '',
                        type: 'note',
                        ownerId: user?.id ?? '',
                        contactId: contactId,
                        title: 'Note added',
                        description: controller.text.trim(),
                        timestamp: DateTime.now(),
                      ),
                    );
                if (context.mounted) Navigator.pop(context);
              },
              child: const Text('Save note'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _launchUrl(BuildContext context, String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(height: 6),
            Text(label, style: context.textTheme.labelSmall),
          ],
        ),
      ),
    );
  }
}

class _DetailsCard extends StatelessWidget {
  const _DetailsCard({required this.contact});
  final Contact contact;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        children: [
          if (contact.email != null)
            _DetailRow(
              icon: Icons.email,
              label: 'Email',
              value: contact.email!,
            ),
          if (contact.phone != null)
            _DetailRow(
              icon: Icons.phone,
              label: 'Phone',
              value: contact.phone!,
            ),
          if (contact.company != null)
            _DetailRow(
              icon: Icons.apartment,
              label: 'Company',
              value: contact.company!,
            ),
          if (contact.address != null)
            _DetailRow(
              icon: Icons.location_on,
              label: 'Address',
              value: contact.address!,
            ),
          if (contact.website != null)
            _DetailRow(
              icon: Icons.language,
              label: 'Website',
              value: contact.website!,
            ),
          if (contact.linkedin != null)
            _DetailRow(
              icon: Icons.business,
              label: 'LinkedIn',
              value: contact.linkedin!,
            ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.textSecondary, size: 20),
      title: Text(label, style: context.textTheme.labelSmall),
      subtitle: Text(value, style: context.textTheme.bodyMedium),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.label,
    required this.value,
    required this.color,
  });
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value,
              style: context.textTheme.headlineSmall?.copyWith(color: color)),
          const SizedBox(height: 4),
          Text(label,
              style: context.textTheme.labelSmall
                  ?.copyWith(color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}

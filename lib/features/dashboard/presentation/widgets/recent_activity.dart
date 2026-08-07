import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../contacts/models/contact.dart' show Activity;
import '../../../contacts/providers/contact_provider.dart';

/// Recent activity feed — pulls from the recent activities stream.
///
/// Each row shows the activity type icon, contact name, description,
/// and time-ago. Tappable to navigate to the related contact.
class RecentActivity extends ConsumerWidget {
  const RecentActivity({super.key, this.contactId, this.dealId});

  /// If provided, filter to activities for this contact.
  final String? contactId;

  /// If provided, filter to activities for this deal.
  final String? dealId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activitiesAsync = contactId != null
        ? ref.watch(contactActivitiesProvider(contactId!))
        : dealId != null
            ? ref.watch(dealActivitiesProvider(dealId!))
            : ref.watch(recentActivitiesProvider);

    return activitiesAsync.when(
      data: (list) {
        if (list.isEmpty) {
          return const EmptyState(
            icon: PhosphorIconsRegular.clock,
            title: 'No recent activity',
            subtitle: 'Log a call, email, or note to see it here.',
          );
        }
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            children: [
              for (var i = 0; i < list.length; i++) ...[
                _ActivityTile(activity: list[i]),
                if (i < list.length - 1)
                  const Padding(
                    padding: EdgeInsets.only(left: 52),
                    child: Divider(),
                  ),
              ],
            ],
          ),
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.all(20),
        child: Center(
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
      error: (e, _) => ErrorState(message: 'Failed to load activity: $e'),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.activity});
  final Activity activity;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _iconForType(activity.type);
    return InkWell(
      onTap: activity.contactId != null
          ? () => context.push('/contacts/${activity.contactId}')
          : null,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 16),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    activity.title ?? activity.type.titleCase(),
                    style: context.textTheme.titleSmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (activity.description != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      activity.description!,
                      style: context.textTheme.bodySmall
                          ?.copyWith(color: AppColors.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              activity.timestamp != null
                  ? Formatters.timeAgo(activity.timestamp!)
                  : '',
              style: context.textTheme.labelSmall,
            ),
          ],
        ),
      ),
    ).animate().fadeIn(duration: 250.ms);
  }

  (IconData, Color) _iconForType(String type) {
    return switch (type) {
      'call' => (PhosphorIconsRegular.phone, AppColors.success),
      'email' => (PhosphorIconsRegular.envelope, AppColors.info),
      'meeting' => (PhosphorIconsRegular.users, AppColors.accent),
      'note' => (PhosphorIconsRegular.notepad, AppColors.tertiary),
      'task' => (PhosphorIconsRegular.checkSquare, AppColors.warning),
      'deal_created' => (PhosphorIconsRegular.kanban, AppColors.primary),
      'deal_stage_changed' =>
        (PhosphorIconsRegular.arrowsLeftRight, AppColors.primary),
      'ticket_created' =>
        (PhosphorIconsRegular.headset, AppColors.tertiary),
      _ => (PhosphorIconsRegular.circle, AppColors.textTertiary),
    };
  }
}

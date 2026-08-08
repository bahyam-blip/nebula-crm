import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/firebase_boot.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../providers/company_provider.dart';

/// Accounts, derived from contacts and deals rather than requiring manual
/// creation: a company exists the moment somebody names it on a contact.
class CompaniesScreen extends ConsumerStatefulWidget {
  const CompaniesScreen({super.key});

  @override
  ConsumerState<CompaniesScreen> createState() => _CompaniesScreenState();
}

class _CompaniesScreenState extends ConsumerState<CompaniesScreen> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final contactsAsync = ref.watch(allTeamContactsProvider);
    final rollups = ref.watch(companyRollupsProvider);

    final filtered = _q.trim().isEmpty
        ? rollups
        : rollups
            .where((r) => r.name.toLowerCase().contains(_q.toLowerCase()))
            .toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Companies')),
      body: contactsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(
          message: describeFirestoreError(e),
          onRetry: () => ref.invalidate(allTeamContactsProvider),
        ),
        data: (_) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
              child: TextField(
                onChanged: (v) => setState(() => _q = v),
                decoration: const InputDecoration(
                  isDense: true,
                  prefixIcon: Icon(Icons.search, size: 18),
                  hintText: 'Search companies',
                  contentPadding: EdgeInsets.symmetric(vertical: 10),
                ),
              ),
            ),
            Expanded(
              child: filtered.isEmpty
                  ? const EmptyState(
                      icon: Icons.business,
                      title: 'No companies yet',
                      subtitle:
                          'Set a company on a contact and it appears here.',
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                      itemCount: filtered.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 6),
                      itemBuilder: (_, i) => _tile(filtered[i]),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tile(CompanyRollup r) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            CircleAvatar(
              radius: 16,
              backgroundColor: AppColors.surfaceHigh,
              child: Text(Formatters.initials(r.name),
                  style: context.textTheme.bodySmall),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(r.name,
                      style: context.textTheme.titleSmall,
                      overflow: TextOverflow.ellipsis),
                  Text(
                    '${r.contacts.length} contact'
                    '${r.contacts.length == 1 ? '' : 's'} · '
                    '${r.openDeals} open deal${r.openDeals == 1 ? '' : 's'}',
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textTertiary),
                  ),
                ],
              ),
            ),
            if (r.openValue > 0)
              Text(Formatters.currency(r.openValue),
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.success)),
          ],
        ),
      );
}

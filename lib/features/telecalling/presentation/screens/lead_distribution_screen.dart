import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/firebase_boot.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../../auth/models/app_user.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../../contacts/models/call_status.dart';
import '../../../contacts/models/contact.dart';
import '../../providers/telecalling_provider.dart';
import 'my_leads_screen.dart' show callStatusColor;

/// Manager view for moving leads between telecallers.
class LeadDistributionScreen extends ConsumerStatefulWidget {
  const LeadDistributionScreen({super.key});

  @override
  ConsumerState<LeadDistributionScreen> createState() =>
      _LeadDistributionScreenState();
}

class _LeadDistributionScreenState
    extends ConsumerState<LeadDistributionScreen> {
  final Set<String> _selectedLeads = {};
  final Set<String> _targetCallers = {};
  String _ownerFilter = 'all'; // all | unassigned | <userId>
  String _search = '';
  bool _openOnly = true;
  bool _busy = false;

  List<Contact> _visible(List<Contact> all) {
    final q = _search.trim().toLowerCase();
    return all.where((c) {
      if (_openOnly && !c.callStatus.isOpen) return false;
      if (q.isNotEmpty) {
        final hit = c.name.toLowerCase().contains(q) ||
            (c.phone ?? '').toLowerCase().contains(q) ||
            (c.email ?? '').toLowerCase().contains(q) ||
            (c.company ?? '').toLowerCase().contains(q);
        if (!hit) return false;
      }
      switch (_ownerFilter) {
        case 'all':
          return true;
        case 'unassigned':
          return c.assignedTo == null;
        default:
          return c.assignedTo == _ownerFilter;
      }
    }).toList()
      ..sort((a, b) => a.name.compareTo(b.name));
  }

  Future<void> _run(Future<void> Function() action, String okMessage) async {
    setState(() => _busy = true);
    try {
      await withFirestoreRetry(action);
      if (!mounted) return;
      setState(_selectedLeads.clear);
      context.showSuccess(okMessage);
    } catch (e) {
      if (mounted) context.showError(describeFirestoreError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _distribute(List<Contact> visible) async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;
    if (_targetCallers.isEmpty) {
      context.showError('Select at least one telecaller.');
      return;
    }
    final ids = _selectedLeads.isEmpty
        ? visible.map((c) => c.id).toList()
        : _selectedLeads.toList();
    if (ids.isEmpty) {
      context.showError('No leads to distribute.');
      return;
    }

    final confirmed = await _confirm(
      'Distribute ${ids.length} leads',
      'They will be shared evenly across ${_targetCallers.length} '
          'telecaller${_targetCallers.length == 1 ? '' : 's'}.',
    );
    if (!confirmed) return;

    await _run(
      () => ref.read(telecallingServiceProvider).distribute(
            contactIds: ids,
            userIds: _targetCallers.toList(),
            actor: me,
          ),
      'Distributed ${ids.length} leads.',
    );
  }

  Future<void> _reassignTo(String? userId, List<Contact> visible) async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;
    final ids = _selectedLeads.toList();
    if (ids.isEmpty) {
      context.showError('Select some leads first.');
      return;
    }
    await _run(
      () => ref.read(telecallingServiceProvider).reassign(
            contactIds: ids,
            toUserId: userId,
            actor: me,
          ),
      userId == null
          ? 'Unassigned ${ids.length} leads.'
          : 'Reassigned ${ids.length} leads.',
    );
  }

  Future<void> _rebalance(List<Contact> all) async {
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) return;
    if (_targetCallers.isEmpty) {
      context.showError('Select the telecallers to balance across.');
      return;
    }
    final open = all.where((c) => c.callStatus.isOpen).toList();
    final confirmed = await _confirm(
      'Rebalance ${open.length} open leads',
      'Leads already worked stay with their current owner. Only open '
          'leads move, so nobody loses context on a live conversation.',
    );
    if (!confirmed) return;

    await _run(
      () => ref.read(telecallingServiceProvider).rebalance(
            openLeads: open,
            userIds: _targetCallers.toList(),
            actor: me,
          ),
      'Workload rebalanced.',
    );
  }

  Future<bool> _confirm(String title, String body) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(currentAppUserValueProvider);
    final canManage = me?.role.canManageTeam ?? false;
    final leadsAsync = ref.watch(teamLeadsProvider);
    final members =
        ref.watch(teamMembersListProvider).valueOrNull ?? const <AppUser>[];

    if (!canManage) {
      return Scaffold(
        appBar: AppBar(title: const Text('Distribute leads')),
        body: const EmptyState(
          icon: Icons.lock,
          title: 'Managers only',
          subtitle: 'You need manager access to move leads between people.',
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Distribute leads'),
        actions: [
          if (_selectedLeads.isNotEmpty)
            TextButton(
              onPressed: () => setState(_selectedLeads.clear),
              child: Text('Clear (${_selectedLeads.length})'),
            ),
        ],
      ),
      body: leadsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(
          message: describeFirestoreError(e),
          onRetry: () => ref.invalidate(teamLeadsProvider),
        ),
        data: (all) {
          final visible = _visible(all);
          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _workloadCard(all, members),
                    const SizedBox(height: 16),
                    _targetCard(members, all),
                    const SizedBox(height: 16),
                    _filterCard(members),
                    const SizedBox(height: 16),
                    SectionHeader(
                      title: 'Leads',
                      subtitle: '${visible.length} shown',
                      actionLabel: _selectedLeads.length == visible.length
                          ? 'Deselect all'
                          : 'Select all',
                      onAction: () => setState(() {
                        if (_selectedLeads.length == visible.length) {
                          _selectedLeads.clear();
                        } else {
                          _selectedLeads
                            ..clear()
                            ..addAll(visible.map((c) => c.id));
                        }
                      }),
                    ),
                    const SizedBox(height: 8),
                    if (visible.isEmpty)
                      const EmptyState(
                        title: 'No leads match',
                        subtitle: 'Try a different filter.',
                      )
                    else
                      ...visible.take(150).map(
                            (c) => _leadTile(c, members),
                          ),
                    if (visible.length > 150)
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(
                          'Showing the first 150 of ${visible.length}. '
                          'Narrow the filter, or use Distribute to act on '
                          'every matching lead.',
                          style: context.textTheme.bodySmall
                              ?.copyWith(color: AppColors.textTertiary),
                        ),
                      ),
                    const SizedBox(height: 100),
                  ],
                ),
              ),
              _actionBar(visible, all, members),
            ],
          );
        },
      ),
    );
  }

  Widget _shell({required String title, required Widget child}) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: context.textTheme.titleMedium),
            const SizedBox(height: 12),
            child,
          ],
        ),
      );

  Widget _workloadCard(List<Contact> all, List<AppUser> members) {
    final counts = <String, int>{};
    var unassigned = 0;
    for (final c in all) {
      if (!c.callStatus.isOpen) continue;
      final owner = c.assignedTo;
      if (owner == null) {
        unassigned++;
      } else {
        counts[owner] = (counts[owner] ?? 0) + 1;
      }
    }
    final max = [
      unassigned,
      ...counts.values,
    ].fold<int>(1, (a, b) => a > b ? a : b);

    return _shell(
      title: 'Open leads per caller',
      child: Column(
        children: [
          ...members.map((m) {
            final n = counts[m.id] ?? 0;
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  SizedBox(
                    width: 100,
                    child: Text(m.displayName,
                        overflow: TextOverflow.ellipsis,
                        style: context.textTheme.bodySmall),
                  ),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: n / max,
                        minHeight: 8,
                        backgroundColor: AppColors.surfaceHigh,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 40,
                    child: Text('  $n',
                        textAlign: TextAlign.end,
                        style: context.textTheme.bodySmall),
                  ),
                ],
              ),
            );
          }),
          if (unassigned > 0)
            Row(
              children: [
                Icon(Icons.warning, size: 14, color: AppColors.warning),
                const SizedBox(width: 6),
                Text('$unassigned open leads are unassigned',
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.warning)),
              ],
            ),
        ],
      ),
    );
  }

  Widget _targetCard(List<AppUser> members, List<Contact> all) => _shell(
        title: 'Assign to',
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          children: members.map((m) {
            final on = _targetCallers.contains(m.id);
            return FilterChip(
              selected: on,
              label: Text('${m.displayName} · ${m.role.shortLabel}'),
              onSelected: (v) => setState(() {
                if (v) {
                  _targetCallers.add(m.id);
                } else {
                  _targetCallers.remove(m.id);
                }
              }),
            );
          }).toList(),
        ),
      );

  Widget _filterCard(List<AppUser> members) => _shell(
        title: 'Filter',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              onChanged: (v) => setState(() {
                _search = v;
                _selectedLeads.clear();
              }),
              decoration: const InputDecoration(
                isDense: true,
                prefixIcon: Icon(Icons.search, size: 18),
                hintText: 'Search name, phone, email, company',
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _ownerFilter,
              decoration: const InputDecoration(labelText: 'Owner'),
              items: [
                const DropdownMenuItem(value: 'all', child: Text('Everyone')),
                const DropdownMenuItem(
                    value: 'unassigned', child: Text('Unassigned')),
                ...members.map((m) => DropdownMenuItem(
                      value: m.id,
                      child: Text(m.displayName),
                    )),
              ],
              onChanged: (v) => setState(() {
                _ownerFilter = v ?? 'all';
                _selectedLeads.clear();
              }),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _openOnly,
              onChanged: (v) => setState(() {
                _openOnly = v;
                _selectedLeads.clear();
              }),
              title: const Text('Open leads only'),
            ),
          ],
        ),
      );

  Widget _leadTile(Contact c, List<AppUser> members) {
    AppUser? owner;
    for (final m in members) {
      if (m.id == c.assignedTo) {
        owner = m;
        break;
      }
    }
    final selected = _selectedLeads.contains(c.id);
    return CheckboxListTile(
      value: selected,
      dense: true,
      contentPadding: EdgeInsets.zero,
      onChanged: (v) => setState(() {
        if (v ?? false) {
          _selectedLeads.add(c.id);
        } else {
          _selectedLeads.remove(c.id);
        }
      }),
      title: Text(c.name, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        '${owner?.displayName ?? 'Unassigned'} · ${c.callStatus.label}',
        style: context.textTheme.bodySmall
            ?.copyWith(color: callStatusColor(c.callStatus)),
      ),
    );
  }

  Widget _actionBar(
    List<Contact> visible,
    List<Contact> all,
    List<AppUser> members,
  ) {
    final target = _selectedLeads.isEmpty ? visible.length : _selectedLeads.length;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : () => _distribute(visible),
                  icon: const Icon(Icons.shuffle, size: 16),
                  label: Text('Distribute $target'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : () => _rebalance(all),
                  icon: const Icon(Icons.balance, size: 16),
                  label: const Text('Rebalance'),
                ),
              ),
            ],
          ),
          if (_selectedLeads.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () async {
                            final picked = await showModalBottomSheet<String?>(
                              context: context,
                              backgroundColor: AppColors.surface,
                              builder: (ctx) => SafeArea(
                                child: ListView(
                                  shrinkWrap: true,
                                  children: [
                                    ListTile(
                                      leading: const Icon(Icons.person_remove),
                                      title: const Text('Unassign'),
                                      onTap: () => Navigator.pop(ctx, null),
                                    ),
                                    ...members.map(
                                      (m) => ListTile(
                                        leading: const Icon(Icons.person),
                                        title: Text(m.displayName),
                                        onTap: () => Navigator.pop(ctx, m.id),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                            if (!mounted) return;
                            await _reassignTo(picked, visible);
                          },
                    child: Text('Move ${_selectedLeads.length} to…'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';

import '../../../../core/services/ai_compose_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../contacts/models/call_status.dart';
import '../../../contacts/models/contact.dart';
import '../../../pipeline/models/deal.dart';
import '../../../companies/providers/company_provider.dart';
import '../../../telecalling/providers/telecalling_provider.dart';

/// The AI writing and analysis tools.
///
/// One screen rather than nine: they differ only in prompt and in which
/// slice of CRM data they are handed, so separate screens would be nine
/// copies of the same layout.
class AiToolsScreen extends ConsumerStatefulWidget {
  const AiToolsScreen({super.key});

  @override
  ConsumerState<AiToolsScreen> createState() => _AiToolsScreenState();
}

class _AiToolsScreenState extends ConsumerState<AiToolsScreen> {
  AiTask? _selected;
  final _brief = TextEditingController();
  String _output = '';
  bool _busy = false;

  @override
  void dispose() {
    _brief.dispose();
    super.dispose();
  }

  /// Hand the model only the slice each task needs.
  ///
  /// Sending the whole database would be slow, costly and would expose more
  /// than the task requires.
  Map<String, dynamic> _payload(AiTask task) {
    final leads =
        ref.read(teamLeadsProvider).valueOrNull ?? const <Contact>[];
    final deals =
        ref.read(allTeamDealsProvider).valueOrNull ?? const <Deal>[];

    Map<String, dynamic> lead(Contact c) => {
          'name': c.name,
          'company': c.company,
          'status': c.callStatus.name,
          'attempts': c.callAttempts,
          'assigned': c.assignedTo != null,
          'lastActivity': c.lastActivityAt?.toIso8601String(),
          'score': heuristicLeadScore(
            lastActivityAt: c.lastActivityAt,
            callAttempts: c.callAttempts,
            callStatus: c.callStatus.name,
            assigned: c.assignedTo != null,
            hasPhone: (c.phone ?? '').isNotEmpty,
            hasEmail: (c.email ?? '').isNotEmpty,
          ),
        };

    Map<String, dynamic> deal(Deal d) => {
          'title': d.title,
          'value': d.value,
          'stage': d.stage,
          'company': d.company,
          'probability': d.probability,
          'expectedClose': d.expectedCloseDate?.toIso8601String(),
          'updated': d.updatedAt?.toIso8601String(),
        };

    switch (task) {
      case AiTask.leadScore:
      case AiTask.followUp:
      case AiTask.sentiment:
        final open = leads.where((c) => c.callStatus.isOpen).toList()
          ..sort((a, b) => (b.lastActivityAt ?? DateTime(0))
              .compareTo(a.lastActivityAt ?? DateTime(0)));
        return {'leads': open.take(30).map(lead).toList()};
      case AiTask.dealPrediction:
      case AiTask.forecast:
        final open = deals
            .where((d) => d.stage != 'won' && d.stage != 'lost')
            .toList();
        return {
          'today': DateTime.now().toIso8601String().split('T').first,
          'openDeals': open.take(30).map(deal).toList(),
          'wonThisPeriod': deals.where((d) => d.stage == 'won').length,
        };
      case AiTask.email:
      case AiTask.proposal:
      case AiTask.meetingSummary:
      case AiTask.callAnalysis:
        return {
          'recentContacts': leads.take(12).map(lead).toList(),
          'openDeals': deals
              .where((d) => d.stage != 'won' && d.stage != 'lost')
              .take(8)
              .map(deal)
              .toList(),
        };
    }
  }

  Future<void> _run(AiTask task) async {
    if (task.needsBrief && _brief.text.trim().isEmpty) {
      context.showError('Add a short brief first.');
      return;
    }
    setState(() {
      _busy = true;
      _output = '';
    });
    try {
      final text = await ref.read(aiComposeServiceProvider).run(
            task: task,
            data: _payload(task),
            brief: _brief.text,
          );
      if (mounted) setState(() => _output = text);
    } catch (e) {
      if (mounted) setState(() => _output = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final task = _selected;

    return Scaffold(
      appBar: AppBar(
        title: Text(task?.label ?? 'AI tools'),
        leading: task == null
            ? null
            : IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => setState(() {
                  _selected = null;
                  _output = '';
                  _brief.clear();
                }),
              ),
      ),
      body: task == null ? _picker() : _tool(task),
    );
  }

  Widget _picker() => ListView.separated(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
        itemCount: AiTask.values.length,
        separatorBuilder: (_, __) => const SizedBox(height: 6),
        itemBuilder: (_, i) {
          final t = AiTask.values[i];
          return InkWell(
            onTap: () => setState(() => _selected = t),
            borderRadius: BorderRadius.circular(10),
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.surfaceElevated,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Icon(_iconFor(t), size: 18, color: AppColors.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(t.label, style: context.textTheme.bodyMedium),
                        Text(t.blurb,
                            style: context.textTheme.bodySmall
                                ?.copyWith(color: AppColors.textTertiary)),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right,
                      size: 16, color: AppColors.textTertiary),
                ],
              ),
            ),
          );
        },
      );

  IconData _iconFor(AiTask t) {
    switch (t) {
      case AiTask.email:
        return Icons.mail_outline;
      case AiTask.proposal:
        return Icons.description_outlined;
      case AiTask.meetingSummary:
        return Icons.event_note;
      case AiTask.callAnalysis:
        return Icons.graphic_eq;
      case AiTask.leadScore:
        return Icons.leaderboard;
      case AiTask.dealPrediction:
        return Icons.trending_up;
      case AiTask.followUp:
        return Icons.next_plan_outlined;
      case AiTask.sentiment:
        return Icons.sentiment_satisfied_alt;
      case AiTask.forecast:
        return Icons.insights;
    }
  }

  Widget _tool(AiTask task) => ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
        children: [
          Text(task.blurb,
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: 12),
          if (task.needsBrief) ...[
            TextField(
              controller: _brief,
              minLines: 3,
              maxLines: 6,
              decoration: InputDecoration(
                isDense: true,
                hintText: _hintFor(task),
              ),
            ),
            const SizedBox(height: 10),
          ],
          FilledButton.icon(
            onPressed: _busy ? null : () => _run(task),
            icon: _busy
                ? const SizedBox(
                    height: 14,
                    width: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.auto_awesome, size: 16),
            label: Text(_busy ? 'Working…' : 'Generate'),
          ),
          if (_output.isNotEmpty) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surfaceElevated,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              child: SelectableText(_output,
                  style: context.textTheme.bodyMedium),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: _output));
                    context.showSuccess('Copied');
                  },
                  icon: const Icon(Icons.copy, size: 15),
                  label: const Text('Copy'),
                ),
                TextButton.icon(
                  onPressed: _busy ? null : () => _run(task),
                  icon: const Icon(Icons.refresh, size: 15),
                  label: const Text('Redo'),
                ),
              ],
            ),
          ],
        ],
      );

  String _hintFor(AiTask task) {
    switch (task) {
      case AiTask.email:
        return 'Follow up with Asha at Acme after yesterday\'s demo';
      case AiTask.proposal:
        return 'Annual subscription for 25 seats, onboarding included';
      case AiTask.meetingSummary:
        return 'Paste your meeting notes here';
      case AiTask.callAnalysis:
        return 'Paste the call notes or transcript here';
      default:
        return '';
    }
  }
}

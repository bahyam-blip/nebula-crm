import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/ai_agent_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../auth/models/app_user.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../../contacts/models/call_status.dart';
import '../../../telecalling/providers/telecalling_provider.dart';
import '../../../commissions/providers/commission_provider.dart';
import '../../../insights/providers/monitor_provider.dart';
import '../../services/ai_action_executor.dart';

class _Msg {
  _Msg(this.text, {required this.mine, this.pending = false, this.actions});
  final String text;
  final bool mine;
  final bool pending;

  /// What the agent DID on the server for this reply (tools it ran).
  final List<AgentAction>? actions;
}

/// Conversational assistant that can also act on the CRM.
class AiAssistantScreen extends ConsumerStatefulWidget {
  const AiAssistantScreen({super.key});

  @override
  ConsumerState<AiAssistantScreen> createState() => _AiAssistantScreenState();
}

class _AiAssistantScreenState extends ConsumerState<AiAssistantScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _messages = <_Msg>[];
  final _history = <Map<String, String>>[];
  bool _busy = false;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// Facts the model needs to resolve names and counts.
  ///
  /// Deliberately small: sending the whole database would be slow, costly,
  /// and would expose more than the assistant needs to answer.
  Map<String, dynamic> _context() {
    final team = ref.read(teamMembersListProvider).valueOrNull ?? const [];
    final leads = ref.read(teamLeadsProvider).valueOrNull ?? const [];
    final me = ref.read(currentAppUserValueProvider);

    final perPerson = <String, int>{};
    var unassigned = 0;
    for (final c in leads) {
      if (!c.callStatus.isOpen) continue;
      final owner = c.assignedTo;
      if (owner == null) {
        unassigned++;
      } else {
        final name =
            team.where((u) => u.id == owner).map((u) => u.displayName).join();
        if (name.isNotEmpty) perPerson[name] = (perPerson[name] ?? 0) + 1;
      }
    }

    return {
      'me': {
        'name': me?.displayName,
        'role': me?.role.name,
        // Stated explicitly so the model does not have to infer authority
        // from a role name it may not recognise. The executor enforces this
        // regardless; this only makes the refusal polite instead of a
        // permission error after the fact.
        'can': {
          'distributeLeads': me?.role.canManageTeam ?? false,
          'assignTasksToOthers': me?.role.canManageTeam ?? false,
          'seeTeamPerformance': me?.role.canManageCampaigns ?? false,
        },
      },
      'team':
          team.map((u) => {'name': u.displayName, 'role': u.role.name}).toList(),
      'leads': {
        'total': leads.length,
        'open': leads.where((c) => c.callStatus.isOpen).length,
        'unassigned': unassigned,
        'perPerson': perPerson,
      },
      'commissions': {
        'ratePerSale': ref.read(commissionSettingsProvider).valueOrNull
            ?.payoutPerSale,
        'byPerson': {
          for (final r in ref.read(earningsLeaderboardProvider))
            if (r.sales > 0) r.name: {'sales': r.sales, 'earned': r.earned},
        },
      },
      // Signals are computed on-device. Handing the model the conclusions
      // rather than the raw rows keeps it prioritising instead of counting,
      // which it does slower and occasionally wrong.
      'needsAttention':
          ref.read(monitorSummaryProvider)['signals'],
      'today': DateTime.now().toIso8601String().split('T').first,
    };
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _busy) return;
    final me = ref.read(currentAppUserValueProvider);
    if (me == null) {
      // The profile stream hasn't emitted yet. Silent-returning here felt
      // exactly like a dead send button — say what is happening instead.
      if (!mounted) return;
      setState(() {
        _messages.add(_Msg(
          'Your profile is still loading — give it a few seconds and try '
          'again. If this keeps happening, check your connection.',
          mine: false,
        ));
      });
      _jump();
      return;
    }

    setState(() {
      _messages.add(_Msg(text, mine: true));
      _messages.add(_Msg('Thinking...', mine: false, pending: true));
      _busy = true;
      _input.clear();
    });
    _jump();

    try {
      // ── Agentic path (preferred): the WORKER assistant has live CRM
      // access — it can search contacts, quote pipeline/analytics, queue
      // real email campaigns and update the business profile itself.
      final agent = await ref.read(aiAgentServiceProvider).askAgent(
            prompt: text,
            history: _history.take(8).toList(),
          );

      final shown = agent.reply.isNotEmpty ? agent.reply : 'Done.';
      _history
        ..add({'role': 'user', 'content': text})
        ..add({'role': 'assistant', 'content': shown});

      if (!mounted) return;
      setState(() {
        _messages.removeWhere((m) => m.pending);
        _messages.add(_Msg(shown, mine: false, actions: agent.actions));
      });
    } catch (agentError) {
      // ── Fallback: the legacy local flow (ask for a structured action →
      // execute it client-side). Keeps the assistant usable even if the
      // agent endpoint is briefly unavailable.
      try {
        final action = await ref.read(aiAgentServiceProvider).ask(
              prompt: text,
              context: _context(),
              history: _history.take(8).toList(),
            );

        final result = await ref
            .read(aiActionExecutorProvider)
            .run(action, me)
            .timeout(const Duration(seconds: 90));

        // Prefer the executor's message: it reports what actually happened,
        // whereas the model's reply is only what it intended.
        final shown = result.message.isNotEmpty
            ? result.message
            : (action.reply.isNotEmpty ? action.reply : 'Done.');

        _history
          ..add({'role': 'user', 'content': text})
          ..add({'role': 'assistant', 'content': shown});

        if (!mounted) return;
        setState(() {
          _messages.removeWhere((m) => m.pending);
          _messages.add(_Msg(shown, mine: false));
        });
      } catch (e) {
        if (!mounted) return;
        setState(() {
          _messages.removeWhere((m) => m.pending);
          _messages.add(_Msg('$e', mine: false));
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
      _jump();
    }
  }

  void _jump() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(
            _scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      });

  static const _suggestions = [
    'How many open leads do I have right now?',
    "What's Priya's email address?",
    'Send an announcement about our new offer to all leads',
    'How did my last email campaigns perform?',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Assistant')),
      body: Column(
        children: [
          Expanded(
            child: _messages.isEmpty
                ? _empty()
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) => _bubble(_messages[i]),
                  ),
          ),
          _composer(),
        ],
      ),
    );
  }

  Widget _empty() => ListView(
        padding: const EdgeInsets.fromLTRB(16, 28, 16, 16),
        children: [
          // Glowing AI mark — the assistant's "face".
          Center(
            child: Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppColors.premiumGradient,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.35),
                    blurRadius: 28,
                    spreadRadius: 2,
                  ),
                ],
              ),
              child: const Icon(Icons.auto_awesome,
                  size: 32, color: Colors.white),
            ),
          ),
          const SizedBox(height: 16),
          Text('Ask, or tell me what to do',
              textAlign: TextAlign.center,
              style: context.textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            'I can see everything in your CRM — contacts, pipeline, campaigns, '
            'analytics — and I can act: search people, queue on-brand email '
            'campaigns, update your business profile and more.',
            textAlign: TextAlign.center,
            style: context.textTheme.bodySmall
                ?.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 18),
          ..._suggestions.map(
            (s) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: InkWell(
                onTap: () {
                  _input.text = s;
                  _send();
                },
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevated,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.border, width: 0.5),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.auto_awesome,
                          size: 13, color: AppColors.primary),
                      const SizedBox(width: 8),
                      Expanded(child: Text(s, style: context.textTheme.bodySmall)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      );

  Widget _bubble(_Msg m) => Align(
        alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.8,
          ),
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
          decoration: BoxDecoration(
            color: m.mine ? AppColors.primary : AppColors.surfaceElevated,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(16),
              topRight: const Radius.circular(16),
              bottomLeft: Radius.circular(m.mine ? 16 : 4),
              bottomRight: Radius.circular(m.mine ? 4 : 16),
            ),
            border: m.mine
                ? null
                : Border.all(color: AppColors.border, width: 0.5),
            boxShadow: m.pending
                ? []
                : [
                    BoxShadow(
                      color: (m.mine ? AppColors.primary : Colors.black)
                          .withValues(alpha: m.mine ? 0.25 : 0.3),
                      blurRadius: 10,
                      offset: const Offset(0, 3),
                    ),
                  ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                m.text,
                style: context.textTheme.bodyMedium?.copyWith(
                  color: m.mine ? Colors.white : AppColors.textPrimary,
                ),
              ),
              // Show what the agent actually DID — trust through transparency.
              if (!m.mine && m.actions != null && m.actions!.isNotEmpty) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final a in m.actions!)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: (a.ok ? AppColors.success : AppColors.danger)
                              .withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                              color: (a.ok ? AppColors.success : AppColors.danger)
                                  .withValues(alpha: 0.35)),
                        ),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Icon(
                            a.ok ? Icons.check_circle_outline : Icons.error_outline,
                            size: 12,
                            color: a.ok ? AppColors.success : AppColors.danger,
                          ),
                          const SizedBox(width: 4),
                          Text(a.label,
                              style: context.textTheme.labelSmall?.copyWith(
                                  color: AppColors.textSecondary)),
                        ]),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      );

  Widget _composer() => Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _input,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                decoration: const InputDecoration(
                  hintText: 'Ask or instruct...',
                  isDense: true,
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              onPressed: _busy ? null : _send,
              icon: _busy
                  ? const SizedBox(
                      height: 16,
                      width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.arrow_upward, size: 18),
            ),
          ],
        ),
      );
}

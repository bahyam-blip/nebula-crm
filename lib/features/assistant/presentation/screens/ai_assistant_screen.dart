import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

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
  _Msg(this.text,
      {required this.mine,
      this.pending = false,
      this.actions,
      this.approvals,
      this.artifacts});
  final String text;
  final bool mine;
  final bool pending;

  /// What the agent DID on the server for this reply (tools it ran).
  final List<AgentAction>? actions;

  /// Consequential actions the agent PREPARED and is waiting on the human
  /// for (mass email sends). Rendered as Approve/Decline cards.
  final List<AgentApproval>? approvals;

  /// Finished products the agent BUILT this turn (hosted sites, web apps,
  /// notes) — rendered as rich cards with an Open button.
  final List<AgentArtifact>? artifacts;

  /// approvalId → approved? (decided cards lose their buttons)
  final _decided = <String, bool>{};
  bool deciding = false;
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
        _messages.add(_Msg(
          shown,
          mine: false,
          actions: agent.actions,
          approvals:
              agent.approvals.isNotEmpty ? agent.approvals : null,
          artifacts:
              agent.artifacts.isNotEmpty ? agent.artifacts : null,
        ));
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

  /// The human half of the approval gate: execute or cancel a parked
  /// consequential action (e.g. a real mass email campaign).
  Future<void> _decide(_Msg m, AgentApproval ap, bool approve) async {
    if (m.deciding || m._decided.containsKey(ap.id)) return;
    setState(() => m.deciding = true);
    try {
      final result = await ref
          .read(aiAgentServiceProvider)
          .decideApproval(approvalId: ap.id, approve: approve);
      final reply = result.reply.isNotEmpty
          ? result.reply
          : (approve ? 'Approved and queued.' : 'Declined — nothing was sent.');
      if (!mounted) return;
      setState(() {
        m.deciding = false;
        m._decided[ap.id] = approve;
        _messages.add(_Msg(reply,
            mine: false,
            actions: result.actions.isEmpty ? null : result.actions));
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        m.deciding = false;
        _messages.add(_Msg('$e', mine: false));
      });
    }
    _jump();
  }

  static const _suggestions = [
    'How many open leads do I have right now?',
    'Build me an onyx-dark landing page for my studio',
    'Plan a launch: research trends, build the page, then draft the announcement',
    'Research the latest packaging trends and learn a skill from it',
    'Send an announcement about our new offer to all leads',
    'Make a mini web app to collect custom cake orders',
    'Distribute 10 unassigned leads across the team',
    'Log a call with Priya — interested, follow up in 3 days',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Assistant'),
        actions: [
          // Connect an external AI to this CRM over MCP — grants are
          // minted here, self-expire in 24h and are revocable instantly.
          IconButton(
            tooltip: 'Connect an AI (MCP)',
            onPressed: _showMcpSheet,
            icon: const Icon(Icons.hub_outlined, size: 20),
          ),
        ],
      ),
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
          // The assistant's mark — a quiet white ring on black.
          Center(
            child: Container(
              width: 68,
              height: 68,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.glassEdge, width: 1),
                color: AppColors.surfaceElevated,
              ),
              child: const Icon(Icons.auto_awesome_outlined,
                  size: 28, color: AppColors.textPrimary),
            ),
          ),
          const SizedBox(height: 16),
          Text('Ask, or tell me what to do',
              textAlign: TextAlign.center,
              style: context.textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            'I can see everything in your CRM — contacts, pipeline, team, '
            'campaigns, analytics — and I can act: search people, add '
            'contacts, log calls, assign leads, queue on-brand email '
            'campaigns, research the live web, and even BUILD and host '
            'websites, offer pages and mini web apps from a one-line '
            'brief. Big sends wait for your approval. Tap the hub icon '
            'above to connect an external AI over MCP.',
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
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                  decoration: BoxDecoration(
                    color: AppColors.glassFill,
                    borderRadius: BorderRadius.circular(13),
                    border: Border.all(color: AppColors.glassEdge, width: 1),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.auto_awesome,
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
              bottomLeft: Radius.circular(m.mine ? 16.0 : 4.0),
              bottomRight: Radius.circular(m.mine ? 4.0 : 16.0),
            ),
            border: m.mine
                ? null
                : Border.all(color: AppColors.border, width: 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                m.text,
                style: context.textTheme.bodyMedium?.copyWith(
                  color: m.mine ? const Color(0xFF0A0A0A) : AppColors.textPrimary,
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
              // Consequential actions parked for the human — decide right here.
              if (!m.mine && m.approvals != null && m.approvals!.isNotEmpty) ...[
                for (final ap in m.approvals!) _approvalCard(m, ap),
              ],
              // Finished products the agent built — open & share.
              if (!m.mine && m.artifacts != null && m.artifacts!.isNotEmpty)
                ...[for (final ar in m.artifacts!) _artifactCard(ar)],
            ],
          ),
        ),
      );

  /// Card for a consequential action waiting on the human: what it will do,
  /// and Approve / Decline buttons (or the decision once made).
  Widget _approvalCard(_Msg m, AgentApproval ap) {
    final decided = m._decided[ap.id];
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.glassEdge, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(children: [
            Icon(Icons.forward_to_inbox_outlined, size: 15, color: AppColors.textPrimary),
            const SizedBox(width: 6),
            Expanded(
              child: Text('Ready to send — your approval required',
                  style: context.textTheme.labelLarge
                      ?.copyWith(color: AppColors.textPrimary)),
            ),
          ]),
          if (ap.summary.isNotEmpty) ...[
            const SizedBox(height: 5),
            Text(ap.summary,
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary)),
          ],
          const SizedBox(height: 10),
          if (decided == null)
            Row(children: [
              FilledButton.icon(
                onPressed: m.deciding ? null : () => _decide(m, ap, true),
                icon: m.deciding
                    ? const SizedBox(
                        height: 13,
                        width: 13,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.check, size: 15),
                label: const Text('Approve & send'),
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  textStyle: context.textTheme.labelMedium,
                ),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: m.deciding ? null : () => _decide(m, ap, false),
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  foregroundColor: AppColors.textSecondary,
                ),
                child: const Text('Not now'),
              ),
            ])
          else
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: (decided ? AppColors.success : AppColors.textSecondary)
                    .withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(
                  decided ? Icons.check_circle : Icons.block,
                  size: 13,
                  color:
                      decided ? AppColors.success : AppColors.textSecondary,
                ),
                const SizedBox(width: 5),
                Text(decided ? 'Approved — sending' : 'Declined',
                    style: context.textTheme.labelSmall?.copyWith(
                        color: decided
                            ? AppColors.success
                            : AppColors.textSecondary)),
              ]),
            ),
        ],
      ),
    );
  }

  /// Card for something the agent BUILT and hosted: a website, a web app
  /// or a saved note. The URL is public — open it or copy it to share.
  Widget _artifactCard(AgentArtifact ar) {
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.glassEdge, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppColors.surfaceHigh,
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: AppColors.border),
              ),
              child: Icon(ar.icon, size: 15, color: AppColors.textPrimary),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(ar.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.textTheme.labelLarge
                      ?.copyWith(color: AppColors.textPrimary)),
            ),
          ]),
          const SizedBox(height: 4),
          Text(
            ar.kindLabel +
                (ar.url.isNotEmpty
                    ? '  ·  ${Uri.tryParse(ar.url)?.path ?? ''}'
                    : '  ·  in the app'),
            style: context.textTheme.labelSmall
                ?.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 10),
          Row(children: [
            if (ar.url.isNotEmpty) ...[
              FilledButton.icon(
                onPressed: () => _openArtifact(ar),
                icon: const Icon(Icons.open_in_new, size: 14),
                label: const Text('Open'),
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  textStyle: context.textTheme.labelMedium,
                ),
              ),
              const SizedBox(width: 8),
            ],
            OutlinedButton.icon(
              onPressed: ar.url.isNotEmpty
                  ? () => _copyArtifact(ar)
                  : null,
              icon: const Icon(Icons.link, size: 14),
              label: const Text('Copy link'),
              style: OutlinedButton.styleFrom(
                visualDensity: VisualDensity.compact,
                textStyle: context.textTheme.labelMedium,
              ),
            ),
          ]),
        ],
      ),
    );
  }

  Future<void> _openArtifact(AgentArtifact ar) async {
    final uri = Uri.tryParse(ar.url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open ${ar.url}')),
      );
    }
  }

  Future<void> _copyArtifact(AgentArtifact ar) async {
    if (ar.url.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: ar.url));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Link copied — share it with anyone')),
    );
  }

  /// Connect-an-AI sheet: mint a short-lived MCP grant so any external
  /// MCP client (Claude Desktop, Cursor…) can use the CRM's tools. No
  /// static API tokens — grants self-expire in 24h and are revocable.
  void _showMcpSheet() {
    McpPairing? pairing;
    bool minting = false;
    bool revoking = false;
    String? error;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetCtx) => StatefulBuilder(
        builder: (sheetCtx, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(
              18, 18, 18, 18 + MediaQuery.of(sheetCtx).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Icon(Icons.hub_outlined, size: 18, color: AppColors.textPrimary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('Connect an AI to this CRM',
                      style: context.textTheme.titleMedium),
                ),
              ]),
              const SizedBox(height: 8),
              Text(
                'Your assistant\'s tools can be used by AI apps like Claude '
                'or Cursor over MCP. Create a connection below — it lasts '
                '24 hours, works with YOUR permissions only, and can be '
                'revoked instantly. No permanent API keys are ever created.',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 14),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(error!,
                      style: context.textTheme.bodySmall
                          ?.copyWith(color: AppColors.danger)),
                ),
              if (pairing == null)
                FilledButton.icon(
                  onPressed: minting
                      ? null
                      : () async {
                          setSheet(() {
                            minting = true;
                            error = null;
                          });
                          try {
                            final p = await ref
                                .read(aiAgentServiceProvider)
                                .pairMcp(label: 'App pairing');
                            setSheet(() {
                              pairing = p;
                              minting = false;
                            });
                          } catch (e) {
                            setSheet(() {
                              minting = false;
                              error = '$e';
                            });
                          }
                        },
                  icon: minting
                      ? const SizedBox(
                          height: 14,
                          width: 14,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.add_link, size: 16),
                  label: const Text('Create 24h connection'),
                )
              else ...[
                _copyRow(sheetCtx, 'MCP server URL', pairing!.url),
                const SizedBox(height: 8),
                _copyRow(sheetCtx, 'Authorization token', pairing!.token,
                    obscure: true),
                const SizedBox(height: 6),
                Row(children: [
                  Icon(Icons.schedule,
                      size: 13, color: AppColors.textSecondary),
                  const SizedBox(width: 5),
                  Text(pairing!.expiresLabel,
                      style: context.textTheme.labelSmall?.copyWith(
                          color: AppColors.textSecondary)),
                ]),
                const SizedBox(height: 14),
                TextButton.icon(
                  onPressed: revoking
                      ? null
                      : () async {
                          setSheet(() => revoking = true);
                          try {
                            await ref
                                .read(aiAgentServiceProvider)
                                .revokeMcp();
                            if (sheetCtx.mounted) Navigator.pop(sheetCtx);
                          } catch (e) {
                            setSheet(() {
                              revoking = false;
                              error = '$e';
                            });
                          }
                        },
                  style: TextButton.styleFrom(
                      foregroundColor: AppColors.danger),
                  icon: const Icon(Icons.link_off, size: 15),
                  label: const Text('Revoke all connections'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _copyRow(BuildContext ctx, String label, String value,
      {bool obscure = false}) {
    final shown =
        obscure ? '${value.substring(0, 10)}••••••••••••' : value;
    return InkWell(
      onTap: () async {
        await Clipboard.setData(ClipboardData(text: value));
        if (ctx.mounted) {
          ScaffoldMessenger.of(ctx).showSnackBar(
              SnackBar(content: Text('$label copied')));
        }
      },
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border, width: 0.5),
        ),
        child: Row(children: [
          Expanded(
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(label,
                      style: ctx.textTheme.labelSmall?.copyWith(
                          color: AppColors.textSecondary)),
                  const SizedBox(height: 2),
                  Text(shown,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: ctx.textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace')),
                ]),
          ),
          const Icon(Icons.copy, size: 14, color: AppColors.textSecondary),
        ]),
      ),
    );
  }

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
            Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _busy ? AppColors.surfaceHigh : AppColors.primary,
              ),
              child: IconButton(
                onPressed: _busy ? null : _send,
                icon: _busy
                    ? const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.arrow_upward_outlined,
                        size: 19, color: Color(0xFF0A0A0A)),
              ),
            ),
          ],
        ),
      );
}

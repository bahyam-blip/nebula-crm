import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../providers/mail_provider.dart';
import '../../services/mail_api_service.dart';
import 'business_profile_screen.dart';

/// AI Email — give the owner's instruction to the AI, it plans, writes,
/// syncs CRM contacts to MailerCloud and schedules real campaigns. Every
/// created campaign appears in the normal Campaigns screen with live
/// opens/clicks written back by the analytics loop.
///
/// The AI also keeps a persistent BUSINESS MEMORY (what the business sells,
/// who buys, the brand voice + a creative playbook learned from real
/// campaign results) — see the Business Brain card below.
class AiEmailerScreen extends ConsumerStatefulWidget {
  const AiEmailerScreen({super.key});

  @override
  ConsumerState<AiEmailerScreen> createState() => _AiEmailerScreenState();
}

class _AiEmailerScreenState extends ConsumerState<AiEmailerScreen> {
  final _instruction = TextEditingController();
  Timer? _poll;
  bool _busy = false;

  static const _examples = [
    'Send 3 emails this week to leads about our monsoon sale — build urgency, keep it classy',
    'Introduce our business to new subscribers in 2 friendly emails',
    'One re-engagement email to customers who have not bought in a month',
  ];

  /// One-tap design commands — the AI picks the matching premium template
  /// and tone from the owner's wording. Teaches the command vocabulary.
  static const _styleCommands = [
    ('Festive & bold', Icons.celebration_outlined, 'Make it look festive and energetic with a bold offer layout.'),
    ('Dark premium', Icons.dark_mode_outlined, 'Use a dark premium, high-end look.'),
    ('Personal note', Icons.edit_note_outlined, 'Write it like a short personal note from the founder.'),
    ('Product showcase', Icons.grid_view_outlined, 'Showcase the product with feature cards.'),
  ];

  @override
  void dispose() {
    _poll?.cancel();
    _instruction.dispose();
    super.dispose();
  }

  void _startPollingIfNeeded() {
    _poll?.cancel();
    // Adaptive, bounded polling. A fixed 8s tick used to run forever whenever
    // a task got stuck (e.g. during a Firestore outage), with every tick
    // costing Worker → Firestore reads — that amplifies the very outage it
    // waits out. Now: 8s for the first 2 minutes (normal run length), then
    // every 32s, and polling stops entirely after ~10 minutes — a manual
    // pull-to-refresh or reopening the screen resumes it.
    var ticks = 0;
    _poll = Timer.periodic(const Duration(seconds: 8), (t) {
      if (!mounted) { t.cancel(); return; }
      ticks++;
      final active = ref.read(mailHasActiveTasksProvider);
      if (!active) { t.cancel(); return; }
      if (ticks > 75) { t.cancel(); return; } // ~10 min ceiling
      if (ticks > 15 && ticks % 4 != 0) return; // after 2 min: every 32s
      ref.invalidate(mailTasksProvider);
    });
  }

  Future<void> _launch() async {
    final text = _instruction.text.trim();
    if (text.isEmpty) {
      _toast('Describe what you want the AI to email about.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).createTask(text);
      _instruction.clear();
      ref.invalidate(mailTasksProvider);
      _startPollingIfNeeded();
      _toast('AI is planning your campaign — watch the task below.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleDryRun(bool live) async {
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).setDryRun(!live);
      ref.invalidate(mailStatusProvider);
      _toast(live ? 'Safety mode ON — nothing will send.' : 'Live mode — scheduled emails will send.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _refreshAnalytics() async {
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).analytics(refresh: true);
      ref.invalidate(mailAnalyticsProvider);
      // The refresh also pulls provider-reported unsubscribes into the
      // suppression list — keep the count honest alongside the metrics.
      ref.invalidate(mailSuppressionsProvider);
      _toast('Analytics refreshed from MailerCloud.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _syncContacts() async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(mailApiProvider).syncContacts();
      _toast('Synced ${r['crmContacts'] ?? '?'} CRM contact(s) to MailerCloud.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runNow() async {
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).run(force: true);
      ref.invalidate(mailTasksProvider);
      _startPollingIfNeeded();
      _toast('Pipeline executed.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// See exactly what your customers receive: a real, customer-facing sample
  /// campaign in your brand voice (AI-drafted, honouring your instruction).
  Future<void> _sendTest() async {
    final controller = TextEditingController(
      text: FirebaseAuth.instance.currentUser?.email ?? '',
    );
    final instruction = TextEditingController();
    final to = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Preview a sample campaign'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Your AI writes a fresh sample campaign in your brand voice and sends it to you — exactly what your customers will receive.',
              style: context.textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType: TextInputType.emailAddress,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Deliver to',
                hintText: 'you@example.com',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: instruction,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(
                labelText: 'What should it be about? (optional)',
                hintText: 'e.g. festive Diwali offer for law firms',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Send sample')),
        ],
      ),
    );
    if (to == null || to.isEmpty) return;
    if (!mounted) return;

    setState(() => _busy = true);
    try {
      final r = await ref.read(mailApiProvider).sendTestEmail(to, instruction: instruction.text);
      if (r['ok'] == true) {
        final subj = (r['subject'] ?? '').toString();
        _toast('Sample sent to ${r['sent_to']} — open it to see what your customers get${subj.isNotEmpty ? ' ("$subj")' : ''}.');
      } else {
        final code = r['provider_status'] ?? '?';
        final err = (r['error'] ?? r['message'] ?? 'unknown error').toString();
        _toast('Provider rejected ($code): $err');
      }
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteTask(MailTask t) async {
    try {
      await ref.read(mailApiProvider).deleteTask(t.id);
      ref.invalidate(mailTasksProvider);
    } catch (e) {
      _toast(e.toString());
    }
  }

  Future<void> _cancelTask(MailTask t) async {
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).cancelTask(t.id);
      ref.invalidate(mailTasksProvider);
      _toast('Task cancelled — no further emails will send.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _retryTask(MailTask t) async {
    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).retryTask(t.id);
      ref.invalidate(mailTasksProvider);
      _toast('Retry queued — the AI will take it from where it failed.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating));
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(mailStatusProvider);
    final tasks = ref.watch(mailTasksProvider);
    final analytics = ref.watch(mailAnalyticsProvider);
    final memory = ref.watch(mailMemoryProvider);
    final business = ref.watch(mailBusinessProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Email'),
        actions: [
          IconButton(
            tooltip: 'Business Profile — your email brand',
            onPressed: _busy ? null : _openBusinessProfile,
            icon: const Icon(Icons.business_center_outlined, size: 20),
          ),
          IconButton(
            tooltip: 'Business Brain — what the AI knows',
            onPressed: _busy ? null : _openMemorySheet,
            icon: const Icon(Icons.psychology_alt_outlined, size: 20),
          ),
          IconButton(
            tooltip: 'Preview a sample campaign — see what your customers receive',
            onPressed: _busy ? null : _sendTest,
            icon: const Icon(Icons.outgoing_mail, size: 20),
          ),
          IconButton(
            tooltip: 'Sync contacts to MailerCloud',
            onPressed: _busy ? null : _syncContacts,
            icon: const Icon(Icons.cloud_sync_outlined, size: 20),
          ),
          IconButton(
            tooltip: 'Run pipeline now',
            onPressed: _busy ? null : _runNow,
            icon: const Icon(Icons.play_circle_outline, size: 20),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(mailStatusProvider);
          ref.invalidate(mailTasksProvider);
          ref.invalidate(mailAnalyticsProvider);
          ref.invalidate(mailMemoryProvider);
          ref.invalidate(mailBusinessProvider);
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
          children: [
            // ── Business branding (who the emails come FROM) ──
            business.when(
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
              data: (p) => _BrandingCard(profile: p, onEdit: _openBusinessProfile),
            ),
            const SizedBox(height: 14),

            status.when(
              loading: () => const Center(
                  child: Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(strokeWidth: 2),
              )),
              error: (e, _) => ErrorState(
                message: '$e',
                onRetry: () => ref.invalidate(mailStatusProvider),
              ),
              data: (s) => _StatusCard(status: s, onToggle: _toggleDryRun, onTestSend: _sendTest),
            ),
            const SizedBox(height: 14),

            // ── Business Brain (AI memory) ──
            memory.when(
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
              data: (m) => _MemoryCard(
                memory: m,
                onTeach: _openTeachDialog,
                onView: _openMemorySheet,
              ),
            ),
            const SizedBox(height: 14),

            // ── Composer ──
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 26,
                        height: 26,
                        decoration: BoxDecoration(
                          gradient: AppColors.premiumGradient,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(Icons.auto_awesome,
                            size: 15, color: Colors.white),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text('Give the AI a task',
                            style: context.textTheme.titleSmall),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Plain language. Say how many emails, to whom, and about what — even HOW it should look. The AI decides timing, audience, copy and design.',
                    style: context.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _instruction,
                    minLines: 3,
                    maxLines: 6,
                    maxLength: 4000,
                    style: context.textTheme.bodyMedium,
                    decoration: InputDecoration(
                      hintText:
                          'e.g. Send 2 emails this week to leads about our 20% monsoon discount. Friendly but premium tone.',
                      filled: true,
                      fillColor: AppColors.surfaceElevated,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final ex in _examples)
                        ActionChip(
                          label: Text(ex.split(' ').take(5).join(' ') + '…',
                              style: context.textTheme.labelSmall),
                          onPressed: () => _instruction.text = ex,
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text('Design commands — tap to append, or write your own:',
                      style: context.textTheme.labelSmall
                          ?.copyWith(color: AppColors.textTertiary, fontSize: 10)),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final (label, icon, cmd) in _styleCommands)
                        ActionChip(
                          avatar: Icon(icon, size: 14, color: AppColors.primary),
                          label: Text(label,
                              style: context.textTheme.labelSmall
                                  ?.copyWith(color: AppColors.primary)),
                          side: BorderSide(
                              color: AppColors.primary.withValues(alpha: 0.35),
                              width: 0.6),
                          onPressed: () {
                            final t = _instruction.text.trim();
                            _instruction.text = t.isEmpty
                                ? cmd
                                : (t.endsWith('.') || t.endsWith('!') || t.endsWith('?')
                                    ? '$t $cmd'
                                    : '$t. $cmd');
                          },
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _busy ? null : _launch,
                      icon: const Icon(Icons.auto_awesome, size: 18),
                      label: const Text('Launch AI campaign'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // ── Analytics ──
            analytics.when(
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
              data: (a) => a == null
                  ? const SizedBox.shrink()
                  : _AnalyticsCard(
                      a: a,
                      onRefresh: _refreshAnalytics,
                      suppressions: ref.watch(mailSuppressionsProvider).valueOrNull?.length,
                    ),
            ),

            // ── Tasks ──
            SectionHeader(
              title: 'Campaign tasks',
              subtitle: 'Plan → write → schedule. Completed emails appear in Campaigns.',
              actionLabel: 'Refresh',
              onAction: () => ref.invalidate(mailTasksProvider),
            ),
            tasks.when(
              loading: () => const Center(
                  child: Padding(
                padding: EdgeInsets.all(16),
                child: CircularProgressIndicator(strokeWidth: 2),
              )),
              error: (e, _) => ErrorState(
                message: '$e',
                onRetry: () => ref.invalidate(mailTasksProvider),
              ),
              data: (list) {
                if (list.isEmpty) {
                  return const EmptyState(
                    icon: Icons.forward_to_inbox,
                    title: 'No AI tasks yet',
                    subtitle:
                        'Type an instruction above — the AI plans the emails, targets your CRM audience and schedules everything on MailerCloud.',
                  );
                }
                return Column(
                  children: [
                    for (final i in list.indexed)
                      _TaskCard(
                        task: i.$2,
                        onDelete: () => _deleteTask(i.$2),
                        onCancel: () => _cancelTask(i.$2),
                        onRetry: i.$2.status == 'failed' ? () => _retryTask(i.$2) : null,
                      ).animate().fadeIn(duration: 220.ms, delay: (i.$1 * 40).ms),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  /* ── Business Brain: view + teach ── */

  void _openBusinessProfile() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const BusinessProfileScreen()),
    ).then((_) {
      // Returning from the profile: the brand (and AI memory) may have changed.
      ref.invalidate(mailBusinessProvider);
      ref.invalidate(mailMemoryProvider);
      ref.invalidate(mailStatusProvider);
    });
  }

  void _openMemorySheet() {
    ref.invalidate(mailMemoryProvider);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Consumer(
        builder: (context, ref, _) {
          final mem = ref.watch(mailMemoryProvider);
          return DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.65,
            maxChildSize: 0.92,
            builder: (context, controller) => mem.when(
              loading: () => const Center(child: CircularProgressIndicator(strokeWidth: 2)),
              error: (e, _) => ErrorState(message: '$e', onRetry: () => ref.invalidate(mailMemoryProvider)),
              data: (m) => _MemorySheet(
                memory: m,
                scrollController: controller,
                onTeach: () {
                  Navigator.pop(context);
                  _openTeachDialog();
                },
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _openTeachDialog() async {
    final biz = TextEditingController();
    final audience = TextEditingController();
    final tone = TextEditingController();
    final products = TextEditingController();
    final note = TextEditingController();

    // Pre-fill from what the AI already knows.
    final current = ref.read(mailMemoryProvider).valueOrNull;
    if (current != null) {
      biz.text = current.businessType;
      audience.text = current.audience;
      tone.text = current.tone;
      products.text = current.products.join(', ');
    }

    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Teach the AI your business'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Everything you share here is used to write sharper, on-brand emails. The AI also learns on its own from your CRM and campaign results.',
                style: context.textTheme.bodySmall,
              ),
              const SizedBox(height: 12),
              _field(biz, 'What does your business do / sell?', 'e.g. We sell handmade artisan coffee, roasted fresh in Mumbai'),
              const SizedBox(height: 10),
              _field(audience, 'Who are your customers?', 'e.g. Cafes and young professionals who love premium coffee'),
              const SizedBox(height: 10),
              _field(tone, 'Brand voice / tone', 'e.g. Warm, premium, a little playful'),
              const SizedBox(height: 10),
              _field(products, 'Products / services (comma separated)', 'e.g. Espresso beans, Cold brew, Subscriptions'),
              const SizedBox(height: 10),
              _field(note, 'Anything else the AI should know?', 'e.g. We run free delivery on orders above ₹999; avoid discount-only messaging', maxLines: 3),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save to memory')),
        ],
      ),
    );
    if (saved != true) return;
    if (!mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(mailApiProvider).teach(
            businessType: biz.text,
            audience: audience.text,
            tone: tone.text,
            products: products.text.split(','),
            note: note.text,
          );
      ref.invalidate(mailMemoryProvider);
      ref.invalidate(mailStatusProvider);
      _toast('Learned. The AI will use this in every campaign it writes.');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _field(TextEditingController c, String label, String hint, {int maxLines = 1}) {
    return TextField(
      controller: c,
      maxLines: maxLines,
      style: context.textTheme.bodyMedium,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        alignLabelWithHint: true,
        border: const OutlineInputBorder(),
      ),
    );
  }
}

/* ── Business branding card ── */

/// Shows WHO the emails are sent as. Unbranded → a nudge to set up the
/// business profile (the #1 thing that makes the mailer feel like the
/// owner's own company instead of a tool).
class _BrandingCard extends StatelessWidget {
  const _BrandingCard({required this.profile, required this.onEdit});
  final BusinessProfile profile;
  final VoidCallback onEdit;

  Color get _brandColor {
    final hex = profile.brandColor.replaceAll('#', '');
    if (hex.length == 6) {
      final v = int.tryParse(hex, radix: 16);
      if (v != null) return Color(0xFF000000 | v);
    }
    return AppColors.primary;
  }

  @override
  Widget build(BuildContext context) {
    final branded = profile.effectiveSenderName.isNotEmpty;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: branded
              ? _brandColor.withValues(alpha: 0.5)
              : AppColors.warning.withValues(alpha: 0.45),
        ),
      ),
      child: Row(
        children: [
          if (profile.logoUrl.isNotEmpty)
            CircleAvatar(
              radius: 20,
              backgroundImage: NetworkImage(profile.logoUrl),
              onBackgroundImageError: (_, __) {},
            )
          else
            CircleAvatar(
              radius: 20,
              backgroundColor:
                  branded ? _brandColor : AppColors.warning.withValues(alpha: 0.25),
              child: Text(
                branded ? profile.effectiveSenderName[0].toUpperCase() : '!',
                style: TextStyle(
                  color: branded ? Colors.white : AppColors.warning,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  branded
                      ? 'Sending as ${profile.effectiveSenderName}'
                      : 'Emails still go out as “Nebula CRM”',
                  style: context.textTheme.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  branded
                      ? 'Branded templates, your footer & signature — tap to edit'
                      : 'Set up your business brand — every email will carry it',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.textSecondary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filledTonal(
            onPressed: onEdit,
            tooltip: 'Business Profile',
            icon: Icon(branded ? Icons.edit_outlined : Icons.add_business,
                size: 20),
          ),
        ],
      ),
    );
  }
}

/* ── Status card ── */

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status, required this.onToggle, this.onTestSend});
  final MailStatus status;
  final ValueChanged<bool> onToggle;
  final VoidCallback? onTestSend;

  @override
  Widget build(BuildContext context) {
    final missing = status.missing;
    final live = !status.dryRun;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.primary.withValues(alpha: 0.16),
            AppColors.accent.withValues(alpha: 0.10),
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: (status.configured ? AppColors.success : AppColors.warning)
                      .withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  status.configured ? Icons.mark_email_read_outlined : Icons.mark_email_unread_outlined,
                  color: status.configured ? AppColors.success : AppColors.warning,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      status.configured ? 'Email engine ready' : 'Email engine needs setup',
                      style: context.textTheme.titleSmall,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      status.configured
                          ? (status.businessType != null
                              ? 'AI understands: ${status.businessType}'
                              : 'AI learns your business from your tasks & CRM')
                          : 'Missing: ${missing.join(", ")}',
                      style: context.textTheme.labelSmall
                          ?.copyWith(color: AppColors.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (status.configured) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(Icons.verified_user_outlined, size: 14, color: AppColors.success),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'From: ${status.senderName.isEmpty ? 'Nebula CRM' : status.senderName} <${status.senderEmail.isEmpty ? 'das@aidraft.bond' : status.senderEmail}>'
                    '  ·  delivery: ${status.deliveryMode}',
                    style: context.textTheme.labelSmall
                        ?.copyWith(color: AppColors.textSecondary),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            if (!status.ready && missing.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                'AI campaign planning also needs: ${missing.join(", ")}. Test sends work without it.',
                style: context.textTheme.labelSmall
                    ?.copyWith(color: AppColors.textTertiary),
              ),
            ],
          ],
          for (final w in status.warnings.take(1)) ...[
            const SizedBox(height: 6),
            Text(w,
                style: context.textTheme.labelSmall
                    ?.copyWith(color: AppColors.warning)),
          ],
          if (missing.contains('MAILERCLOUD_API_KEY')) ...[
            const SizedBox(height: 10),
            Text(
              'Add MAILERCLOUD_API_KEY in the repo (Settings → Secrets → Actions), then re-run the Deploy Worker workflow. Everything else is already wired.',
              style: context.textTheme.labelSmall
                  ?.copyWith(color: AppColors.textTertiary),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Switch(
                value: live,
                activeColor: AppColors.success,
                onChanged: (v) => onToggle(v),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  live ? 'LIVE — scheduled emails really send' : 'Safety mode — drafts only, nothing sends',
                  style: context.textTheme.labelMedium?.copyWith(
                    color: live ? AppColors.success : AppColors.textSecondary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          if (status.configured && onTestSend != null) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: onTestSend,
                icon: const Icon(Icons.outgoing_mail, size: 16),
                label: const Text('Preview a sample campaign'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/* ── Business Brain card ── */

class _MemoryCard extends StatelessWidget {
  const _MemoryCard({required this.memory, required this.onTeach, required this.onView});
  final MailMemory memory;
  final VoidCallback onTeach;
  final VoidCallback onView;

  @override
  Widget build(BuildContext context) {
    final knowsSomething = !memory.isEmpty;
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.accent.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  knowsSomething ? Icons.psychology : Icons.psychology_alt_outlined,
                  color: AppColors.accent,
                  size: 20,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Business Brain', style: context.textTheme.titleSmall),
                    Text(
                      knowsSomething
                          ? 'The AI knows your business: ${memory.factCount} fact(s) · ${memory.insights.length} playbook lesson(s)'
                          : 'Teach the AI once — every campaign gets smarter',
                      style: context.textTheme.labelSmall
                          ?.copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'View everything the AI knows',
                onPressed: onView,
                icon: const Icon(Icons.visibility_outlined, size: 18, color: AppColors.textSecondary),
              ),
            ],
          ),
          if (knowsSomething && memory.businessType.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              memory.businessType,
              style: context.textTheme.bodySmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: onTeach,
              icon: const Icon(Icons.school_outlined, size: 16),
              label: Text(memory.isEmpty ? 'Teach the AI about your business' : 'Update what the AI knows'),
            ),
          ),
        ],
      ),
    );
  }
}

/* ── Business Brain sheet (full memory view) ── */

class _MemorySheet extends StatelessWidget {
  const _MemorySheet({
    required this.memory,
    required this.scrollController,
    required this.onTeach,
  });

  final MailMemory memory;
  final ScrollController scrollController;
  final VoidCallback onTeach;

  static const _kindColors = {
    'winner': AppColors.success,
    'flop': AppColors.danger,
    'timing': AppColors.warning,
    'subject': AppColors.info,
    'recommendation': AppColors.primary,
    'positioning': AppColors.accent,
  };

  @override
  Widget build(BuildContext context) {
    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      children: [
        Center(
          child: Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(bottom: 14),
            decoration: BoxDecoration(
              color: AppColors.border,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        Row(
          children: [
            const Icon(Icons.psychology, color: AppColors.accent, size: 22),
            const SizedBox(width: 8),
            Expanded(child: Text('Business Brain', style: context.textTheme.titleMedium)),
            TextButton.icon(
              onPressed: onTeach,
              icon: const Icon(Icons.edit_outlined, size: 15),
              label: const Text('Teach'),
            ),
          ],
        ),
        if (memory.isEmpty) ...[
          const SizedBox(height: 8),
          Text(
            'The AI has not learned anything yet. Use Teach to describe your business — or just run a campaign and let it learn from your CRM and results.',
            style: context.textTheme.bodySmall?.copyWith(color: AppColors.textSecondary),
          ),
        ],
        if (memory.businessType.isNotEmpty) ...[
          const SizedBox(height: 12),
          _factTile(context, Icons.storefront_outlined, 'Business', memory.businessType),
        ],
        if (memory.industry.isNotEmpty)
          _factTile(context, Icons.category_outlined, 'Industry', memory.industry),
        if (memory.audience.isNotEmpty)
          _factTile(context, Icons.group_outlined, 'Customers', memory.audience),
        if (memory.tone.isNotEmpty)
          _factTile(context, Icons.record_voice_over_outlined, 'Brand voice', memory.tone),
        if (memory.products.isNotEmpty)
          _factTile(context, Icons.inventory_2_outlined, 'Products / services', memory.products.join(' · ')),
        if (memory.offers.isNotEmpty)
          _factTile(context, Icons.local_offer_outlined, 'Current offers', memory.offers.join(' · ')),
        if (memory.insights.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Creative playbook (learned from results)', style: context.textTheme.titleSmall),
          const SizedBox(height: 6),
          for (final i in memory.insights.take(20))
            Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.surfaceElevated,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border, width: 0.5),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: (_kindColors[i.kind] ?? AppColors.textTertiary).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      i.kind,
                      style: context.textTheme.labelSmall?.copyWith(
                        color: _kindColors[i.kind] ?? AppColors.textSecondary,
                        fontSize: 10,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(i.text, style: context.textTheme.bodySmall),
                  ),
                  if (i.weight > 1)
                    Text(' ×${i.weight}',
                        style: context.textTheme.labelSmall
                            ?.copyWith(color: AppColors.textTertiary)),
                ],
              ),
            ),
        ],
        if (memory.notes.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text('Recent campaign focus', style: context.textTheme.titleSmall),
          const SizedBox(height: 6),
          for (final n in memory.notes.take(8))
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.history, size: 13, color: AppColors.textTertiary),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(n, style: context.textTheme.labelSmall?.copyWith(color: AppColors.textSecondary)),
                  ),
                ],
              ),
            ),
        ],
      ],
    );
  }

  Widget _factTile(BuildContext context, IconData icon, String label, String value) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppColors.accent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: context.textTheme.labelSmall
                        ?.copyWith(color: AppColors.textTertiary)),
                const SizedBox(height: 2),
                Text(value, style: context.textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/* ── Analytics card ── */

class _AnalyticsCard extends StatelessWidget {
  const _AnalyticsCard({required this.a, required this.onRefresh, this.suppressions});
  final MailAnalytics a;
  final VoidCallback onRefresh;

  /// Addresses that will never be emailed again (unsubs, bounces, spam
  /// reports). Null = still loading (shows an ellipsis, never a fake 0).
  final int? suppressions;

  @override
  Widget build(BuildContext context) {
    final t = a.totals;
    final deliveredBase = t.delivered > 0 ? t.delivered : 0;
    double rateOf(int n) => deliveredBase > 0 ? (n / deliveredBase) * 100 : 0.0;
    final openRate = rateOf(t.opens);
    final clickRate = rateOf(t.clicks);
    final unsubRate = rateOf(t.unsubs);
    final deliveryPct = t.deliveryRate ?? (t.recipients > 0 ? (t.delivered / t.recipients) * 100 : 0.0);

    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Engagement', style: context.textTheme.titleSmall),
              ),
              _RateChip(label: 'Delivery', pct: deliveryPct, color: AppColors.success),
              const SizedBox(width: 6),
              IconButton(
                onPressed: onRefresh,
                icon: const Icon(Icons.refresh, size: 18, color: AppColors.textSecondary),
                tooltip: 'Pull fresh numbers from MailerCloud',
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
          const SizedBox(height: 12),

          // ── Hero KPI tiles: open & click rate, the two numbers the
          //    owner actually markets against ──────────────────────
          Row(
            children: [
              Expanded(
                child: _KpiTile(
                  label: 'Open rate',
                  pct: openRate,
                  caption: '${t.opens} opened',
                  colors: const [AppColors.primary, AppColors.accent],
                  icon: Icons.visibility_outlined,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _KpiTile(
                  label: 'Click rate',
                  pct: clickRate,
                  caption: '${t.clicks} clicked',
                  colors: const [AppColors.tertiary, Color(0xFFFFB547)],
                  icon: Icons.touch_app_outlined,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // ── Delivery funnel — each stage as a share of the last ──
          _FunnelBar(
            label: 'Delivered',
            count: t.delivered,
            fraction: t.recipients > 0 ? (t.delivered / t.recipients).clamp(0.0, 1.0) : 0,
            color: AppColors.success,
          ),
          _FunnelBar(
            label: 'Opened',
            count: t.opens,
            fraction: t.delivered > 0 ? (t.opens / t.delivered).clamp(0.0, 1.0) : 0,
            color: AppColors.primary,
          ),
          _FunnelBar(
            label: 'Clicked',
            count: t.clicks,
            fraction: t.delivered > 0 ? (t.clicks / t.delivered).clamp(0.0, 1.0) : 0,
            color: AppColors.accent,
          ),
          _FunnelBar(
            label: 'Not delivered',
            count: t.notDelivered,
            fraction: t.recipients > 0 ? (t.notDelivered / t.recipients).clamp(0.0, 1.0) : 0,
            color: AppColors.danger,
          ),
          _FunnelBar(
            label: 'Unsubscribed',
            count: t.unsubs,
            fraction: t.delivered > 0 ? (t.unsubs / t.delivered).clamp(0.04, 1.0) : 0,
            color: AppColors.warning,
            minBarPct: unsubRate,
          ),
          const SizedBox(height: 12),

          // ── Footer facts strip ───────────────────────────────────
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border, width: 0.5),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _MiniFact(
                    label: 'Sent',
                    value: '${t.recipients}',
                  ),
                ),
                const _DotDivider(),
                Expanded(
                  child: _MiniFact(
                    label: 'Campaigns',
                    value: '${a.campaigns}',
                  ),
                ),
                const _DotDivider(),
                Expanded(
                  child: _MiniFact(
                    label: 'Suppressed',
                    value: '${suppressions ?? '…'}',
                  ),
                ),
                if (a.bestSendHour != null) ...[
                  const _DotDivider(),
                  Expanded(
                    child: _MiniFact(
                      label: 'Best hour',
                      value: '${a.bestSendHour}:00',
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (a.recommendations.isNotEmpty) ...[
            const SizedBox(height: 12),
            for (final r in a.recommendations.take(3))
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.tips_and_updates_outlined,
                        size: 14, color: AppColors.primary),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(r,
                          style: context.textTheme.labelSmall
                              ?.copyWith(color: AppColors.textSecondary)),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// Big gradient KPI tile — rate + supporting count. The gradient text makes
/// the primary engagement numbers pop like a premium analytics product.
class _KpiTile extends StatelessWidget {
  const _KpiTile({
    required this.label,
    required this.pct,
    required this.caption,
    required this.colors,
    required this.icon,
  });
  final String label;
  final double pct;
  final String caption;
  final List<Color> colors;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final gradient = LinearGradient(colors: colors);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            colors.first.withValues(alpha: 0.14),
            colors.last.withValues(alpha: 0.05),
          ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.first.withValues(alpha: 0.35), width: 0.8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: colors.first),
              const SizedBox(width: 5),
              Text(label,
                  style: context.textTheme.labelSmall
                      ?.copyWith(color: AppColors.textSecondary)),
            ],
          ),
          const SizedBox(height: 8),
          ShaderMask(
            shaderCallback: (bounds) => gradient.createShader(bounds),
            blendMode: BlendMode.srcIn,
            child: Text(
              '${pct.toStringAsFixed(1)}%',
              style: context.textTheme.headlineMedium
                  ?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5),
            ),
          ),
          const SizedBox(height: 2),
          Text(caption,
              style: context.textTheme.labelSmall
                  ?.copyWith(color: AppColors.textTertiary)),
        ],
      ),
    );
  }
}

/// One funnel stage: label, proportional track bar, count.
class _FunnelBar extends StatelessWidget {
  const _FunnelBar({
    required this.label,
    required this.count,
    required this.fraction,
    required this.color,
    this.minBarPct,
  });
  final String label;
  final int count;
  final double fraction;
  final Color color;
  final double? minBarPct;

  @override
  Widget build(BuildContext context) {
    final f = fraction.isNaN ? 0.0 : fraction;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          SizedBox(
            width: 92,
            child: Text(label,
                style: context.textTheme.labelSmall
                    ?.copyWith(color: AppColors.textSecondary)),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: Stack(
                children: [
                  Container(
                    height: 8,
                    color: AppColors.surfaceHigh,
                  ),
                  FractionallySizedBox(
                    widthFactor: f,
                    child: Container(
                      height: 8,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: [
                          color.withValues(alpha: 0.55),
                          color,
                        ]),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 52,
            child: Text(
              '$count${minBarPct != null && minBarPct! > 0 ? ' · ${minBarPct!.toStringAsFixed(1)}%' : ''}',
              textAlign: TextAlign.right,
              style: context.textTheme.labelSmall
                  ?.copyWith(color: color, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact rate chip used in card headers.
class _RateChip extends StatelessWidget {
  const _RateChip({required this.label, required this.pct, required this.color});
  final String label;
  final double pct;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35), width: 0.6),
      ),
      child: Text(
        '$label ${pct.toStringAsFixed(0)}%',
        style: context.textTheme.labelSmall?.copyWith(
          color: color,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// Small label/value fact for the footer strip.
class _MiniFact extends StatelessWidget {
  const _MiniFact({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value,
            style: context.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 1),
        Text(label,
            style: context.textTheme.labelSmall
                ?.copyWith(color: AppColors.textTertiary, fontSize: 10)),
      ],
    );
  }
}

class _DotDivider extends StatelessWidget {
  const _DotDivider();
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 3,
      height: 3,
      margin: const EdgeInsets.symmetric(horizontal: 10),
      decoration: const BoxDecoration(
        color: AppColors.textTertiary,
        shape: BoxShape.circle,
      ),
    );
  }
}

/* ── Task card ── */

class _TaskCard extends StatefulWidget {
  const _TaskCard({
    required this.task,
    required this.onDelete,
    required this.onCancel,
    this.onRetry,
  });
  final MailTask task;
  final VoidCallback onDelete;
  final VoidCallback onCancel;
  final VoidCallback? onRetry;

  @override
  State<_TaskCard> createState() => _TaskCardState();
}

class _TaskCardState extends State<_TaskCard> {
  bool _expanded = false;

  Color _statusColor(String s) => switch (s) {
        'done' => AppColors.success,
        'active' || 'planning' || 'pending' => AppColors.info,
        'failed' => AppColors.danger,
        'cancelled' => AppColors.textTertiary,
        _ => AppColors.textTertiary,
      };

  IconData _eventIcon(String kind) => switch (kind) {
        'plan' => Icons.route_outlined,
        'send' => Icons.send_outlined,
        'error' => Icons.error_outline,
        'cancel' => Icons.cancel_outlined,
        _ => Icons.circle_notifications_outlined,
      };

  Color _eventColor(String kind) => switch (kind) {
        'send' => AppColors.success,
        'error' => AppColors.danger,
        'cancel' => AppColors.textTertiary,
        'plan' => AppColors.accent,
        _ => AppColors.info,
      };

  String _time(String iso) {
    final t = DateTime.tryParse(iso);
    if (t == null) return '';
    final local = t.toLocal();
    return '${local.day}/${local.month} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final p = task.progress;
    final hasProgress = p.total > 0;
    final canCancel = task.isActive;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: task.events.isEmpty ? null : () => setState(() => _expanded = !_expanded),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      task.instruction,
                      style: context.textTheme.bodyMedium,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  StatusBadge(
                    label: task.status.toUpperCase(),
                    color: _statusColor(task.status),
                    outlined: true,
                  ),
                  PopupMenuButton<String>(
                    padding: EdgeInsets.zero,
                    icon: const Icon(Icons.more_vert, size: 18, color: AppColors.textTertiary),
                    onSelected: (v) {
                      if (v == 'delete') widget.onDelete();
                      if (v == 'retry') widget.onRetry?.call();
                    },
                    itemBuilder: (_) => [
                      if (widget.onRetry != null)
                        const PopupMenuItem(
                          value: 'retry',
                          child: Text('Retry failed campaign'),
                        ),
                      const PopupMenuItem(value: 'delete', child: Text('Delete task')),
                    ],
                  ),
                ],
              ),
              if (hasProgress) ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: p.total == 0 ? null : (p.done + p.failed) / p.total,
                          minHeight: 5,
                          backgroundColor: AppColors.surfaceElevated,
                          color: p.failed > 0 && p.done == 0 ? AppColors.danger : AppColors.primary,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      '${p.done + p.failed}/${p.total} processed',
                      style: context.textTheme.labelSmall
                          ?.copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
                if (p.nextSendAt.isNotEmpty && p.pending > 0) ...[
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Icon(Icons.schedule, size: 13, color: AppColors.textTertiary),
                      const SizedBox(width: 5),
                      Text(
                        'Next email: ${_time(p.nextSendAt)} (${p.pending} planned)',
                        style: context.textTheme.labelSmall
                            ?.copyWith(color: AppColors.textTertiary),
                      ),
                    ],
                  ),
                ],
              ],
              if (task.emails.isNotEmpty) ...[
                const SizedBox(height: 10),
                for (final e in task.emails)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        Icon(
                          switch (e.status) {
                            'scheduled' => Icons.schedule_send,
                            'sent' || 'partial' => Icons.mark_email_read_outlined,
                            'dry_run' => Icons.mark_email_read_outlined,
                            'failed' => Icons.error_outline,
                            'planned' => Icons.schedule,
                            'cancelled' => Icons.cancel_outlined,
                            _ => Icons.mail_outline,
                          },
                          size: 15,
                          color: switch (e.status) {
                            'failed' => AppColors.danger,
                            'scheduled' || 'sent' => AppColors.success,
                            'partial' => AppColors.warning,
                            'cancelled' => AppColors.textTertiary,
                            _ => AppColors.info,
                          },
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            e.subject ?? 'Email ${e.seq} — waiting for the AI',
                            style: context.textTheme.labelMedium,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        // Provider truth for THIS email: "1 delivered",
                        // "1 delivered, 1 failed" — empty until it sends.
                        if (e.hasDelivery)
                          Text(
                            e.deliveryLabel,
                            style: context.textTheme.labelSmall?.copyWith(
                              color: (e.failed ?? 0) > 0
                                  ? AppColors.warning
                                  : AppColors.success,
                            ),
                          )
                        else
                          Text(
                            _time(e.sendAt),
                            style: context.textTheme.labelSmall
                                ?.copyWith(color: AppColors.textTertiary),
                          ),
                      ],
                    ),
                  ),
              ],
              if (task.error != null) ...[
                const SizedBox(height: 6),
                Text('Error: ${task.error}',
                    style: context.textTheme.labelSmall
                        ?.copyWith(color: AppColors.danger)),
              ],
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Created ${_time(task.createdAt)}'
                      '${task.events.isEmpty ? '' : '  ·  tap for AI activity log'}',
                      style: context.textTheme.labelSmall
                          ?.copyWith(color: AppColors.textTertiary),
                    ),
                  ),
                  if (canCancel)
                    TextButton.icon(
                      onPressed: widget.onCancel,
                      icon: const Icon(Icons.cancel_outlined, size: 14),
                      label: const Text('Cancel'),
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.danger,
                        visualDensity: VisualDensity.compact,
                      ),
                    ),
                ],
              ),
              if (_expanded && task.events.isNotEmpty) ...[
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevated,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.border, width: 0.5),
                  ),
                  child: Column(
                    children: [
                      for (final ev in task.events)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(_eventIcon(ev.kind), size: 13, color: _eventColor(ev.kind)),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  ev.text,
                                  style: context.textTheme.labelSmall,
                                ),
                              ),
                              Text(
                                _time(ev.at),
                                style: context.textTheme.labelSmall
                                    ?.copyWith(color: AppColors.textTertiary, fontSize: 10),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/* ── Shared card container ── */

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: child,
    );
  }
}

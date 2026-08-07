import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/gradient_card.dart';
import '../../models/insight.dart';
import '../../providers/assistant_provider.dart';

class AiAssistantScreen extends ConsumerStatefulWidget {
  const AiAssistantScreen({super.key});

  @override
  ConsumerState<AiAssistantScreen> createState() =>
      _AiAssistantScreenState();
}

class _AiAssistantScreenState extends ConsumerState<AiAssistantScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  bool _isSending = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final threadId = ref.read(currentThreadIdProvider);
      if (threadId == null) {
        ref.read(chatControllerProvider.notifier).newThread();
      }
    });
  }

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _inputController.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _isSending = true;
      _inputController.clear();
    });
    await ref.read(chatControllerProvider.notifier).send(text);
    if (!mounted) return;
    setState(() => _isSending = false);
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final threadId = ref.watch(currentThreadIdProvider);
    final messages = threadId != null
        ? ref.watch(chatMessagesProvider(threadId)).valueOrNull ?? []
        : <ChatMessage>[];
    final insights = ref.watch(insightsProvider).valueOrNull ?? [];

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: const BoxDecoration(
                color: AppColors.success,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            const Text('Nebula AI'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(PhosphorIconsRegular.arrowsClockwise, size: 20),
            onPressed: () =>
                ref.read(chatControllerProvider.notifier).newThread(),
            tooltip: 'New thread',
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Insight cards strip ──────────────────────────
          if (insights.isNotEmpty)
            SizedBox(
              height: 96,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 8),
                itemCount: insights.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) => _InsightChip(insight: insights[i]),
              ),
            ),

          // ── Messages ─────────────────────────────────────
          Expanded(
            child: messages.isEmpty
                ? _EmptyConversation(onPrompt: _sendPrompt)
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 12),
                    itemCount: messages.length,
                    itemBuilder: (_, i) {
                      final m = messages[i];
                      return _ChatBubble(message: m)
                          .animate()
                          .fadeIn(duration: 250.ms);
                    },
                  ),
          ),

          // ── Input ────────────────────────────────────────
          _Composer(
            controller: _inputController,
            isSending: _isSending,
            onSend: _send,
          ),
        ],
      ),
    );
  }

  void _sendPrompt(String prompt) {
    _inputController.text = prompt;
    _send();
  }
}

class _EmptyConversation extends StatelessWidget {
  const _EmptyConversation({required this.onPrompt});
  final void Function(String) onPrompt;

  @override
  Widget build(BuildContext context) {
    final prompts = [
      ('What deals are at risk this week?', PhosphorIconsRegular.warning),
      ('Summarize my last call with Acme Corp', PhosphorIconsRegular.phone),
      ('Suggest follow-ups for stalled deals', PhosphorIconsRegular.footprints),
      ('Forecast my pipeline for next quarter', PhosphorIconsRegular.chartLineUp),
    ];
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: AppColors.primaryGradient,
                shape: BoxShape.circle,
              ),
              child: const Icon(PhosphorIconsFill.sparkle,
                  color: Colors.white, size: 32),
            ),
            const SizedBox(height: 20),
            Text('How can I help?', style: context.textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(
              'Ask about your deals, contacts, or get AI-powered next-best-action recommendations.',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (text, icon) in prompts)
                  ActionChip(
                    avatar: Icon(icon, size: 16, color: AppColors.primary),
                    label: Text(text),
                    onPressed: () => onPrompt(text),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _InsightChip extends ConsumerWidget {
  const _InsightChip({required this.insight});
  final Insight insight;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final color = _colorFor(insight.type);
    return GestureDetector(
      onTap: () => _showDetail(context, ref),
      child: Container(
        width: 240,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(PhosphorIconsRegular.sparkle, size: 12, color: color),
                const SizedBox(width: 4),
                Text(
                  insight.type.label,
                  style: context.textTheme.labelSmall?.copyWith(color: color),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              insight.title,
              style: context.textTheme.labelMedium,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  Color _colorFor(InsightType t) {
    return switch (t) {
      InsightType.atRiskDeal ||
      InsightType.churnRisk ||
      InsightType.anomaly =>
        AppColors.danger,
      InsightType.upsellOpportunity ||
      InsightType.forecastAdjustment ||
      InsightType.followUpReminder =>
        AppColors.primary,
      _ => AppColors.accent,
    };
  }

  void _showDetail(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(insight.type.label, style: context.textTheme.labelMedium),
            const SizedBox(height: 8),
            Text(insight.title, style: context.textTheme.titleMedium),
            const SizedBox(height: 12),
            Text(insight.summary, style: context.textTheme.bodyMedium),
            if (insight.reasoning != null) ...[
              const SizedBox(height: 16),
              Text('Reasoning', style: context.textTheme.labelMedium),
              const SizedBox(height: 4),
              Text(insight.reasoning!,
                  style: context.textTheme.bodySmall),
            ],
            if (insight.recommendedAction != null) ...[
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () {
                  ref
                      .read(insightActionsProvider.notifier)
                      .markActedOn(insight.id);
                  Navigator.pop(context);
                },
                child: Text(insight.recommendedAction!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ChatBubble extends StatelessWidget {
  const _ChatBubble({required this.message});
  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == ChatRole.user;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment:
            isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!isUser) ...[
            Container(
              padding: const EdgeInsets.all(6),
              decoration: const BoxDecoration(
                gradient: AppColors.primaryGradient,
                shape: BoxShape.circle,
              ),
              child: const Icon(PhosphorIconsFill.sparkle,
                  color: Colors.white, size: 14),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isUser
                    ? AppColors.primary
                    : AppColors.surfaceElevated,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft:
                      isUser ? const Radius.circular(16) : Radius.zero,
                  bottomRight:
                      isUser ? Radius.zero : const Radius.circular(16),
                ),
                border: isUser
                    ? null
                    : Border.all(color: AppColors.border, width: 0.5),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    message.content.isEmpty && message.isStreaming
                        ? 'Thinking…'
                        : message.content,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: isUser ? Colors.white : AppColors.textPrimary,
                    ),
                  ),
                  if (message.citations.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 4,
                      children: [
                        for (final c in message.citations)
                          Chip(
                            label: Text(c, style: const TextStyle(fontSize: 10)),
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.isSending,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool isSending;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(
            top: BorderSide(color: AppColors.border, width: 0.5),
          ),
        ),
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
        child: Row(
          children: [
            IconButton(
              icon: const Icon(PhosphorIconsRegular.paperclip, size: 20),
              onPressed: () {},
            ),
            Expanded(
              child: TextField(
                controller: controller,
                decoration: InputDecoration(
                  hintText: 'Ask Nebula AI…',
                  isDense: true,
                  filled: true,
                  fillColor: AppColors.surfaceElevated,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => onSend(),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              icon: isSending
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(PhosphorIconsFill.paperPlaneTilt, size: 18),
              onPressed: isSending ? null : onSend,
            ),
          ],
        ),
      ),
    );
  }
}

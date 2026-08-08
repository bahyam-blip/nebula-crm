import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/services/ai_compose_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../providers/monitor_provider.dart';

/// What needs attention right now, and why.
class MonitorScreen extends ConsumerStatefulWidget {
  const MonitorScreen({super.key});

  @override
  ConsumerState<MonitorScreen> createState() => _MonitorScreenState();
}

class _MonitorScreenState extends ConsumerState<MonitorScreen> {
  String _advice = '';
  bool _busy = false;

  Color _colour(SignalLevel l) {
    switch (l) {
      case SignalLevel.critical:
        return AppColors.danger;
      case SignalLevel.warning:
        return AppColors.warning;
      case SignalLevel.info:
        return AppColors.info;
      case SignalLevel.good:
        return AppColors.success;
    }
  }

  IconData _icon(SignalLevel l) {
    switch (l) {
      case SignalLevel.critical:
        return Icons.error_outline;
      case SignalLevel.warning:
        return Icons.warning_amber;
      case SignalLevel.info:
        return Icons.info_outline;
      case SignalLevel.good:
        return Icons.check_circle_outline;
    }
  }

  Future<void> _askAi() async {
    setState(() => _busy = true);
    try {
      final text = await ref.read(aiComposeServiceProvider).run(
            task: AiTask.followUp,
            data: ref.read(monitorSummaryProvider),
            brief: 'Given these signals, tell me the three things to do '
                'first today and why, in one line each.',
          );
      if (mounted) setState(() => _advice = text);
    } catch (e) {
      if (mounted) setState(() => _advice = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final signals = ref.watch(monitorSignalsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('What needs attention')),
      body: signals.isEmpty
          ? const EmptyState(
              icon: Icons.verified,
              title: 'Nothing needs attention',
              subtitle: 'No overdue callbacks, stale leads or late tasks.',
            )
          : ListView(
              padding: const EdgeInsets.all(12),
              children: [
                ...signals.map((s) => Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceElevated,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: s.level == SignalLevel.critical
                              ? AppColors.danger
                              : AppColors.border,
                        ),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(_icon(s.level),
                              size: 18, color: _colour(s.level)),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(s.title,
                                    style: context.textTheme.bodyMedium),
                                Text(s.detail,
                                    style: context.textTheme.bodySmall
                                        ?.copyWith(
                                            color: AppColors.textTertiary)),
                              ],
                            ),
                          ),
                          if (s.route != null)
                            TextButton(
                              onPressed: () => context.push(s.route!),
                              child: Text(s.action ?? 'Open'),
                            ),
                        ],
                      ),
                    )),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _askAi,
                  icon: _busy
                      ? const SizedBox(
                          height: 14,
                          width: 14,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.auto_awesome, size: 16),
                  label: const Text('What should I do first?'),
                ),
                if (_advice.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceElevated,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: SelectableText(_advice,
                        style: context.textTheme.bodyMedium),
                  ),
                ],
                const SizedBox(height: 30),
              ],
            ),
    );
  }
}

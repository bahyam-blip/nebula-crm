import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/validators.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../models/campaign.dart';

class CampaignBuilderScreen extends ConsumerStatefulWidget {
  const CampaignBuilderScreen({super.key});

  @override
  ConsumerState<CampaignBuilderScreen> createState() =>
      _CampaignBuilderScreenState();
}

class _CampaignBuilderScreenState extends ConsumerState<CampaignBuilderScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _subject = TextEditingController();
  final _previewText = TextEditingController();
  final _ctaLabel = TextEditingController();
  final _ctaUrl = TextEditingController();

  CampaignChannel _channel = CampaignChannel.email;
  String _scheduleType = 'manual';
  DateTime? _scheduledAt;
  bool _isLoading = false;
  final List<DripStep> _dripSteps = [];

  @override
  void dispose() {
    _name.dispose();
    _subject.dispose();
    _previewText.dispose();
    _ctaLabel.dispose();
    _ctaUrl.dispose();
    super.dispose();
  }

  Future<void> _save({String? status}) async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);

    final user = ref.read(currentAppUserValueProvider);
    final db = ref.read(firestoreServiceProvider);

    final campaign = Campaign(
      id: '',
      name: _name.text.trim(),
      channel: _channel,
      status: status ?? 'draft',
      ownerId: user?.id,
      teamId: user?.teamId,
      subject: _subject.text.trim(),
      previewText: _previewText.text.trim().isEmpty ? null : _previewText.text.trim(),
      ctaLabel: _ctaLabel.text.trim().isEmpty ? null : _ctaLabel.text.trim(),
      ctaUrl: _ctaUrl.text.trim().isEmpty ? null : _ctaUrl.text.trim(),
      dripSequence: _dripSteps,
      scheduleType: _scheduleType,
      scheduledAt: _scheduledAt,
    );

    try {
      await db.createCampaign(campaign);
      if (!mounted) return;
      context.showSuccess('Campaign created');
      context.pop();
    } catch (e) {
      if (!mounted) return;
      context.showError('Failed: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.pop(),
        ),
        title: const Text('New Campaign'),
        actions: [
          TextButton(
            onPressed: _isLoading ? null : () => _save(status: 'draft'),
            child: const Text('Save draft'),
          ),
          const SizedBox(width: 4),
          FilledButton(
            onPressed: _isLoading ? null : () => _save(status: 'scheduled'),
            child: const Text('Schedule'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // ── Channel ──────────────────────────────────
            Text('Channel', style: context.textTheme.labelMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                for (final c in CampaignChannel.values)
                  ChoiceChip(
                    label: Text(c.name.toUpperCase()),
                    selected: _channel == c,
                    onSelected: (_) => setState(() => _channel = c),
                  ),
              ],
            ),
            const SizedBox(height: 24),

            TextFormField(
              controller: _name,
              decoration: const InputDecoration(
                labelText: 'Campaign name *',
                prefixIcon: Icon(Icons.label, size: 18),
              ),
              validator: (v) =>
                  v == null || v.trim().isEmpty ? 'Required' : null,
            ),
            const SizedBox(height: 12),

            if (_channel == CampaignChannel.email) ...[
              TextFormField(
                controller: _subject,
                decoration: const InputDecoration(
                  labelText: 'Subject line *',
                  prefixIcon: Icon(Icons.text_fields, size: 18),
                ),
                validator: (v) =>
                    v == null || v.trim().isEmpty ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _previewText,
                decoration: const InputDecoration(
                  labelText: 'Preview text',
                  helperText: 'Shows in inbox preview after subject',
                ),
                maxLength: 100,
              ),
              const SizedBox(height: 12),
            ],

            // ── CTA ───────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _ctaLabel,
                    decoration: const InputDecoration(
                      labelText: 'CTA label',
                      hintText: 'Get started',
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: TextFormField(
                    controller: _ctaUrl,
                    decoration: const InputDecoration(
                      labelText: 'CTA URL',
                      hintText: 'https://...',
                    ),
                    keyboardType: TextInputType.url,
                    validator: (v) =>
                        v == null || v.isEmpty ? null : Validators.url(v),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // ── Schedule ──────────────────────────────────
            Text('Schedule', style: context.textTheme.labelMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                for (final s in const ['manual', 'once', 'recurring'])
                  ChoiceChip(
                    label: Text(s.titleCase()),
                    selected: _scheduleType == s,
                    onSelected: (_) => setState(() => _scheduleType = s),
                  ),
              ],
            ),
            if (_scheduleType != 'manual') ...[
              const SizedBox(height: 12),
              InkWell(
                onTap: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: DateTime.now().add(const Duration(days: 1)),
                    firstDate: DateTime.now(),
                    lastDate: DateTime.now().add(const Duration(days: 365)),
                  );
                  if (picked != null) {
                    final time = await showTimePicker(
                      context: context,
                      initialTime: TimeOfDay.now(),
                    );
                    if (time != null) {
                      setState(() {
                        _scheduledAt = DateTime(
                          picked.year,
                          picked.month,
                          picked.day,
                          time.hour,
                          time.minute,
                        );
                      });
                    }
                  }
                },
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Scheduled for',
                    prefixIcon: Icon(Icons.calendar_today, size: 18),
                  ),
                  child: Text(_scheduledAt?.toString() ?? 'Pick date & time'),
                ),
              ),
            ],
            const SizedBox(height: 24),

            // ── Drip sequence ─────────────────────────────
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Drip Sequence', style: context.textTheme.labelMedium),
                TextButton.icon(
                  onPressed: _addDripStep,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Add step'),
                ),
              ],
            ),
            if (_dripSteps.isEmpty)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.info),
                  title: const Text('No drip steps'),
                  subtitle: const Text(
                      'Add automated follow-ups to nurture leads over time.'),
                ),
              )
            else
              ...[
                for (var i = 0; i < _dripSteps.length; i++)
                  Card(
                    child: ListTile(
                      leading: CircleAvatar(child: Text('${i + 1}')),
                      title: Text(_dripSteps[i].subject),
                      subtitle: Text('+${_dripSteps[i].delayHours}h'),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete, size: 18),
                        onPressed: () => setState(() => _dripSteps.removeAt(i)),
                      ),
                    ),
                  ),
              ],
          ],
        ),
      ),
    );
  }

  void _addDripStep() {
    final subjectController = TextEditingController();
    var delayHours = 24;

    showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (_, setDialogState) => AlertDialog(
          title: const Text('New Drip Step'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: subjectController,
                decoration: const InputDecoration(labelText: 'Subject'),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Text('Delay (hours):'),
                  Expanded(
                    child: Slider(
                      value: delayHours.toDouble(),
                      min: 1,
                      max: 168,
                      divisions: 24,
                      label: '${delayHours}h',
                      onChanged: (v) => setDialogState(
                          () => delayHours = v.round()),
                    ),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (subjectController.text.trim().isEmpty) return;
                setState(() {
                  _dripSteps.add(DripStep(
                    id: DateTime.now().millisecondsSinceEpoch.toString(),
                    delayHours: delayHours,
                    subject: subjectController.text.trim(),
                  ));
                });
                Navigator.pop(dialogContext);
              },
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
  }
}

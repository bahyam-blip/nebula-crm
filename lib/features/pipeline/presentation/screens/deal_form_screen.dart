import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/formatters.dart';
import '../../../../core/utils/validators.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../../contacts/providers/contact_provider.dart';
import '../../models/deal.dart';

class DealFormScreen extends ConsumerStatefulWidget {
  const DealFormScreen({super.key});

  @override
  ConsumerState<DealFormScreen> createState() => _DealFormScreenState();
}

class _DealFormScreenState extends ConsumerState<DealFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _value = TextEditingController();
  final _nextStep = TextEditingController();
  final _notes = TextEditingController();

  String _stage = 'lead';
  DateTime? _expectedCloseDate;
  String? _contactId;
  String? _contactName;
  bool _isLoading = false;
  String? _editingId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final state = GoRouterState.of(context);
      final id = state.uri.queryParameters['id'];
      final presetContactId = state.uri.queryParameters['contactId'];
      if (id != null) {
        _loadDeal(id);
      } else if (presetContactId != null) {
        _loadContactPreset(presetContactId);
      }
    });
  }

  Future<void> _loadDeal(String id) async {
    final db = ref.read(firestoreServiceProvider);
    final d = await db.getDeal(id);
    if (d != null && mounted) {
      setState(() {
        _editingId = d.id;
        _title.text = d.title;
        _value.text = d.value.toStringAsFixed(0);
        _stage = d.stage;
        _expectedCloseDate = d.expectedCloseDate;
        _nextStep.text = d.nextStep ?? '';
        _notes.text = d.notes ?? '';
        _contactId = d.contactId;
        _contactName = d.contactName;
      });
    }
  }

  Future<void> _loadContactPreset(String contactId) async {
    final db = ref.read(firestoreServiceProvider);
    final c = await db.getContact(contactId);
    if (c != null && mounted) {
      setState(() {
        _contactId = c.id;
        _contactName = c.name;
        _title.text = _title.text.isEmpty ? '${c.company ?? c.name} deal' : _title.text;
      });
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _value.dispose();
    _nextStep.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _expectedCloseDate ?? DateTime.now().add(const Duration(days: 30)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
    );
    if (picked != null) setState(() => _expectedCloseDate = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);

    final user = ref.read(currentAppUserValueProvider);
    final db = ref.read(firestoreServiceProvider);

    final deal = Deal(
      id: _editingId ?? '',
      title: _title.text.trim(),
      value: num.parse(_value.text.replaceAll(RegExp(r'[^\d.]'), '')).toDouble(),
      stage: _stage,
      ownerId: user?.id ?? '',
      teamId: user?.teamId,
      contactId: _contactId,
      contactName: _contactName,
      company: _contactName,
      probability: AppConstants.stageProbabilities[_stage],
      expectedCloseDate: _expectedCloseDate,
      nextStep: _nextStep.text.trim().isEmpty ? null : _nextStep.text.trim(),
      notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      createdAt: DateTime.now(),
    );

    try {
      if (_editingId != null) {
        await db.updateDeal(deal);
      } else {
        await db.createDeal(deal);
      }
      if (!mounted) return;
      context.showSuccess(_editingId != null ? 'Deal updated' : 'Deal created');
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
        title: Text(_editingId != null ? 'Edit Deal' : 'New Deal'),
        actions: [
          TextButton(
            onPressed: _isLoading ? null : _save,
            child: const Text('Save'),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // ── Title ──────────────────────────────────────
            TextFormField(
              controller: _title,
              decoration: const InputDecoration(
                labelText: 'Deal title *',
                prefixIcon: Icon(Icons.text_fields, size: 18),
              ),
              validator: (v) =>
                  v == null || v.trim().isEmpty ? 'Required' : null,
            ),
            const SizedBox(height: 12),

            // ── Value ──────────────────────────────────────
            TextFormField(
              controller: _value,
              decoration: const InputDecoration(
                labelText: 'Deal value *',
                prefixText: '\$ ',
                prefixIcon: Icon(Icons.attach_money, size: 18),
              ),
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              validator: Validators.currencyValue,
            ),
            const SizedBox(height: 24),

            // ── Stage ──────────────────────────────────────
            Text('Stage', style: context.textTheme.labelMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final s in AppConstants.pipelineStages)
                  ChoiceChip(
                    label: Text(AppConstants.stageLabels[s] ?? s),
                    selected: _stage == s,
                    onSelected: (_) => setState(() => _stage = s),
                  ),
              ],
            ),
            const SizedBox(height: 24),

            // ── Expected close date ────────────────────────
            InkWell(
              onTap: _pickDate,
              borderRadius: BorderRadius.circular(12),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Expected close date',
                  prefixIcon:
                      Icon(Icons.calendar_today, size: 18),
                ),
                child: Text(
                  _expectedCloseDate != null
                      ? Formatters.date(_expectedCloseDate!)
                      : 'Select date',
                  style: TextStyle(
                    color: _expectedCloseDate != null
                        ? AppColors.textPrimary
                        : AppColors.textTertiary,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),

            // ── Contact link ───────────────────────────────
            if (_contactName != null)
              Card(
                child: ListTile(
                  leading: const CircleAvatar(
                    child: Icon(Icons.person, size: 18),
                  ),
                  title: Text(_contactName!),
                  subtitle: const Text('Linked contact'),
                  trailing: IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => setState(() {
                      _contactId = null;
                      _contactName = null;
                    }),
                  ),
                ),
              ),

            const SizedBox(height: 12),
            TextFormField(
              controller: _nextStep,
              decoration: const InputDecoration(
                labelText: 'Next step',
                prefixIcon: Icon(Icons.directions_walk, size: 18),
              ),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _notes,
              decoration: const InputDecoration(
                labelText: 'Notes',
                alignLabelWithHint: true,
              ),
              maxLines: 4,
            ),
            const SizedBox(height: 32),
            FilledButton(
              onPressed: _isLoading ? null : _save,
              child: _isLoading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : Text(_editingId != null ? 'Update Deal' : 'Create Deal'),
            ),
          ],
        ),
      ),
    );
  }
}

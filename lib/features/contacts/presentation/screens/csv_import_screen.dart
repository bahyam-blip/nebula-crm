import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/firebase_boot.dart';
import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../auth/models/app_user.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../services/csv_import_service.dart';

/// Every user on the current user's team, for choosing who gets the leads.
final teamCallersProvider = StreamProvider<List<AppUser>>((ref) async* {
  final me = ref.watch(currentAppUserValueProvider);
  if (me == null || me.teamId == null) {
    yield const [];
    return;
  }
  final db = ref.watch(firestoreProvider);
  yield* db
      .collection('users')
      .where('teamId', isEqualTo: me.teamId)
      .snapshots()
      .map((s) => s.docs.map(AppUser.fromFirestore).toList());
});

class CsvImportScreen extends ConsumerStatefulWidget {
  const CsvImportScreen({super.key});

  @override
  ConsumerState<CsvImportScreen> createState() => _CsvImportScreenState();
}

class _CsvImportScreenState extends ConsumerState<CsvImportScreen> {
  final _pasteController = TextEditingController();

  CsvParseResult? _parsed;
  String? _fileName;
  final Set<String> _selectedCallers = {};
  bool _skipDuplicates = true;
  bool _importing = false;
  ImportSummary? _summary;

  @override
  void dispose() {
    _pasteController.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['csv', 'txt'],
        withData: true,
      );
      if (result == null || result.files.isEmpty) return;

      final file = result.files.first;
      final bytes = file.bytes;
      if (bytes == null) {
        if (mounted) context.showError('Could not read that file.');
        return;
      }
      // Fall back to latin1 if the file is not valid UTF-8.
      String text;
      try {
        text = utf8.decode(bytes);
      } catch (_) {
        text = latin1.decode(bytes);
      }
      setState(() {
        _fileName = file.name;
        _parsed = CsvImportService.parse(text);
        _summary = null;
      });
    } catch (e) {
      if (mounted) context.showError('Could not open file: $e');
    }
  }

  void _parsePasted() {
    final text = _pasteController.text.trim();
    if (text.isEmpty) {
      context.showError('Paste some CSV text first.');
      return;
    }
    setState(() {
      _fileName = 'Pasted data';
      _parsed = CsvImportService.parse(text);
      _summary = null;
    });
  }

  Future<void> _runImport() async {
    final parsed = _parsed;
    final me = ref.read(currentAppUserValueProvider);
    if (parsed == null || me == null) return;

    if (me.teamId == null) {
      context.showError('You must belong to a team before importing.');
      return;
    }
    if (parsed.validRows.isEmpty) {
      context.showError('No valid rows to import.');
      return;
    }

    setState(() => _importing = true);
    try {
      final service = CsvImportService(ref.read(firestoreProvider));
      final summary = await withFirestoreRetry(
        () => service.import(
          rows: parsed.validRows,
          teamId: me.teamId!,
          importedBy: me.id,
          assigneeIds: _selectedCallers.toList(),
          skipDuplicates: _skipDuplicates,
        ),
      );
      if (!mounted) return;
      setState(() => _summary = summary);
      context.showSuccess(summary.headline);
    } catch (e) {
      if (mounted) context.showError(describeFirestoreError(e));
    } finally {
      if (mounted) setState(() => _importing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(currentAppUserValueProvider);
    final canImport = me?.role.canManageTeam ?? false;
    final parsed = _parsed;

    return Scaffold(
      appBar: AppBar(title: const Text('Import contacts')),
      body: !canImport
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  'Only admins and managers can import contacts.',
                  textAlign: TextAlign.center,
                ),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _sourceCard(),
                const SizedBox(height: 16),
                if (parsed != null) ...[
                  _summaryCard(parsed),
                  const SizedBox(height: 16),
                  _assignmentCard(),
                  const SizedBox(height: 16),
                  _previewCard(parsed),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _importing ? null : _runImport,
                    child: _importing
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text('Import ${parsed.validRows.length} contacts'),
                  ),
                ],
                if (_summary != null) ...[
                  const SizedBox(height: 16),
                  _resultCard(_summary!),
                ],
                const SizedBox(height: 40),
              ],
            ),
    );
  }

  Widget _card({required String title, required Widget child}) => Container(
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

  Widget _sourceCard() => _card(
        title: 'Choose a source',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Your CSV needs a header row. We look for columns named '
              'name, email, phone, company, title, city and notes — '
              'extra columns are ignored.',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _pickFile,
              icon: const Icon(Icons.upload_file, size: 18),
              label: const Text('Choose CSV file'),
            ),
            const SizedBox(height: 16),
            Text('or paste rows directly',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textTertiary)),
            const SizedBox(height: 8),
            TextField(
              controller: _pasteController,
              maxLines: 5,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              decoration: const InputDecoration(
                hintText: 'name,phone,email\nAsha Rao,9876543210,asha@acme.in',
              ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _parsePasted,
              child: const Text('Parse pasted text'),
            ),
            if (_fileName != null) ...[
              const SizedBox(height: 8),
              Text('Loaded: $_fileName',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.accent)),
            ],
          ],
        ),
      );

  Widget _summaryCard(CsvParseResult parsed) {
    final bad = parsed.invalidRows.length;
    final mapping = parsed.mapping.describe(parsed.headers);
    return _card(
      title: 'Parsed ${parsed.rows.length} rows',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Surfacing the mapping makes a wrong guess obvious immediately
          // instead of showing a pile of identical row errors.
          if (mapping.isNotEmpty) ...[
            Text('Detected columns',
                style: context.textTheme.labelMedium
                    ?.copyWith(color: AppColors.textTertiary)),
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: mapping
                  .map((m) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceHigh,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(m,
                            style: context.textTheme.bodySmall
                                ?.copyWith(fontSize: 11)),
                      ))
                  .toList(),
            ),
            const SizedBox(height: 12),
          ],
          Row(
            children: [
              _stat('Ready', parsed.validRows.length, AppColors.success),
              const SizedBox(width: 24),
              _stat('Problems', bad,
                  bad == 0 ? AppColors.textTertiary : AppColors.warning),
            ],
          ),
          if (bad > 0) ...[
            const SizedBox(height: 12),
            ...parsed.invalidRows.take(5).map(
                  (r) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      'Line ${r.lineNumber}: ${r.error}',
                      style: context.textTheme.bodySmall
                          ?.copyWith(color: AppColors.warning),
                    ),
                  ),
                ),
            if (bad > 5)
              Text('…and ${bad - 5} more',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.textTertiary)),
            const SizedBox(height: 8),
            Text('Rows with problems are skipped, not imported.',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary)),
          ],
          const SizedBox(height: 12),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _skipDuplicates,
            onChanged: (v) => setState(() => _skipDuplicates = v),
            title: const Text('Skip duplicates'),
            subtitle: Text(
              'Matches existing contacts on phone or email',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textTertiary),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, int value, Color color) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$value',
              style: context.textTheme.headlineSmall?.copyWith(color: color)),
          Text(label,
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textTertiary)),
        ],
      );

  Widget _assignmentCard() {
    final callers = ref.watch(teamCallersProvider);
    return _card(
      title: 'Distribute to',
      child: callers.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: LinearProgressIndicator(),
        ),
        error: (e, _) => Text(describeFirestoreError(e),
            style: context.textTheme.bodySmall
                ?.copyWith(color: AppColors.danger)),
        data: (users) {
          if (users.isEmpty) {
            return Text('No teammates found. Leads will stay unassigned.',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary));
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Selected people receive leads in equal turn (round robin). '
                'Leave empty to import unassigned.',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: users.map((u) {
                  final selected = _selectedCallers.contains(u.id);
                  return FilterChip(
                    selected: selected,
                    label: Text('${u.displayName} · ${u.role.shortLabel}'),
                    onSelected: (on) => setState(() {
                      if (on) {
                        _selectedCallers.add(u.id);
                      } else {
                        _selectedCallers.remove(u.id);
                      }
                    }),
                  );
                }).toList(),
              ),
              if (_selectedCallers.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  'Each of the ${_selectedCallers.length} selected will get '
                  'about ${(_parsed!.validRows.length / _selectedCallers.length).ceil()} leads.',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.accent),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _previewCard(CsvParseResult parsed) {
    final preview = parsed.validRows.take(5).toList();
    return _card(
      title: 'Preview',
      child: Column(
        children: preview
            .map(
              (r) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: Text(r.name ?? '—',
                          overflow: TextOverflow.ellipsis,
                          style: context.textTheme.bodyMedium),
                    ),
                    Expanded(
                      flex: 3,
                      child: Text(r.phone ?? r.email ?? '—',
                          overflow: TextOverflow.ellipsis,
                          style: context.textTheme.bodySmall
                              ?.copyWith(color: AppColors.textSecondary)),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
      ),
    );
  }

  Widget _resultCard(ImportSummary s) => _card(
        title: s.headline,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (s.created > 0)
              Text('${s.created} created',
                  style: context.textTheme.bodyMedium
                      ?.copyWith(color: AppColors.success)),
            // Each skip reason is listed separately: "already in your CRM"
            // and "repeated in the file" call for different responses.
            if (s.duplicatesExisting > 0)
              Text('${s.duplicatesExisting} already in your CRM',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.textSecondary)),
            if (s.duplicatesInFile > 0)
              Text('${s.duplicatesInFile} repeated inside the file',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.textSecondary)),
            if (s.invalid > 0)
              Text('${s.invalid} had no phone or email',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.warning)),
            if (s.assignedTo > 0)
              Text('Shared across ${s.assignedTo} '
                  'teammate${s.assignedTo == 1 ? '' : 's'}',
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.textSecondary)),
            const SizedBox(height: 10),
            if (s.created > 0)
              FilledButton.icon(
                onPressed: () => context.go('/contacts'),
                icon: const Icon(Icons.arrow_forward, size: 16),
                label: const Text('View contacts'),
              )
            else if (s.duplicatesExisting > 0)
              Text(
                'Turn off "Skip duplicates" to import them again as new '
                'records.',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textTertiary),
              ),
          ],
        ),
      );
}

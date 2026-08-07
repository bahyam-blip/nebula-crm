import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/services/firestore_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/utils/validators.dart';
import '../../../auth/providers/auth_provider.dart';
import '../../models/contact.dart';

/// Contact form — handles both create and edit.
class ContactFormScreen extends ConsumerStatefulWidget {
  const ContactFormScreen({super.key});

  @override
  ConsumerState<ContactFormScreen> createState() => _ContactFormScreenState();
}

class _ContactFormScreenState extends ConsumerState<ContactFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _company = TextEditingController();
  final _jobTitle = TextEditingController();
  final _linkedin = TextEditingController();
  final _website = TextEditingController();
  final _address = TextEditingController();
  final _notes = TextEditingController();
  final _tags = TextEditingController();

  ContactStatus _status = ContactStatus.lead;
  bool _isLoading = false;
  String? _editingId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final id = GoRouterState.of(context).uri.queryParameters['id'];
      if (id != null) _loadContact(id);
    });
  }

  Future<void> _loadContact(String id) async {
    final db = ref.read(firestoreServiceProvider);
    final c = await db.getContact(id);
    if (c != null && mounted) {
      setState(() {
        _editingId = c.id;
        _name.text = c.name;
        _email.text = c.email ?? '';
        _phone.text = c.phone ?? '';
        _company.text = c.company ?? '';
        _jobTitle.text = c.jobTitle ?? '';
        _linkedin.text = c.linkedin ?? '';
        _website.text = c.website ?? '';
        _address.text = c.address ?? '';
        _notes.text = c.notes ?? '';
        _tags.text = c.tags.join(', ');
        _status = c.status;
      });
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _company.dispose();
    _jobTitle.dispose();
    _linkedin.dispose();
    _website.dispose();
    _address.dispose();
    _notes.dispose();
    _tags.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);

    final user = ref.read(currentAppUserValueProvider);
    final db = ref.read(firestoreServiceProvider);

    final tagsList = _tags.text
        .split(',')
        .map((t) => t.trim())
        .where((t) => t.isNotEmpty)
        .toList();

    final contact = Contact(
      id: _editingId ?? '',
      name: _name.text.trim(),
      email: _email.text.trim().isEmpty ? null : _email.text.trim(),
      phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
      company: _company.text.trim().isEmpty ? null : _company.text.trim(),
      jobTitle: _jobTitle.text.trim().isEmpty ? null : _jobTitle.text.trim(),
      linkedin: _linkedin.text.trim().isEmpty ? null : _linkedin.text.trim(),
      website: _website.text.trim().isEmpty ? null : _website.text.trim(),
      address: _address.text.trim().isEmpty ? null : _address.text.trim(),
      notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      tags: tagsList,
      status: _status,
      ownerId: user?.id,
      teamId: user?.teamId,
      createdAt: DateTime.now(),
      lastActivityAt: DateTime.now(),
    );

    try {
      if (_editingId != null) {
        await db.updateContact(contact);
      } else {
        await db.createContact(contact);
      }
      if (!mounted) return;
      context.showSuccess(_editingId != null
          ? 'Contact updated'
          : 'Contact created');
      context.pop();
    } catch (e) {
      if (!mounted) return;
      context.showError('Failed to save: $e');
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
        title: Text(_editingId != null ? 'Edit Contact' : 'New Contact'),
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
            // ── Status picker ─────────────────────────────────
            Text('Status', style: context.textTheme.labelMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                for (final s in ContactStatus.values)
                  ChoiceChip(
                    label: Text(s.name.toUpperCase()),
                    selected: _status == s,
                    onSelected: (_) => setState(() => _status = s),
                  ),
              ],
            ),
            const SizedBox(height: 24),

            _SectionLabel('Basic Info'),
            TextFormField(
              controller: _name,
              decoration: const InputDecoration(
                labelText: 'Full name *',
                prefixIcon: Icon(Icons.person, size: 18),
              ),
              textCapitalization: TextCapitalization.words,
              validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _email,
              decoration: const InputDecoration(
                labelText: 'Email',
                prefixIcon: Icon(Icons.email, size: 18),
              ),
              keyboardType: TextInputType.emailAddress,
              validator: (v) =>
                  v == null || v.isEmpty ? null : Validators.email(v),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phone,
              decoration: const InputDecoration(
                labelText: 'Phone',
                prefixIcon: Icon(Icons.phone, size: 18),
              ),
              keyboardType: TextInputType.phone,
              validator: (v) =>
                  v == null || v.isEmpty ? null : Validators.phone(v),
            ),

            const SizedBox(height: 24),
            _SectionLabel('Company'),
            TextFormField(
              controller: _company,
              decoration: const InputDecoration(
                labelText: 'Company',
                prefixIcon: Icon(Icons.apartment, size: 18),
              ),
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _jobTitle,
              decoration: const InputDecoration(
                labelText: 'Job title',
                prefixIcon: Icon(Icons.work, size: 18),
              ),
              textCapitalization: TextCapitalization.words,
            ),

            const SizedBox(height: 24),
            _SectionLabel('Online'),
            TextFormField(
              controller: _linkedin,
              decoration: const InputDecoration(
                labelText: 'LinkedIn URL',
                prefixIcon: Icon(Icons.business, size: 18),
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _website,
              decoration: const InputDecoration(
                labelText: 'Website',
                prefixIcon: Icon(Icons.language, size: 18),
              ),
              keyboardType: TextInputType.url,
            ),

            const SizedBox(height: 24),
            _SectionLabel('Tags & Notes'),
            TextFormField(
              controller: _tags,
              decoration: const InputDecoration(
                labelText: 'Tags (comma-separated)',
                hintText: 'vip, enterprise, partner',
                prefixIcon: Icon(Icons.label, size: 18),
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
                  : Text(_editingId != null ? 'Update Contact' : 'Create Contact'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        text,
        style: context.textTheme.labelMedium
            ?.copyWith(color: AppColors.textSecondary),
      ),
    );
  }
}

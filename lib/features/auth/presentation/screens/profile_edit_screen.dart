import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/services/firebase_boot.dart';
import '../../../../core/services/remote/data_api.dart';
import '../../../../core/services/remote/data_codec.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../models/app_user.dart';
import '../../providers/auth_provider.dart';

/// Edit your own profile.
///
/// The profile screen linked to /profile/edit but the route was never
/// registered, so tapping edit threw GoException: no routes for location.
class ProfileEditScreen extends ConsumerStatefulWidget {
  const ProfileEditScreen({super.key});

  @override
  ConsumerState<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _ProfileEditScreenState extends ConsumerState<ProfileEditScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _phone;
  bool _saving = false;
  bool _seeded = false;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController();
    _phone = TextEditingController();
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save(AppUser user) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    try {
      await withFirestoreRetry(
        () => ref.read(remoteDataServiceProvider).update('users', user.id, {
          'displayName': _name.text.trim(),
          'phone': _phone.text.trim(),
          'updatedAt': const ServerTimestamp(),
        }),
      );
      if (!mounted) return;
      context.showSuccess('Profile updated');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) context.showError(describeFirestoreError(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentAppUserValueProvider);

    if (user == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Edit profile')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    // Seed once, so typing isn't clobbered by profile stream rebuilds.
    if (!_seeded) {
      _seeded = true;
      _name.text = user.displayName;
      _phone.text = user.phone ?? '';
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Edit profile')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Full name'),
              textCapitalization: TextCapitalization.words,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Name cannot be empty'
                  : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone'),
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.surfaceElevated,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  const Icon(Icons.badge_outlined, size: 18),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '${user.email}\nRole: ${user.role.label}',
                      style: context.textTheme.bodySmall
                          ?.copyWith(color: AppColors.textSecondary),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Only a super admin can change your role or team.',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textTertiary),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _saving ? null : () => _save(user),
              child: _saving
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save changes'),
            ),
          ],
        ),
      ),
    );
  }
}

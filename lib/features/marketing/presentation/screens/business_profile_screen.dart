import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/services/storage_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/extensions.dart';
import '../../../../core/widgets/common_widgets.dart';
import '../../providers/mail_provider.dart';
import '../../services/mail_api_service.dart';

/// Business Profile — the brand every email is sent with.
///
/// The owner enters the business identity once; the AI mailer uses it for
/// everything: the From name ("Aidraft Legal" instead of the CRM's own
/// name), the template header/logo, the footer (name + address + website),
/// the signature, and the copy itself (industry, products, audience, tone,
/// offers are taught to the AI with owner authority when saved).
class BusinessProfileScreen extends ConsumerStatefulWidget {
  const BusinessProfileScreen({super.key});

  @override
  ConsumerState<BusinessProfileScreen> createState() =>
      _BusinessProfileScreenState();
}

class _BusinessProfileScreenState extends ConsumerState<BusinessProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _tagline = TextEditingController();
  final _about = TextEditingController();
  final _industry = TextEditingController();
  final _products = TextEditingController();
  final _audience = TextEditingController();
  final _toneCustom = TextEditingController();
  final _offers = TextEditingController();
  final _website = TextEditingController();
  final _ctaUrl = TextEditingController();
  final _address = TextEditingController();
  final _phone = TextEditingController();
  final _contactEmail = TextEditingController();
  final _senderName = TextEditingController();
  final _signatureName = TextEditingController();

  String _brandColor = '';
  String _tone = '';
  String _defaultStyle = '';
  String _logoUrl = '';
  bool _seeded = false;
  bool _saving = false;
  bool _uploadingLogo = false;

  static const _tonePresets = [
    'Friendly and helpful',
    'Premium and polished',
    'Confident and direct',
    'Warm and personal',
    'Bold and energetic',
  ];

  static const _colorSwatches = [
    Color(0xFF6C8CFF),
    Color(0xFF7C5CFF),
    Color(0xFF3DD8D8),
    Color(0xFF3DD9A0),
    Color(0xFFFFB547),
    Color(0xFFFF5C8A),
    Color(0xFFE0533D),
    Color(0xFF111827),
  ];

  static const _styleMeta = {
    'modern': ('Modern', 'Dark colour hero — announcements & news'),
    'classic': ('Classic', 'Clean light newsletter — trusted & readable'),
    'bold': ('Bold', 'Full-colour promo — offers & launches'),
    'minimal': ('Minimal', 'Quiet text-first — stories & notes'),
    'gradient': ('Gradient', 'Soft gradient card — tips & how-tos'),
    'editorial': ('Editorial', 'Magazine feel, serif type — thought pieces'),
    'spotlight': ('Spotlight', 'Product showcase cards — launches & features'),
  };

  @override
  void dispose() {
    for (final c in [
      _name, _tagline, _about, _industry, _products, _audience,
      _toneCustom, _offers, _website, _ctaUrl, _address, _phone,
      _contactEmail, _senderName, _signatureName,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _seed(BusinessProfile p) {
    _name.text = p.businessName;
    _tagline.text = p.tagline;
    _about.text = p.about;
    _industry.text = p.industry;
    _logoUrl = p.logoUrl;
    _products.text = p.products.join(', ');
    _audience.text = p.audience;
    _offers.text = p.offers.join(', ');
    _website.text = p.website;
    _ctaUrl.text = p.ctaUrl;
    _address.text = p.address;
    _phone.text = p.phone;
    _contactEmail.text = p.contactEmail;
    _senderName.text = p.senderName;
    _signatureName.text = p.signatureName;
    _brandColor = p.brandColor;
    _defaultStyle = p.defaultStyle;
    final presets = _tonePresets.map((t) => t.toLowerCase());
    if (p.tone.isNotEmpty) {
      if (presets.contains(p.tone.toLowerCase())) {
        _tone = _tonePresets.firstWhere((t) => t.toLowerCase() == p.tone.toLowerCase());
      } else {
        _toneCustom.text = p.tone;
      }
    }
  }

  /// Pick an image, upload it straight to R2 through the Worker and use the
  /// returned public URL as the brand logo. No URL typing — the owner picks
  /// a photo and everything else just happens.
  Future<void> _pickAndUploadLogo() async {
    if (_uploadingLogo) return;
    final picker = ImagePicker();
    XFile? file;
    try {
      file = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 88,
      );
    } catch (_) {
      _toast('Could not open the gallery.');
      return;
    }
    if (file == null) return; // user cancelled

    setState(() => _uploadingLogo = true);
    try {
      final Uint8List bytes = await file.readAsBytes();
      final ext = file.name.split('.').last.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');
      final contentType = ext == 'png'
          ? 'image/png'
          : ext == 'webp'
              ? 'image/webp'
              : 'image/jpeg';
      final uid = FirebaseAuth.instance.currentUser?.uid ?? 'anon';
      final key = 'branding/logo_${uid}_${DateTime.now().millisecondsSinceEpoch}.$ext';
      final url = await StorageService().uploadBytes(
        key: key,
        bytes: bytes,
        contentType: contentType,
      );
      if (!mounted) return;
      setState(() => _logoUrl = url);
      _toast('Logo uploaded — save the profile to apply it.');
    } catch (e) {
      _toast('Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploadingLogo = false);
    }
  }

  BusinessProfile _collect() => BusinessProfile(
        businessName: _name.text.trim(),
        tagline: _tagline.text.trim(),
        about: _about.text.trim(),
        industry: _industry.text.trim(),
        logoUrl: _logoUrl.trim(),
        brandColor: _brandColor,
        products: _products.text
            .split(',')
            .map((e) => e.trim())
            .where((e) => e.isNotEmpty)
            .toList(),
        audience: _audience.text.trim(),
        tone: (_toneCustom.text.trim().isNotEmpty ? _toneCustom.text.trim() : _tone),
        offers: _offers.text
            .split(',')
            .map((e) => e.trim())
            .where((e) => e.isNotEmpty)
            .toList(),
        website: _website.text.trim(),
        ctaUrl: _ctaUrl.text.trim(),
        address: _address.text.trim(),
        phone: _phone.text.trim(),
        contactEmail: _contactEmail.text.trim(),
        senderName: _senderName.text.trim(),
        signatureName: _signatureName.text.trim(),
        defaultStyle: _defaultStyle,
      );

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final name = _name.text.trim();
    if (name.isEmpty) {
      _toast('Please enter the business name — emails need a From identity.');
      return;
    }
    setState(() => _saving = true);
    try {
      final brand =
          await ref.read(mailApiProvider).saveBusinessProfile(_collect());
      ref.invalidate(mailBusinessProvider);
      ref.invalidate(mailMemoryProvider);
      ref.invalidate(mailStatusProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          behavior: SnackBarBehavior.floating,
          content: Text(brand.branded
              ? 'Saved — your emails now go out as “${brand.fromName}”. The AI writes for this brand too.'
              : 'Profile saved.'),
          backgroundColor: AppColors.success,
        ));
      Navigator.pop(context);
    } catch (e) {
      _toast('$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
          content: Text(msg, style: const TextStyle(color: AppColors.textPrimary)),
          behavior: SnackBarBehavior.floating));
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(mailBusinessProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        title: const Text('Business Profile'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.style_outlined, size: 18),
              label: const Text('Save'),
            ),
          ),
        ],
      ),
      body: profile.when(
        loading: () => const Center(
            child: CircularProgressIndicator(strokeWidth: 2)),
        error: (e, _) => ErrorState(
            message: '$e',
            onRetry: () => ref.invalidate(mailBusinessProvider)),
        data: (p) {
          if (!_seeded) {
            _seeded = true;
            _seed(p);
          }
          return Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 48),
              children: [
                _PreviewCard(profile: _collect()),
                const SizedBox(height: 16),
                _section(
                  title: 'Brand identity',
                  subtitle:
                      'This is the name, logo and colour your customers will see on every email.',
                  children: [
                    _logoPicker(),
                    const SizedBox(height: 4),
                    _field(_name, 'Business name *', hint: 'e.g. Aidraft Legal',
                        validator: (v) =>
                            (v == null || v.trim().isEmpty) ? 'Required — this becomes your From name' : null),
                    _field(_tagline, 'Tagline',
                        hint: 'One short line under your logo'),
                    _field(_about, 'What does your business do?',
                        hint: '1–2 sentences. The AI uses this to write for you.',
                        maxLines: 3),
                    _field(_industry, 'Industry', hint: 'e.g. Legal, Real estate, Coaching'),
                    _colorPicker(),
                  ],
                ),
                _section(
                  title: 'What the AI should know',
                  subtitle:
                      'Saved with owner authority — every campaign is planned and written for THIS business.',
                  children: [
                    _field(_products, 'Products / services',
                        hint: 'Comma separated, e.g. Contract drafting, Document review'),
                    _field(_audience, 'Your customers', hint: 'e.g. Law firms, startups, creators'),
                    _tonePicker(),
                    _field(_offers, 'Current offers / promotions',
                        hint: 'Comma separated, e.g. 20% monsoon discount, Free trial'),
                  ],
                ),
                _section(
                  title: 'Contact & footer',
                  subtitle:
                      'Shown in the email footer — builds trust and keeps you compliant.',
                  children: [
                    _field(_website, 'Website', hint: 'yourbusiness.com'),
                    _field(_ctaUrl, 'Main button link',
                        hint: 'Where the email\'s CTA opens (defaults to your website)',
                        keyboardType: TextInputType.url),
                    _field(_address, 'Address', hint: 'Street, city, PIN'),
                    _field(_phone, 'Phone', hint: '+91 …', keyboardType: TextInputType.phone),
                    _field(_contactEmail, 'Reply-to email',
                        hint: 'Replies go here', keyboardType: TextInputType.emailAddress),
                  ],
                ),
                _section(
                  title: 'Email identity',
                  subtitle: 'How your emails sign off, and the default look.',
                  children: [
                    _field(_senderName, 'From name',
                        hint: 'Defaults to the business name'),
                    _field(_signatureName, 'Signature',
                        hint: 'Defaults to “Team <business>”'),
                    _stylePicker(),
                  ],
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: const Icon(Icons.style_outlined, size: 18),
                  label: const Text('Save business profile'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  /* ── Sections & fields ─────────────────────────────────────────── */

  Widget _section({
    required String title,
    required String subtitle,
    required List<Widget> children,
  }) =>
      Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: context.textTheme.titleSmall),
            const SizedBox(height: 2),
            Text(subtitle,
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary)),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      );

  Widget _field(TextEditingController c, String label,
      {String? hint, int maxLines = 1, TextInputType? keyboardType, String? Function(String?)? validator}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: c,
        maxLines: maxLines,
        keyboardType: keyboardType,
        validator: validator,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        style: context.textTheme.bodyMedium,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
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
    );
  }

  Widget _logoPicker() {
    return Row(
      children: [
        GestureDetector(
          onTap: _pickAndUploadLogo,
          child: Stack(
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: AppColors.surfaceElevated,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.border),
                ),
                child: _logoUrl.isNotEmpty
                    ? ClipOval(
                        child: Image.network(
                          _logoUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(
                              Icons.business_outlined,
                              color: AppColors.textSecondary),
                        ),
                      )
                    : const Icon(Icons.image_outlined,
                        color: AppColors.textSecondary),
              ),
              if (_uploadingLogo)
                const Positioned.fill(
                  child: Center(
                    child: SizedBox(
                      width: 28,
                      height: 28,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                ),
              Positioned(
                right: 0,
                bottom: 0,
                child: Container(
                  width: 22,
                  height: 22,
                  decoration: const BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.edit, size: 12, color: Colors.white),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Business logo',
                  style: context.textTheme.bodyMedium),
              const SizedBox(height: 2),
              Text(
                _logoUrl.isEmpty
                    ? 'Tap to upload a square PNG/JPG from your gallery — it appears in every email header.'
                    : 'Uploaded. Tap to replace.',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary, fontSize: 11.5),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _colorPicker() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Brand colour',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final c in _colorSwatches)
                GestureDetector(
                  onTap: () => setState(() {
                    _brandColor =
                        '#${c.value.toRadixString(16).substring(2, 8)}';
                  }),
                  child: Container(
                    width: 36, height: 36,
                    decoration: BoxDecoration(
                      color: c,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: _brandColor ==
                                '#${c.value.toRadixString(16).substring(2, 8)}'
                            ? AppColors.textPrimary
                            : Colors.transparent,
                        width: 2.5,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tonePicker() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Brand voice',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6, runSpacing: 6,
            children: [
              for (final t in _tonePresets)
                ChoiceChip(
                  label: Text(t),
                  selected: _tone == t && _toneCustom.text.trim().isEmpty,
                  onSelected: (_) => setState(() {
                    _tone = t;
                    _toneCustom.clear();
                  }),
                ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _toneCustom,
            style: context.textTheme.bodyMedium,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: '…or describe your own voice',
              filled: true,
              fillColor: AppColors.surfaceElevated,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppColors.border)),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppColors.border)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stylePicker() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Default template style',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: 4),
          Text('The AI still picks the best style per email — this is the default.',
              style: context.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textTertiary, fontSize: 11)),
          const SizedBox(height: 8),
          for (final entry in _styleMeta.entries)
            RadioListTile<String>(
              value: entry.key,
              groupValue: _defaultStyle,
              dense: true,
              contentPadding: EdgeInsets.zero,
              activeColor: AppColors.primary,
              title: Text(entry.value.$1, style: context.textTheme.bodyMedium),
              subtitle: Text(entry.value.$2,
                  style: context.textTheme.bodySmall
                      ?.copyWith(color: AppColors.textSecondary, fontSize: 11.5)),
              onChanged: (v) => setState(() => _defaultStyle = v ?? ''),
            ),
        ],
      ),
    );
  }
}

/// Live "this is how your emails will look" preview.
class _PreviewCard extends StatelessWidget {
  const _PreviewCard({required this.profile});
  final BusinessProfile profile;

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
    final from = profile.effectiveSenderName.isEmpty
        ? 'Not set yet — emails still show the CRM name'
        : profile.effectiveSenderName;
    final signature = profile.effectiveSignature.isEmpty
        ? 'Team Nebula CRM'
        : profile.effectiveSignature;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [_brandColor.withValues(alpha: 0.20), AppColors.surface],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _brandColor.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.mark_email_read_outlined, size: 18, color: _brandColor),
            const SizedBox(width: 8),
            Text('Your emails will be sent as',
                style: context.textTheme.labelMedium
                    ?.copyWith(color: AppColors.textSecondary)),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            if (profile.logoUrl.isNotEmpty)
              CircleAvatar(
                radius: 18,
                backgroundImage: NetworkImage(profile.logoUrl),
                onBackgroundImageError: (_, __) {},
              )
            else
              CircleAvatar(
                radius: 18,
                backgroundColor: _brandColor,
                child: Text(
                  from.isNotEmpty ? from[0].toUpperCase() : '?',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w700),
                ),
              ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(from,
                      style: context.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  if (profile.tagline.isNotEmpty)
                    Text(profile.tagline,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.textTheme.bodySmall
                            ?.copyWith(color: AppColors.textSecondary)),
                ],
              ),
            ),
          ]),
          if (profile.effectiveSenderName.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text('Signature: $signature',
                style: context.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary)),
          ],
        ],
      ),
    );
  }
}

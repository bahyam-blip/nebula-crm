import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../models/studio_models.dart';
import '../../providers/studio_provider.dart';

/// Bottom sheet: publish a built site to a connected hosting platform, or
/// connect one first (credentials pasted once, encrypted server-side).
///
/// Also covers the domain chain: after publishing, a registrar-connected
/// user can point www.theirbrand.com at the deployed host. With [site]
/// null it becomes a platforms-management sheet (no publishing).
///
/// Watches [studioProvider] so a freshly connected platform flips to its
/// connected state (and reveals Publish) without reopening the sheet.
class PublishSheet extends ConsumerStatefulWidget {
  const PublishSheet({
    super.key,
    required this.site,
    required this.onPublish,
    required this.onConnect,
    required this.onDisconnect,
    required this.onPointDomain,
  });

  /// The site being hosted, or null for a platforms-management sheet
  /// (connect / disconnect / point domains only, no publishing).
  final StudioSite? site;

  /// Called when the user taps Publish on a platform. Return the deployment.
  /// Only invoked when [site] is set.
  final Future<SiteDeployment> Function(HostingConnector platform, String? repo, String? domain)? onPublish;

  /// Called when the user submits credentials for a platform.
  final Future<String> Function(HostingConnector platform, Map<String, String> credentials) onConnect;

  final Future<void> Function(HostingConnector platform) onDisconnect;

  /// Optional custom-domain pointing (registrar platforms).
  final Future<String> Function(HostingConnector platform, String domain, String target, String name)? onPointDomain;

  @override
  ConsumerState<PublishSheet> createState() => _PublishSheetState();
}

class _PublishSheetState extends ConsumerState<PublishSheet> {
  HostingConnector? _connecting;
  HostingConnector? _publishing;
  SiteDeployment? _result;
  bool _busy = false;
  String? _error;

  final _repoCtrl = TextEditingController();
  final _domainCtrl = TextEditingController();

  // Connect-flow controllers.
  final _tokenCtrl = TextEditingController();
  final _keyCtrl = TextEditingController();
  final _secretCtrl = TextEditingController();
  final _saCtrl = TextEditingController();
  final _sbTokenCtrl = TextEditingController();
  final _sbRefCtrl = TextEditingController();

  @override
  void dispose() {
    _repoCtrl.dispose();
    _domainCtrl.dispose();
    _tokenCtrl.dispose();
    _keyCtrl.dispose();
    _secretCtrl.dispose();
    _saCtrl.dispose();
    _sbTokenCtrl.dispose();
    _sbRefCtrl.dispose();
    super.dispose();
  }

  Map<String, String> _credentialsFor(HostingConnector p) {
    switch (p.connector) {
      case 'github':
      case 'vercel':
      case 'hostinger':
        return {'token': _tokenCtrl.text.trim()};
      case 'godaddy':
        return {'key': _keyCtrl.text.trim(), 'secret': _secretCtrl.text.trim()};
      case 'firebase':
        return {'service_account_json': _saCtrl.text.trim()};
      case 'supabase':
        return {'access_token': _sbTokenCtrl.text.trim(), 'project_ref': _sbRefCtrl.text.trim()};
      default:
        return {};
    }
  }

  bool _credsValid(HostingConnector p) {
    final creds = _credentialsFor(p);
    if (creds.isEmpty) return false;
    return creds.values.every((v) => v.trim().isNotEmpty);
  }

  String _helpUrl(HostingConnector p) {
    switch (p.connector) {
      case 'github':
        return 'https://github.com/settings/tokens';
      case 'vercel':
        return 'https://vercel.com/account/settings/tokens';
      case 'firebase':
        return 'https://console.firebase.google.com/iam-admin/serviceaccounts';
      case 'godaddy':
        return 'https://developer.godaddy.com/keys';
      case 'hostinger':
        return 'https://hpanel.hostinger.com/websites/api';
      case 'supabase':
        return 'https://supabase.com/dashboard/account/tokens';
      default:
        return '';
    }
  }

  Future<void> _doConnect(HostingConnector p) async {
    setState(() { _busy = true; _error = null; });
    try {
      final note = await widget.onConnect(p, _credentialsFor(p));
      if (!mounted) return;
      setState(() { _busy = false; _connecting = null; });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(note), backgroundColor: AppColors.success));
    } catch (e) {
      setState(() { _busy = false; _error = e.toString().replaceFirst(RegExp(r'^Exception:\s*'), ''); });
    }
  }

  Future<void> _doPublish(HostingConnector p) async {
    final publish = widget.onPublish;
    if (publish == null) return;
    setState(() { _busy = true; _error = null; });
    try {
      final dep = await publish(
        p,
        _repoCtrl.text.trim(),
        p.connector == 'github' ? _domainCtrl.text.trim() : null,
      );
      if (!mounted) return;
      setState(() { _busy = false; _publishing = null; _result = dep; });
    } catch (e) {
      setState(() { _busy = false; _error = e.toString().replaceFirst(RegExp(r'^Exception:\s*'), ''); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final platforms = ref.watch(studioProvider).connectors;
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceHigh,
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: const Icon(Icons.rocket_launch_outlined, color: AppColors.textPrimary, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    _result == null ? 'Host it everywhere' : 'Your site is live',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 20),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _result == null
                  ? 'Deploy to your own hosting platform. Connect once — after that, publishing never needs a token.'
                  : 'Open it in any browser, share the link, or point your own domain at it.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.danger.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.danger.withValues(alpha: 0.35)),
                ),
                child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13)),
              ),
            if (_result != null) ..._resultView(),
            if (_result == null && _connecting != null) ..._connectForm(_connecting!),
            if (_result == null && _publishing != null) ..._publishForm(_publishing!),
            if (_result == null && _connecting == null && _publishing == null)
              ...platforms.map(_platformTile),
          ],
        ),
      ),
    );
  }

  List<Widget> _resultView() {
    final dep = _result!;
    return [
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.success.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.success.withValues(alpha: 0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.check_circle, color: AppColors.success, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${dep.connector} deploy complete',
                    style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.w700, fontSize: 14),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            SelectableText(
              dep.url ?? '',
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w600),
            ),
            if ((dep.note ?? dep.repo) != null) ...[
              const SizedBox(height: 8),
              Text(
                dep.note ?? 'Repo: ${dep.repo}',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
                    onPressed: dep.url == null
                        ? null
                        : () => launchUrl(Uri.parse(dep.url!), mode: LaunchMode.externalApplication),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: const Text('Open site'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
      const SizedBox(height: 10),
      TextButton(
        onPressed: () => setState(() => _result = null),
        child: const Text('Publish somewhere else'),
      ),
    ];
  }

  List<Widget> _connectForm(HostingConnector p) {
    return [
      _formHeader(p, 'Connect ${p.name}'),
      if (p.connector == 'firebase')
        TextField(
          controller: _saCtrl,
          maxLines: 4,
          style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
          decoration: _input('Paste the service account JSON here'),
        )
      else if (p.connector == 'godaddy') ...[
        TextField(controller: _keyCtrl, obscureText: true, decoration: _input('API key')),
        const SizedBox(height: 10),
        TextField(controller: _secretCtrl, obscureText: true, decoration: _input('API secret')),
      ] else if (p.connector == 'supabase') ...[
        TextField(controller: _sbTokenCtrl, obscureText: true, decoration: _input('Personal access token')),
        const SizedBox(height: 10),
        TextField(controller: _sbRefCtrl, decoration: _input('Project ref (abcdefg.supabase.co → abcdefg)')),
      ] else
        TextField(
          controller: _tokenCtrl,
          obscureText: true,
          decoration: _input('${p.name} access token'),
        ),
      const SizedBox(height: 6),
      Row(
        children: [
          TextButton.icon(
            onPressed: () => launchUrl(Uri.parse(_helpUrl(p)), mode: LaunchMode.externalApplication),
            icon: const Icon(Icons.help_outline, size: 15),
            label: const Text('Where do I get this?', style: TextStyle(fontSize: 12.5)),
          ),
        ],
      ),
      const SizedBox(height: 4),
      FilledButton(
        style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
        onPressed: _busy || !_credsValid(p) ? null : () => _doConnect(p),
        child: _busy
            ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : const Text('Verify & connect'),
      ),
      TextButton(
        onPressed: _busy ? null : () => setState(() { _connecting = null; _error = null; }),
        child: const Text('Cancel'),
      ),
    ];
  }

  List<Widget> _publishForm(HostingConnector p) {
    return [
      _formHeader(p, 'Publish to ${p.name}'),
      if (p.connector == 'github') ...[
        TextField(controller: _repoCtrl, decoration: _input('Repository name (optional)')),
        const SizedBox(height: 10),
        TextField(controller: _domainCtrl, decoration: _input('Custom domain (optional, e.g. www.yourbrand.com)')),
      ] else if (p.connector == 'vercel')
        TextField(controller: _repoCtrl, decoration: _input('Project name (optional)')),
      const SizedBox(height: 6),
      Text(
        p.connector == 'firebase'
            ? 'Deploys to your Firebase project as a new Hosting site.'
            : p.connector == 'github'
                ? 'Creates a public repo, commits the site and enables GitHub Pages.'
                : 'Creates a project and deploys instantly on Vercel\'s global CDN.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
      ),
      const SizedBox(height: 12),
      FilledButton(
        style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
        onPressed: _busy ? null : () => _doPublish(p),
        child: _busy
            ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : const Text('Deploy now'),
      ),
      TextButton(
        onPressed: _busy ? null : () => setState(() { _publishing = null; _error = null; }),
        child: const Text('Back'),
      ),
    ];
  }

  Widget _formHeader(HostingConnector p, String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          const Spacer(),
          TextButton(
            onPressed: () => setState(() { _connecting = null; _publishing = null; _error = null; }),
            child: const Text('Back', style: TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }

  Widget _platformTile(HostingConnector p) {
    final color = p.connected ? AppColors.success : AppColors.textTertiary;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: p.connected ? AppColors.success.withValues(alpha: 0.35) : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _platformMark(p),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          p.name,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                        ),
                        if (p.connected) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.success.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              p.connectedLabel ?? 'connected',
                              style: const TextStyle(color: AppColors.success, fontSize: 10.5, fontWeight: FontWeight.w600),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      p.what,
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              Icon(
                p.connected ? Icons.check_circle : Icons.link,
                color: color,
                size: 18,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              if (widget.site != null && p.connected && p.canPublish)
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      minimumSize: const Size.fromHeight(38),
                    ),
                    onPressed: _busy ? null : () => setState(() { _publishing = p; }),
                    icon: const Icon(Icons.upload, size: 15),
                    label: const Text('Publish', style: TextStyle(fontSize: 13)),
                  ),
                )
              else if (p.connected && p.isRegistrar)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _showDomainPointer(p),
                    icon: const Icon(Icons.dns_outlined, size: 15),
                    label: const Text('Point domain', style: TextStyle(fontSize: 13)),
                  ),
                )
              else if (p.connected) ...[
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : () {},
                    child: const Text('Connected', style: TextStyle(fontSize: 13)),
                  ),
                ),
              ] else
                Expanded(
                  child: FilledButton.tonalIcon(
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(38)),
                    onPressed: _busy ? null : () => setState(() { _connecting = p; _tokenCtrl.clear(); _keyCtrl.clear(); _secretCtrl.clear(); _saCtrl.clear(); _sbTokenCtrl.clear(); _sbRefCtrl.clear(); }),
                    icon: const Icon(Icons.add_link, size: 15),
                    label: const Text('Connect', style: TextStyle(fontSize: 13)),
                  ),
                ),
              if (p.connected) ...[
                const SizedBox(width: 8),
                IconButton(
                  tooltip: 'Disconnect',
                  icon: Icon(Icons.link_off, size: 18, color: AppColors.textTertiary),
                  onPressed: _busy
                      ? null
                      : () async {
                          final confirmed = await _confirmDisconnect(p);
                          if (confirmed == true) await widget.onDisconnect(p);
                        },
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _showDomainPointer(HostingConnector p) async {
    final domainCtrl = TextEditingController();
    final targetCtrl = TextEditingController();
    final nameCtrl = TextEditingController(text: 'www');
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (sheetCtx) => Padding(
        padding: EdgeInsets.only(
          left: 16, right: 16, top: 16,
          bottom: MediaQuery.of(sheetCtx).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Point a ${p.name} domain', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
            const SizedBox(height: 4),
            Text(
              'Sets a CNAME record so your domain loads the deployed site. DNS can take a few minutes to an hour.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
            ),
            const SizedBox(height: 12),
            TextField(controller: domainCtrl, decoration: _input('yourbrand.com')),
            const SizedBox(height: 10),
            TextField(controller: nameCtrl, decoration: _input('Host (www, shop, app…)')),
            const SizedBox(height: 10),
            TextField(controller: targetCtrl, decoration: _input('Target host (e.g. you.github.io)')),
            const SizedBox(height: 14),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
              onPressed: () async {
                final domain = domainCtrl.text.trim();
                final target = targetCtrl.text.trim();
                final name = nameCtrl.text.trim().isEmpty ? 'www' : nameCtrl.text.trim();
                if (domain.isEmpty || target.isEmpty) return;
                Navigator.of(sheetCtx).pop();
                try {
                  final note = await widget.onPointDomain!(p, domain, target, name);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(note), backgroundColor: AppColors.success));
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: AppColors.danger));
                  }
                }
              },
              child: const Text('Set CNAME record'),
            ),
          ],
        ),
      ),
    );
  }

  Future<bool?> _confirmDisconnect(HostingConnector p) => showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Disconnect ${p.name}?'),
          content: const Text('The stored credentials are destroyed. You can connect again any time.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Disconnect'),
            ),
          ],
        ),
      );

  InputDecoration _input(String hint) => InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: AppColors.textTertiary, fontSize: 13),
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
      );

  /// Brand mark for a hosting platform — a clean two-letter monogram on
  /// a quiet slab (emoji logos read as toy-grade).
  Widget _platformMark(HostingConnector p) {
    final label = switch (p.connector) {
      'github' => 'GH',
      'vercel' => 'V',
      'firebase' => 'FB',
      'godaddy' => 'GD',
      'hostinger' => 'H',
      'supabase' => 'SB',
      _ => p.name.isNotEmpty ? p.name[0].toUpperCase() : '?',
    };
    return Container(
      width: 38,
      height: 38,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.surfaceHigh,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(
        label,
        style: const TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.4,
          color: AppColors.textPrimary,
        ),
      ),
    );
  }
}

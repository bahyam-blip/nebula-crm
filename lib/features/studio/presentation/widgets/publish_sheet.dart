import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../models/studio_models.dart';
import '../../providers/studio_provider.dart';

/// Bottom sheet: publish a built site to a connected hosting platform, or
/// connect one first (credentials pasted once, encrypted server-side).
///
/// v15 GITHUB POWER: the GitHub publish form pushes a FULL PROJECT
/// (index.html + README + CI flow files), supports private repos, and a
/// FLOWS panel triggers CI workflows (APK build, Pages deploy) on any repo
/// of the connected account with live run status.
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
    this.onGithubRepos,
    this.onGithubPush,
    this.onGithubTrigger,
    this.onGithubRuns,
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

  /// v15 GitHub power — all optional; the power panel hides when absent
  /// (an old worker without /v1/studio/github/* simply keeps the classic UI).
  final Future<List<GithubRepo>> Function()? onGithubRepos;
  final Future<SiteDeployment> Function(String artifactId, String? repo, bool isPrivate, List<String> workflows, String? domain)? onGithubPush;
  final Future<WorkflowRun?> Function(String repo, String workflow)? onGithubTrigger;
  final Future<List<WorkflowRun>> Function(String repo)? onGithubRuns;

  bool get githubPower =>
      onGithubRepos != null || onGithubPush != null || onGithubTrigger != null || onGithubRuns != null;

  @override
  ConsumerState<PublishSheet> createState() => _PublishSheetState();
}

class _PublishSheetState extends ConsumerState<PublishSheet> {
  HostingConnector? _connecting;
  HostingConnector? _publishing;
  HostingConnector? _flows;
  SiteDeployment? _result;
  bool _busy = false;
  String? _error;

  final _repoCtrl = TextEditingController();
  final _domainCtrl = TextEditingController();

  // v15 GitHub power state.
  bool _privateRepo = false;
  bool _flowPages = true;
  bool _flowApk = false;
  List<GithubRepo> _repos = const [];
  List<WorkflowRun> _runs = const [];
  WorkflowRun? _runResult;
  bool _loadingRepos = false;
  final _wfCtrl = TextEditingController(text: 'build-apk.yml');
  final _flowRepoCtrl = TextEditingController();

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
    _wfCtrl.dispose();
    _flowRepoCtrl.dispose();
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
    setState(() { _busy = true; _error = null; });
    try {
      final SiteDeployment dep;
      if (p.connector == 'github' && widget.onGithubPush != null && widget.site != null) {
        final workflows = <String>[
          if (_flowPages) 'pages',
          if (_flowApk) 'apk',
        ];
        dep = await widget.onGithubPush!(
          widget.site!.id,
          _repoCtrl.text.trim(),
          _privateRepo,
          workflows,
          _domainCtrl.text.trim().isNotEmpty ? _domainCtrl.text.trim() : null,
        );
      } else {
        final legacy = widget.onPublish;
        if (legacy == null) { setState(() { _busy = false; }); return; }
        dep = await legacy(
          p,
          _repoCtrl.text.trim(),
          p.connector == 'github' ? _domainCtrl.text.trim() : null,
        );
      }
      if (!mounted) return;
      setState(() { _busy = false; _publishing = null; _flows = null; _result = dep; });
    } catch (e) {
      setState(() { _busy = false; _error = e.toString().replaceFirst(RegExp(r'^Exception:\s*'), ''); });
    }
  }

  Future<void> _loadRepos() async {
    final load = widget.onGithubRepos;
    if (load == null) return;
    setState(() { _loadingRepos = true; });
    try {
      final repos = await load();
      if (!mounted) return;
      setState(() { _repos = repos; _loadingRepos = false; });
    } catch (_) {
      if (mounted) setState(() { _loadingRepos = false; });
    }
  }

  Future<void> _loadRuns(String repo) async {
    final load = widget.onGithubRuns;
    if (load == null) return;
    try {
      final runs = await load(repo);
      if (!mounted) return;
      setState(() { _runs = runs; });
    } catch (_) {
      if (mounted) setState(() { _runs = const []; });
    }
  }

  Future<void> _doTrigger() async {
    final trigger = widget.onGithubTrigger;
    if (trigger == null) return;
    final repo = _flowRepoCtrl.text.trim();
    final wf = _wfCtrl.text.trim();
    if (repo.isEmpty || wf.isEmpty) return;
    setState(() { _busy = true; _error = null; _runResult = null; });
    try {
      final run = await trigger(repo, wf);
      if (!mounted) return;
      setState(() { _busy = false; _runResult = run; });
      await _loadRuns(repo);
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
    final showRepoLinks = dep.repoUrl != null || dep.actionsUrl != null;
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
              dep.url ?? dep.repoUrl ?? '',
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
                if (showRepoLinks) ...[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: dep.repoUrl == null
                          ? null
                          : () => launchUrl(Uri.parse(dep.repoUrl!), mode: LaunchMode.externalApplication),
                      icon: const Icon(Icons.code, size: 16),
                      label: const Text('Repo', style: TextStyle(fontSize: 13)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: dep.actionsUrl == null
                          ? null
                          : () => launchUrl(Uri.parse(dep.actionsUrl!), mode: LaunchMode.externalApplication),
                      icon: const Icon(Icons.account_tree_outlined, size: 16),
                      label: const Text('Actions', style: TextStyle(fontSize: 13)),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
                    onPressed: dep.url == null
                        ? null
                        : () => launchUrl(Uri.parse(dep.url!), mode: LaunchMode.externalApplication),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: const Text('Open site', style: TextStyle(fontSize: 13)),
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
      if (p.connector == 'github')
        Text(
          'Use a PAT with repo + workflow scopes — that unlocks project pushes and CI flows (APK builds, deploys).',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
        ),
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
        if (widget.githubPower && widget.site != null && widget.onGithubPush != null) ...[
          const SizedBox(height: 14),
          Text('PROJECT', style: TextStyle(color: AppColors.textTertiary, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1)),
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            value: _privateRepo,
            onChanged: (v) => setState(() => _privateRepo = v),
            activeColor: AppColors.primary,
            title: const Text('Private repo', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
            subtitle: Text('Only you can see the source (applies when the repo is created)', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          ),
          const SizedBox(height: 10),
          Text('CI FLOWS TO INCLUDE', style: TextStyle(color: AppColors.textTertiary, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1)),
          const SizedBox(height: 8),
          _flowToggle(
            value: _flowPages,
            onChanged: (v) => setState(() => _flowPages = v),
            title: 'Deploy to Pages',
            subtitle: 'Commits deploy-pages.yml — every push to main redeploys; triggerable from Flows',
          ),
          const SizedBox(height: 6),
          _flowToggle(
            value: _flowApk,
            onChanged: (v) => setState(() => _flowApk = v),
            title: 'Build APK',
            subtitle: 'Commits build-apk.yml — run it on any repo with a Flutter app to get a release APK',
          ),
        ],
      ] else if (p.connector == 'vercel')
        TextField(controller: _repoCtrl, decoration: _input('Project name (optional)')),
      const SizedBox(height: 6),
      Text(
        p.connector == 'firebase'
            ? 'Deploys to your Firebase project as a new Hosting site.'
            : p.connector == 'github'
                ? 'Pushes a full project — the site, a README, and any CI flows you picked — then enables GitHub Pages.'
                : 'Creates a project and deploys instantly on Vercel\'s global CDN.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
      ),
      const SizedBox(height: 12),
      FilledButton(
        style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
        onPressed: _busy ? null : () => _doPublish(p),
        child: _busy
            ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : const Text('Push project'),
      ),
      TextButton(
        onPressed: _busy ? null : () => setState(() { _publishing = null; _error = null; }),
        child: const Text('Back'),
      ),
    ];
  }

  Widget _flowToggle({required bool value, required ValueChanged<bool> onChanged, required String title, required String subtitle}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: value ? AppColors.primary.withValues(alpha: 0.5) : AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(subtitle, style: TextStyle(color: AppColors.textSecondary, fontSize: 11.5)),
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged, activeColor: AppColors.primary),
        ],
      ),
    );
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
    final isGithub = p.connector == 'github' && p.connected && widget.githubPower;
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
              if (isGithub) ...[
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(38)),
                  onPressed: _busy ? null : () => _openFlows(p),
                  icon: const Icon(Icons.account_tree_outlined, size: 15),
                  label: const Text('Flows', style: TextStyle(fontSize: 13)),
                ),
              ],
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

  /* ══ v15 — the GitHub FLOWS panel ═══════════════════════════════ */

  void _openFlows(HostingConnector p) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (sheetCtx) => _FlowsSheet(
        onRepos: widget.onGithubRepos,
        onTrigger: widget.onGithubTrigger,
        onRuns: widget.onGithubRuns,
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

/// v15 — the GitHub CI-flows sheet: pick a repo, dispatch a workflow
/// (APK build / Pages deploy / anything), watch the run status.
class _FlowsSheet extends StatefulWidget {
  const _FlowsSheet({
    this.onRepos,
    this.onTrigger,
    this.onRuns,
  });

  final Future<List<GithubRepo>> Function()? onRepos;
  final Future<WorkflowRun?> Function(String repo, String workflow)? onTrigger;
  final Future<List<WorkflowRun>> Function(String repo)? onRuns;

  @override
  State<_FlowsSheet> createState() => _FlowsSheetState();
}

class _FlowsSheetState extends State<_FlowsSheet> {
  final _repoCtrl = TextEditingController();
  final _wfCtrl = TextEditingController(text: 'build-apk.yml');
  List<GithubRepo> _repos = const [];
  List<WorkflowRun> _runs = const [];
  WorkflowRun? _run;
  bool _loadingRepos = false;
  bool _busy = false;
  String? _error;
  String? _reposError;

  @override
  void initState() {
    super.initState();
    _loadRepos();
  }

  @override
  void dispose() {
    _repoCtrl.dispose();
    _wfCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadRepos() async {
    final load = widget.onRepos;
    if (load == null) return;
    setState(() { _loadingRepos = true; _reposError = null; });
    try {
      final repos = await load();
      if (!mounted) return;
      setState(() { _repos = repos; _loadingRepos = false; });
    } catch (e) {
      if (mounted) {
        setState(() { _loadingRepos = false; _reposError = e.toString().replaceFirst(RegExp(r'^Exception:\s*'), ''); });
      }
    }
  }

  Future<void> _loadRuns(String repo) async {
    final load = widget.onRuns;
    if (load == null) return;
    try {
      final runs = await load(repo);
      if (!mounted) return;
      setState(() { _runs = runs; });
    } catch (_) {
      if (mounted) setState(() { _runs = const []; });
    }
  }

  Future<void> _trigger() async {
    final trigger = widget.onTrigger;
    if (trigger == null) return;
    final repo = _repoCtrl.text.trim();
    final wf = _wfCtrl.text.trim();
    if (repo.isEmpty || wf.isEmpty) return;
    setState(() { _busy = true; _error = null; _run = null; });
    try {
      final run = await trigger(repo, wf);
      if (!mounted) return;
      setState(() { _busy = false; _run = run; });
      await _loadRuns(repo);
    } catch (e) {
      if (mounted) {
        setState(() { _busy = false; _error = e.toString().replaceFirst(RegExp(r'^Exception:\s*'), ''); });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.account_tree_outlined, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('GitHub flows', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                ),
                IconButton(icon: const Icon(Icons.close, size: 20), onPressed: () => Navigator.of(context).pop()),
              ],
            ),
            Text(
              'Trigger a CI workflow on any repo of your account — build an APK, deploy the site.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
            ),
            const SizedBox(height: 14),
            if (_repos.isNotEmpty) ...[
              DropdownButtonFormField<String>(
                value: _repoCtrl.text.isEmpty ? null : _repoCtrl.text,
                decoration: _input('Repository'),
                hint: const Text('Pick a repo'),
                items: _repos
                    .map((r) => DropdownMenuItem<String>(
                          value: r.fullName,
                          child: Text('${r.fullName}${r.isPrivate ? '  · private' : ''}', style: const TextStyle(fontSize: 13), overflow: TextOverflow.ellipsis),
                        ))
                    .toList(),
                onChanged: (v) {
                  setState(() => _repoCtrl.text = v ?? '');
                  if ((v ?? '').isNotEmpty) _loadRuns(v!);
                },
              ),
              TextButton(
                onPressed: _loadingRepos ? null : _loadRepos,
                child: Text(_loadingRepos ? 'Loading repos…' : 'Refresh repos', style: const TextStyle(fontSize: 12)),
              ),
            ] else ...[
              TextField(controller: _repoCtrl, decoration: _input('Repository (owner/name, e.g. you/my-app)')),
              if (_reposError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(_reposError!, style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5)),
                ),
            ],
            const SizedBox(height: 10),
            TextField(controller: _wfCtrl, decoration: _input('Workflow file (e.g. build-apk.yml)')),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                for (final wf in const ['build-apk.yml', 'deploy-pages.yml'])
                  ActionChip(
                    label: Text(wf, style: const TextStyle(fontSize: 12)),
                    onPressed: () => setState(() => _wfCtrl.text = wf),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
              onPressed: _busy ? null : _trigger,
              icon: _busy
                  ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.play_arrow, size: 18),
              label: const Text('Run workflow'),
            ),
            if (_run != null)
              Container(
                margin: const EdgeInsets.only(top: 12),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.success.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.success.withValues(alpha: 0.4)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle, color: AppColors.success, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Dispatched — run is ${_run!.status}. APK lands in the run artifacts.',
                        style: const TextStyle(fontSize: 12.5),
                      ),
                    ),
                    if (_run!.url.isNotEmpty)
                      IconButton(
                        icon: const Icon(Icons.open_in_new, size: 16),
                        onPressed: () => launchUrl(Uri.parse(_run!.url), mode: LaunchMode.externalApplication),
                      ),
                  ],
                ),
              ),
            if (_error != null)
              Container(
                margin: const EdgeInsets.only(top: 12),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.danger.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.danger.withValues(alpha: 0.35)),
                ),
                child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
              ),
            if (_runs.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('RECENT RUNS', style: TextStyle(color: AppColors.textTertiary, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1)),
              const SizedBox(height: 8),
              for (final run in _runs.take(5))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: Icon(
                    run.isRunning
                        ? Icons.timelapse
                        : run.isGreen
                            ? Icons.check_circle
                            : Icons.error_outline,
                    size: 18,
                    color: run.isRunning
                        ? AppColors.warning
                        : run.isGreen
                            ? AppColors.success
                            : AppColors.danger,
                  ),
                  title: Text(run.name.isEmpty ? run.workflow : run.name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  subtitle: Text('${run.workflow} · ${run.branch} · ${run.isRunning ? run.status : (run.conclusion ?? run.status)}', style: TextStyle(fontSize: 11.5, color: AppColors.textSecondary)),
                  trailing: run.url.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.open_in_new, size: 16),
                          onPressed: () => launchUrl(Uri.parse(run.url), mode: LaunchMode.externalApplication),
                        ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  InputDecoration _input(String hint) => InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: AppColors.textTertiary, fontSize: 13),
        filled: true,
        fillColor: AppColors.surfaceHigh,
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
}

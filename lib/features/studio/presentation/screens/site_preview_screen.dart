import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../models/studio_models.dart';
import '../../providers/studio_provider.dart';
import '../widgets/publish_sheet.dart';

/// LIVE preview of a built site, inside the app.
///
/// The site is served by the Worker at /sites/<id> the moment it is built —
/// this screen shows that same URL in a WebView so the owner sees the real
/// thing immediately, with the URL one tap away for any external browser.
/// "Refine with AI" applies change requests in place: the same URL serves
/// a new version and the preview reloads.
class SitePreviewScreen extends ConsumerStatefulWidget {
  const SitePreviewScreen({super.key, required this.site, required this.onHostTap});

  final StudioSite site;

  /// Opens the publish sheet (wired by the Studio screen so the controller
  /// stays in one place).
  final VoidCallback onHostTap;

  @override
  ConsumerState<SitePreviewScreen> createState() => _SitePreviewScreenState();
}

class _SitePreviewScreenState extends ConsumerState<SitePreviewScreen> {
  WebViewController? _controller;
  double _progress = 0;
  bool _ready = false;
  String? _failed;
  late int _version;
  final _composeCtrl = TextEditingController();

  String get _url => widget.site.url ?? '';

  @override
  void initState() {
    super.initState();
    _version = widget.site.version;
    if (_url.isEmpty) {
      // Notes and malformed artifacts should never reach here, but a blank
      // loadRequest would throw — fail soft instead.
      _ready = true;
      _failed = 'this artifact has no public URL';
      return;
    }
    _controller = _makeController(_url);
  }

  WebViewController _makeController(String url) => WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..setBackgroundColor(AppColors.background)
    ..setNavigationDelegate(
      NavigationDelegate(
        onProgress: (p) => setState(() => _progress = p / 100),
        onPageFinished: (_) => setState(() { _ready = true; _progress = 1; }),
        onWebResourceError: (e) {
          // Only surface main-frame failures; asset hiccups are noise.
          if (e.isForMainFrame == true) {
            setState(() { _failed = e.description; _ready = true; _progress = 1; });
          }
        },
      ),
    )
    ..loadRequest(Uri.parse(url));

  @override
  void dispose() {
    _composeCtrl.dispose();
    super.dispose();
  }

  Future<void> _copyUrl() async {
    await Clipboard.setData(ClipboardData(text: _url));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Link copied — paste it in any browser.'), backgroundColor: AppColors.success),
    );
  }

  Future<void> _openExternal() async {
    final uri = Uri.parse(_url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No browser found on this device.')),
      );
    }
  }

  /// Ask the agent to change the site ("bolder headline, green accent").
  Future<void> _doRefine(String instruction) async {
    try {
      final updated = await ref.read(studioProvider.notifier).refineSite(
            artifactId: widget.site.id,
            instruction: instruction,
          );
      if (!mounted) return;
      setState(() {
        _version = updated.version;
        _ready = false;
        _progress = 0;
        _failed = null;
        // Cache-bust so the WebView re-fetches the new version.
        _controller = _makeController('$_url?t=${DateTime.now().millisecondsSinceEpoch}');
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Updated to v${updated.version} — same link.'), backgroundColor: AppColors.success),
      );
    } catch (_) {
      // Error surface already handled by the provider state.
    }
  }

  void _openRefineSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (sheetCtx) => Padding(
        padding: EdgeInsets.only(
          left: 20, right: 20, top: 20,
          bottom: MediaQuery.of(sheetCtx).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceHigh,
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: const Icon(Icons.edit_note_outlined, color: AppColors.textPrimary, size: 20),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text('Refine with AI', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15.5)),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 20),
                  onPressed: () => Navigator.of(sheetCtx).pop(),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Same link, new version. Try "make the headline bolder", "add a pricing FAQ", "switch to a green, minimal look".',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5, height: 1.45),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _composeCtrl,
              maxLines: 3,
              minLines: 2,
              maxLength: 500,
              style: const TextStyle(fontSize: 14, height: 1.45),
              decoration: InputDecoration(
                hintText: 'What should change?',
                hintStyle: TextStyle(color: AppColors.textTertiary, fontSize: 13.5),
                counterText: '',
                filled: true,
                fillColor: AppColors.background,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.border.withValues(alpha: 0.8)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: AppColors.border.withValues(alpha: 0.8)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: AppColors.primary),
                ),
              ),
            ),
            const SizedBox(height: 12),
            ValueListenableBuilder<TextEditingValue>(
              valueListenable: _composeCtrl,
              builder: (_, v, __) => FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                onPressed: v.text.trim().length < 3
                    ? null
                    : () {
                        final instruction = v.text.trim();
                        Navigator.of(sheetCtx).pop();
                        _composeCtrl.clear();
                        _doRefine(instruction);
                      },
                child: const Text('Apply change', style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(studioProvider);
    final refining = state.refiningId == widget.site.id;
    final dep = widget.site.latestDeployment;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Text(
          widget.site.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        actions: [
          if (refining)
            const Padding(
              padding: EdgeInsets.only(right: 14),
              child: Center(
                child: SizedBox(width: 17, height: 17, child: CircularProgressIndicator(strokeWidth: 2.2, color: AppColors.primary)),
              ),
            )
          else
            IconButton(
              tooltip: 'Refine with AI',
              icon: const Icon(Icons.auto_fix_high, size: 20),
              onPressed: _openRefineSheet,
            ),
          IconButton(
            tooltip: 'Copy link',
            icon: const Icon(Icons.link_outlined, size: 20),
            onPressed: _copyUrl,
          ),
          IconButton(
            tooltip: 'Open in browser',
            icon: const Icon(Icons.open_in_new, size: 20),
            onPressed: _openExternal,
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Column(
        children: [
          // ── URL bar ── the real, shareable address lives here ──
          GestureDetector(
            onTap: _copyUrl,
            child: Container(
              margin: const EdgeInsets.fromLTRB(16, 6, 16, 4),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: AppColors.border.withValues(alpha: 0.8)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.public, size: 15, color: AppColors.accent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _url,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
                    ),
                  ),
                  if (_version > 1) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        'v$_version',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                  if ((widget.site.sha256 ?? '').length >= 8) ...[
                    const SizedBox(width: 8),
                    Tooltip(
                      message: 'SHA-256 verified — full digest at /meta',
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.verified_user_outlined, size: 12, color: AppColors.textTertiary),
                          const SizedBox(width: 3),
                          Text(
                            widget.site.sha256!.substring(0, 8),
                            style: AppTypography.mono(size: 9.5, color: AppColors.textTertiary),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(width: 6),
                  const Icon(Icons.copy_outlined, size: 14, color: AppColors.textTertiary),
                ],
              ),
            ),
          ),
          if (widget.site.kind == 'webapp')
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 2),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Interactive app — works fully in the browser too.',
                  style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                ),
              ),
            ),
          // onProgress → setState keeps this rebuild-driven; no Listenable needed.
          if (_progress < 1.0 && !_ready)
            LinearProgressIndicator(
              value: _progress,
              minHeight: 2,
              backgroundColor: Colors.transparent,
              color: AppColors.primary,
            ),
          Expanded(
            child: Stack(
              children: [
                // _controller stays uninitialized for empty-URL artifacts;
                // the failure overlay below covers the screen.
                if (_url.isNotEmpty && _controller != null) WebViewWidget(controller: _controller!),
                if (!_ready)
                  Positioned.fill(
                    child: Container(
                      color: AppColors.background,
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const CircularProgressIndicator(color: AppColors.primary),
                            const SizedBox(height: 14),
                            Text(
                              refining ? 'Applying your changes…' : 'Loading your live site…',
                              style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                if (_failed != null)
                  Positioned.fill(
                    child: Container(
                      color: AppColors.background,
                      padding: const EdgeInsets.all(24),
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.wifi_off_rounded, color: AppColors.warning, size: 40),
                            const SizedBox(height: 12),
                            const Text(
                              'Could not load the preview',
                              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'The site itself is live — open it in your browser instead. ($_failed)',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
                            ),
                            const SizedBox(height: 16),
                            FilledButton.icon(
                              style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
                              onPressed: _openExternal,
                              icon: const Icon(Icons.open_in_new, size: 16),
                              label: const Text('Open in browser'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          // ── Action bar: Refine + Host ──
          Container(
            padding: EdgeInsets.fromLTRB(16, 10, 16, 10 + MediaQuery.of(context).padding.bottom * 0.4),
            decoration: BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.border.withValues(alpha: 0.6))),
            ),
            child: Row(
              children: [
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.textPrimary,
                    side: BorderSide(color: AppColors.border.withValues(alpha: 0.9)),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  ),
                  onPressed: refining ? null : _openRefineSheet,
                  icon: const Icon(Icons.auto_fix_high, size: 16),
                  label: const Text('Refine'),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: dep != null && dep.url != null ? () => _showHostInfo(dep) : null,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          dep != null && dep.url != null
                              ? 'Also on ${dep.connector} · ${dep.url!.replaceAll(RegExp(r'^https?://'), '')}'
                              : 'This link works in any browser, right now.',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  ),
                  onPressed: widget.onHostTap,
                  icon: const Icon(Icons.rocket_launch_outlined, size: 16),
                  label: Text(dep != null && dep.url != null ? 'Hosting' : 'Host it'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _showHostInfo(SiteDeployment dep) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Hosting', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 12),
              _row('Platform', dep.connector),
              if (dep.repo != null) _row('Repo', dep.repo!),
              if (dep.domain != null) _row('Domain', dep.domain!),
              _row('Live URL', dep.url ?? ''),
              _row('Deployed', dep.at),
              const SizedBox(height: 8),
              Text(
                'The in-app preview and every browser use the same source. External deploys are updated by publishing again after a rebuild.',
                style: TextStyle(color: AppColors.textTertiary, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 84,
              child: Text(label, style: TextStyle(color: AppColors.textTertiary, fontSize: 12.5)),
            ),
            Expanded(
              child: SelectableText(
                value,
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      );
}

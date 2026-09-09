import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../../core/theme/app_colors.dart';
import '../../models/studio_models.dart';
import '../../widgets/publish_sheet.dart';

/// LIVE preview of a built site, inside the app.
///
/// The site is served by the Worker at /sites/<id> the moment it is built —
/// this screen shows that same URL in a WebView so the owner sees the real
/// thing immediately, with the URL one tap away for any external browser.
class SitePreviewScreen extends StatefulWidget {
  const SitePreviewScreen({super.key, required this.site, required this.onHostTap});

  final StudioSite site;

  /// Opens the publish sheet (wired by the Studio screen so the controller
  /// stays in one place).
  final VoidCallback onHostTap;

  @override
  State<SitePreviewScreen> createState() => _SitePreviewScreenState();
}

class _SitePreviewScreenState extends State<SitePreviewScreen> {
  late final WebViewController _controller;
  double _progress = 0;
  bool _ready = false;
  String? _failed;

  String get _url => widget.site.url ?? '';

  @override
  void initState() {
    super.initState();
    if (_url.isEmpty) {
      // Notes and malformed artifacts should never reach here, but a blank
      // loadRequest would throw — fail soft instead.
      _ready = true;
      _failed = 'this artifact has no public URL';
      return;
    }
    _controller = WebViewController()
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
      ..loadRequest(Uri.parse(_url));
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

  @override
  Widget build(BuildContext context) {
    final dep = widget.site.latestDeployment;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(
          widget.site.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        actions: [
          if (dep != null && dep.url != null)
            IconButton(
              tooltip: 'Where it is hosted',
              icon: const Icon(Icons.cloud_done_outlined, size: 20),
              onPressed: () => _showHostInfo(dep),
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
              margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: AppColors.border),
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
                  const SizedBox(width: 6),
                  const Icon(Icons.copy_rounded, size: 14, color: AppColors.textTertiary),
                ],
              ),
            ),
          ),
          if (widget.site.kind == 'webapp')
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 4, 16, 2),
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
                if (_url.isNotEmpty) WebViewWidget(controller: _controller),
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
                              'Loading your live site…',
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
          // ── Action bar: Host it everywhere ──
          Container(
            padding: EdgeInsets.fromLTRB(16, 10, 16, 10 + MediaQuery.of(context).padding.bottom * 0.4),
            decoration: BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.border.withValues(alpha: 0.6))),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        dep != null && dep.url != null
                            ? 'Hosted on ${dep.connector} · ${dep.url!.replaceAll(RegExp(r'^https?://'), '')}'
                            : 'This link works in any browser, right now.',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                      ),
                      if (dep == null)
                        Text(
                          'Want it on GitHub, Vercel or your own domain?',
                          style: TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
                        ),
                    ],
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

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/widgets/nebula_ui.dart';

/// Index of the currently selected bottom-nav tab.
final selectedTabProvider = StateProvider<int>((ref) => 0);

/// Shell that hosts the bottom navigation bar and renders the active
/// feature screen as its `child`.
class MainScaffold extends ConsumerWidget {
  const MainScaffold({super.key, required this.child});

  final Widget child;

  static const _destinations = [
    _NavDestination(
      icon: Icons.dashboard_outlined,
      activeIcon: Icons.dashboard,
      label: 'Home',
      route: '/dashboard',
    ),
    _NavDestination(
      icon: Icons.group_outlined,
      activeIcon: Icons.group,
      label: 'Contacts',
      route: '/contacts',
    ),
    _NavDestination(
      icon: Icons.view_kanban_outlined,
      activeIcon: Icons.view_kanban,
      label: 'Pipeline',
      route: '/pipeline',
    ),
    _NavDestination(
      icon: Icons.mail_outline_rounded,
      activeIcon: Icons.mail_rounded,
      label: 'Email',
      route: '/ai-emailer',
    ),
    _NavDestination(
      icon: Icons.auto_awesome_outlined,
      activeIcon: Icons.auto_awesome,
      label: 'Assistant',
      route: '/assistant',
    ),
    _NavDestination(
      icon: Icons.apps_outlined,
      activeIcon: Icons.apps,
      label: 'More',
      route: '/more',
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).matchedLocation;
    final selectedIndex = _routeToIndex(location);

    return Scaffold(
      body: child,
      // Grok-grade nav: flat true black, one hairline, icon + micro
      // label, white active / graphite inactive. No M3 pill, no ripple
      // blobs — the inversion IS the selection.
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.background,
          border: Border(
            top: BorderSide(color: AppColors.border, width: 0.6),
          ),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 60,
            child: Row(
              children: [
                for (final entry in _destinations.asMap().entries)
                  Expanded(child: _navItem(context, entry.key, entry.value, entry.key == selectedIndex)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _navItem(BuildContext context, int index, _NavDestination d, bool selected) {
    return PressableScale(
      pressedScale: 0.92,
      onTap: () {
        if (!selected) context.go(d.route);
      },
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOutCubic,
        opacity: selected ? 1.0 : 0.62,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              height: 24,
              child: Icon(
                selected ? d.activeIcon : d.icon,
                size: 22,
                color: selected ? AppColors.primary : AppColors.textTertiary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              d.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 10,
                height: 1.0,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                letterSpacing: 0.15,
                color: selected ? AppColors.primary : AppColors.textTertiary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  int _routeToIndex(String location) {
    for (var i = 0; i < _destinations.length; i++) {
      if (location.startsWith(_destinations[i].route)) return i;
    }
    return 0;
  }
}

class _NavDestination {
  const _NavDestination({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.route,
  });
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final String route;
}

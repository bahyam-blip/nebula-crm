import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/utils/extensions.dart';

/// Index of the currently selected bottom-nav tab.
final selectedTabProvider = StateProvider<int>((ref) => 0);

/// Shell that hosts the bottom navigation bar and renders the active
/// feature screen as its `child`.
class MainScaffold extends ConsumerWidget {
  const MainScaffold({super.key, required this.child});

  final Widget child;

  static const _destinations = [
    _NavDestination(
      icon: Icons.dashboard,
      selectedIcon: Icons.dashboard,
      label: 'Dashboard',
      route: '/dashboard',
    ),
    _NavDestination(
      icon: Icons.group,
      selectedIcon: Icons.group,
      label: 'Contacts',
      route: '/contacts',
    ),
    _NavDestination(
      icon: Icons.view_kanban,
      selectedIcon: Icons.view_kanban,
      label: 'Pipeline',
      route: '/pipeline',
    ),
    _NavDestination(
      icon: Icons.mark_email_unread_outlined,
      selectedIcon: Icons.mark_email_read_outlined,
      label: 'Email',
      route: '/ai-emailer',
    ),
    _NavDestination(
      icon: Icons.auto_awesome,
      selectedIcon: Icons.auto_awesome,
      label: 'Assistant',
      route: '/assistant',
    ),
    _NavDestination(
      icon: Icons.more_horiz,
      selectedIcon: Icons.more_horiz,
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
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(
            top: BorderSide(color: AppColors.border, width: 0.5),
          ),
        ),
        child: NavigationBar(
          selectedIndex: selectedIndex,
          onDestinationSelected: (i) {
            context.go(_destinations[i].route);
          },
          destinations: [
            for (final d in _destinations)
              NavigationDestination(
                icon: Icon(d.icon),
                selectedIcon: Icon(d.selectedIcon),
                label: d.label,
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
    required this.selectedIcon,
    required this.label,
    required this.route,
  });
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final String route;
}

// Nebula CRM smoke + design-system tests.
//
// These deliberately avoid pumping NebulaCrmApp itself: the real root
// boots Firebase and starts DataApi heartbeats, which leaves pending
// timers in the widget-test fake-async zone. Instead we test:
//   1. THEME CONTRAST INVARIANTS — the mono design language runs white
//      primaries, so every "on white" foreground MUST be black ink.
//      A past regression shipped white-on-white labels on every
//      Material button in the app; these asserts make that impossible
//      to reintroduce silently.
//   2. THE GROK-GRADE BOTTOM NAV — MainScaffold renders all six
//      destinations and navigation keeps the shell intact.
//
// The nav shell test uses a local ThemeData.dark() on purpose:
// AppTheme.theme pulls Google Fonts, which tries a network fetch that
// never settles inside the test fake-async zone.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:nebula_crm/core/theme/app_theme.dart';
import 'package:nebula_crm/shared/widgets/main_scaffold.dart';

void main() {
  // AppTheme.theme builds a Google-Fonts text theme; the binding must be
  // up before that machinery is touched, even in plain unit tests.
  TestWidgetsFlutterBinding.ensureInitialized();
  // And runtime fetching must be OFF: a live HTTP fetch outlives the
  // unit-test body and fails it "after it had already completed".
  GoogleFonts.config.allowRuntimeFetching = false;

  group('AppTheme contrast invariants', () {
    test('white primary always carries black ink on-primary', () {
      expect(AppTheme.onWhite, const Color(0xFF0A0A0A));
      expect(AppTheme.theme.colorScheme.primary, const Color(0xFFFFFFFF));
      expect(AppTheme.theme.colorScheme.onPrimary, AppTheme.onWhite);
      expect(AppTheme.theme.colorScheme.onSecondary, AppTheme.onWhite);
    });

    test('Elevated/Filled buttons render black ink on white', () {
      final theme = AppTheme.theme;
      for (final style in [
        theme.elevatedButtonTheme.style,
        theme.filledButtonTheme.style,
      ]) {
        expect(style?.backgroundColor?.resolve({}), const Color(0xFFFFFFFF));
        expect(style?.foregroundColor?.resolve({}), AppTheme.onWhite);
      }
    });

    test('FAB renders black ink on white', () {
      expect(
        AppTheme.theme.floatingActionButtonTheme.foregroundColor,
        AppTheme.onWhite,
      );
    });

    test('checkbox tick and switch thumb are black on white', () {
      final theme = AppTheme.theme;
      expect(
        theme.checkboxTheme.checkColor?.resolve({WidgetState.selected}),
        AppTheme.onWhite,
      );
      expect(
        theme.switchTheme.thumbColor?.resolve({WidgetState.selected}),
        AppTheme.onWhite,
      );
      expect(
        theme.switchTheme.trackColor?.resolve({WidgetState.selected}),
        const Color(0xFFFFFFFF),
      );
    });
  });

  group('MainScaffold bottom nav', () {
    Widget router() => ProviderScope(
          child: MaterialApp.router(
            // Local theme — see the file-level note about Google Fonts.
            theme: ThemeData.dark(),
            routerConfig: GoRouter(
              initialLocation: '/dashboard',
              routes: [
                ShellRoute(
                  builder: (_, __, child) => MainScaffold(child: child),
                  routes: [
                    for (final r in const [
                      '/dashboard',
                      '/contacts',
                      '/pipeline',
                      '/ai-emailer',
                      '/assistant',
                      '/more',
                    ])
                      GoRoute(
                        path: r,
                        builder: (_, __) => const SizedBox.shrink(),
                      ),
                  ],
                ),
              ],
            ),
          ),
        );

    testWidgets('renders all six destinations', (WidgetTester tester) async {
      await tester.pumpWidget(router());
      await tester.pump();
      for (final label in const [
        'Home',
        'Contacts',
        'Pipeline',
        'Email',
        'Assistant',
        'More',
      ]) {
        expect(find.text(label), findsOneWidget);
      }
    });

    testWidgets('tapping a destination keeps the shell mounted', (WidgetTester tester) async {
      await tester.pumpWidget(router());
      await tester.pump();
      await tester.tap(find.text('Assistant'));
      await tester.pumpAndSettle();
      expect(find.text('Assistant'), findsOneWidget);
      expect(find.byType(MainScaffold), findsOneWidget);
    });
  });
}

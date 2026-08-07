// A basic smoke test for Nebula CRM.
//
// This verifies the app's root widget can be constructed without throwing.
// Full widget tests for each screen are deferred — they require Firebase
// initialization mocks.

import 'package:flutter_test/flutter_test.dart';

import 'package:nebula_crm/app.dart';

void main() {
  testWidgets('App root constructs without throwing', (WidgetTester tester) async {
    // Build the app root. We don't pump for long because Firebase init
    // will fail in the test environment (placeholder config) and trigger
    // the auth-redirect to /login.
    await tester.pumpWidget(const NebulaCrmApp());

    // Allow one frame so the router can render the initial route.
    await tester.pump();

    // The app should render SOMETHING (likely the login screen due to
    // the auth redirect). We just verify no exception was thrown.
    expect(find.byType(NebulaCrmApp), findsOneWidget);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../services/auth_service.dart' show isLoggedInProvider;
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/register_screen.dart';
import '../../features/auth/presentation/screens/forgot_password_screen.dart';
import '../../features/auth/presentation/screens/profile_screen.dart';
import '../../features/auth/presentation/screens/team_management_screen.dart';
import '../../features/contacts/presentation/screens/contacts_list_screen.dart';
import '../../features/contacts/presentation/screens/contact_detail_screen.dart';
import '../../features/contacts/presentation/screens/contact_form_screen.dart';
import '../../features/assistant/presentation/screens/ai_tools_screen.dart';
import '../../features/auth/presentation/screens/profile_edit_screen.dart';
import '../../features/calendar/presentation/screens/calendar_screen.dart';
import '../../features/companies/presentation/screens/companies_screen.dart';
import '../../features/contacts/presentation/screens/csv_import_screen.dart';
import '../../features/tasks/presentation/screens/tasks_screen.dart';
import '../../features/telecalling/presentation/screens/calling_dashboard_screen.dart';
import '../../features/telecalling/presentation/screens/lead_distribution_screen.dart';
import '../../features/telecalling/presentation/screens/my_leads_screen.dart';
import '../../features/telecalling/presentation/screens/super_admin_screen.dart';
import '../../features/dashboard/presentation/screens/dashboard_screen.dart';
import '../../features/pipeline/presentation/screens/pipeline_board_screen.dart';
import '../../features/pipeline/presentation/screens/deal_detail_screen.dart';
import '../../features/pipeline/presentation/screens/deal_form_screen.dart';
import '../../features/marketing/presentation/screens/campaigns_screen.dart';
import '../../features/marketing/presentation/screens/campaign_detail_screen.dart';
import '../../features/marketing/presentation/screens/campaign_builder_screen.dart';
import '../../features/service/presentation/screens/tickets_screen.dart';
import '../../features/service/presentation/screens/ticket_detail_screen.dart';
import '../../features/service/presentation/screens/knowledge_base_screen.dart';
import '../../features/assistant/presentation/screens/ai_assistant_screen.dart';
import '../constants/app_constants.dart';
import '../theme/app_colors.dart';
import '../../shared/widgets/main_scaffold.dart';

final routerConfigProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: AppRoutes.dashboard,
    refreshListenable: _AuthListenable(ref),
    redirect: (context, state) {
      final isLoggedIn = ref.read(isLoggedInProvider);
      final isAuthRoute = state.matchedLocation == AppRoutes.login ||
          state.matchedLocation == AppRoutes.register ||
          state.matchedLocation == AppRoutes.forgotPassword;

      if (!isLoggedIn && !isAuthRoute) return AppRoutes.login;
      if (isLoggedIn && isAuthRoute) return AppRoutes.dashboard;
      return null;
    },
    routes: [
      // ── Auth routes (no shell) ─────────────────────────────────
      GoRoute(
        path: AppRoutes.login,
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.register,
        builder: (_, __) => const RegisterScreen(),
      ),
      GoRoute(
        path: AppRoutes.forgotPassword,
        builder: (_, __) => const ForgotPasswordScreen(),
      ),

      // ── Shell routes (bottom nav) ──────────────────────────────
      ShellRoute(
        builder: (context, state, child) => MainScaffold(child: child),
        routes: [
          GoRoute(
            path: AppRoutes.dashboard,
            name: 'dashboard',
            builder: (_, __) => const DashboardScreen(),
          ),
          GoRoute(
            path: AppRoutes.contacts,
            name: 'contacts',
            builder: (_, __) => const ContactsListScreen(),
            routes: [
              GoRoute(
                path: ':id',
                name: 'contactDetail',
                builder: (_, state) =>
                    ContactDetailScreen(id: state.pathParameters['id']!),
              ),
            ],
          ),
          GoRoute(
            path: AppRoutes.pipeline,
            name: 'pipeline',
            builder: (_, __) => const PipelineBoardScreen(),
            routes: [
              GoRoute(
                path: 'deals/:id',
                name: 'dealDetail',
                builder: (_, state) =>
                    DealDetailScreen(id: state.pathParameters['id']!),
              ),
            ],
          ),
          GoRoute(
            path: AppRoutes.assistant,
            name: 'assistant',
            builder: (_, __) => const AiAssistantScreen(),
          ),
          GoRoute(
            path: AppRoutes.more,
            name: 'more',
            builder: (_, __) => const _MoreScreen(),
          ),
        ],
      ),

      // ── Pushed routes (full-screen) ────────────────────────────
      GoRoute(
        path: '/profile',
        name: 'profile',
        builder: (_, __) => const ProfileScreen(),
      ),
      GoRoute(
        path: '/team',
        name: 'teamManagement',
        builder: (_, __) => const TeamManagementScreen(),
      ),
      GoRoute(
        path: '/contacts/new',
        name: 'contactForm',
        builder: (_, __) => const ContactFormScreen(),
      ),
      GoRoute(
        path: '/contacts/import',
        name: 'contactImport',
        builder: (_, __) => const CsvImportScreen(),
      ),
      GoRoute(
        path: '/tasks',
        name: 'tasks',
        builder: (_, __) => const TasksScreen(),
      ),
      GoRoute(
        path: '/profile/edit',
        name: 'profileEdit',
        builder: (_, __) => const ProfileEditScreen(),
      ),
      GoRoute(
        path: '/companies',
        name: 'companies',
        builder: (_, __) => const CompaniesScreen(),
      ),
      GoRoute(
        path: '/calendar',
        name: 'calendar',
        builder: (_, __) => const CalendarScreen(),
      ),
      GoRoute(
        path: '/ai-tools',
        name: 'aiTools',
        builder: (_, __) => const AiToolsScreen(),
      ),
      GoRoute(
        path: '/my-leads',
        name: 'myLeads',
        builder: (_, __) => const MyLeadsScreen(),
      ),
      GoRoute(
        path: '/leads/distribute',
        name: 'leadDistribution',
        builder: (_, __) => const LeadDistributionScreen(),
      ),
      GoRoute(
        path: '/calling-performance',
        name: 'callingDashboard',
        builder: (_, __) => const CallingDashboardScreen(),
      ),
      GoRoute(
        path: '/super-admin',
        name: 'superAdmin',
        builder: (_, __) => const SuperAdminScreen(),
      ),
      GoRoute(
        path: '/deals/new',
        name: 'dealForm',
        builder: (_, __) => const DealFormScreen(),
      ),
      GoRoute(
        path: '/campaigns',
        name: 'campaigns',
        builder: (_, __) => const CampaignsScreen(),
      ),
      GoRoute(
        path: '/campaigns/new',
        name: 'campaignBuilder',
        builder: (_, __) => const CampaignBuilderScreen(),
      ),
      GoRoute(
        path: '/campaigns/:id',
        name: 'campaignDetail',
        builder: (_, state) =>
            CampaignDetailScreen(id: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/tickets',
        name: 'tickets',
        builder: (_, __) => const TicketsScreen(),
      ),
      GoRoute(
        path: '/tickets/:id',
        name: 'ticketDetail',
        builder: (_, state) =>
            TicketDetailScreen(id: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/knowledge-base',
        name: 'knowledgeBase',
        builder: (_, __) => const KnowledgeBaseScreen(),
      ),
    ],
  );
});

/// Bridges Riverpod `isLoggedInProvider` to GoRouter's `refreshListenable`.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) {
    ref.listen(isLoggedInProvider, (_, __) => notifyListeners());
  }
}

/// "More" tab — secondary navigation surface.
class _MoreScreen extends StatelessWidget {
  const _MoreScreen();

  @override
  Widget build(BuildContext context) {
    final items = <_MenuItem>[
      _MenuItem(
        icon: Icons.person_outline,
        label: 'Profile',
        route: '/profile',
        color: AppColors.primary,
      ),
      _MenuItem(
        icon: Icons.group_outlined,
        label: 'Team Members',
        route: '/team',
        color: AppColors.accent,
      ),
      _MenuItem(
        icon: Icons.task_alt,
        label: 'Tasks & Reminders',
        route: '/tasks',
        color: AppColors.warning,
      ),
      _MenuItem(
        icon: Icons.business,
        label: 'Companies',
        route: '/companies',
        color: AppColors.info,
      ),
      _MenuItem(
        icon: Icons.calendar_month,
        label: 'Calendar',
        route: '/calendar',
        color: AppColors.stageNegotiation,
      ),
      _MenuItem(
        icon: Icons.auto_awesome,
        label: 'AI Tools',
        route: '/ai-tools',
        color: AppColors.tertiary,
      ),
      _MenuItem(
        icon: Icons.headset_mic,
        label: 'My Leads',
        route: '/my-leads',
        color: AppColors.primary,
      ),
      _MenuItem(
        icon: Icons.shuffle,
        label: 'Distribute Leads',
        route: '/leads/distribute',
        color: AppColors.stageProposal,
      ),
      _MenuItem(
        icon: Icons.speed,
        label: 'Calling Performance',
        route: '/calling-performance',
        color: AppColors.success,
      ),
      _MenuItem(
        icon: Icons.upload_file,
        label: 'Import Contacts',
        route: '/contacts/import',
        color: AppColors.info,
      ),
      _MenuItem(
        icon: Icons.shield,
        label: 'Super Admin',
        route: '/super-admin',
        color: AppColors.tertiary,
      ),
      _MenuItem(
        icon: Icons.trending_up,
        label: 'Campaigns',
        route: '/campaigns',
        color: AppColors.accent,
      ),
      _MenuItem(
        icon: Icons.business,
        label: 'Companies',
        route: '/companies',
        color: AppColors.info,
      ),
      _MenuItem(
        icon: Icons.calendar_month,
        label: 'Calendar',
        route: '/calendar',
        color: AppColors.stageNegotiation,
      ),
      _MenuItem(
        icon: Icons.auto_awesome,
        label: 'AI Tools',
        route: '/ai-tools',
        color: AppColors.tertiary,
      ),
      _MenuItem(
        icon: Icons.headset_mic,
        label: 'Tickets',
        route: '/tickets',
        color: AppColors.info,
      ),
      _MenuItem(
        icon: Icons.menu_book,
        label: 'Knowledge Base',
        route: '/knowledge-base',
        color: AppColors.tertiary,
      ),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          final item = items[i];
          return Card(
            child: ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: item.color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(item.icon, color: item.color, size: 20),
              ),
              title: Text(item.label),
              trailing: const Icon(Icons.chevron_right,
                  color: AppColors.textTertiary, size: 20),
              onTap: () => context.push(item.route),
            ),
          );
        },
      ),
    );
  }
}

class _MenuItem {
  const _MenuItem({
    required this.icon,
    required this.label,
    required this.route,
    required this.color,
  });
  final IconData icon;
  final String label;
  final String route;
  final Color color;
}

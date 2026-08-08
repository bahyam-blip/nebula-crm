/// App-wide constants for Nebula CRM.
library nebula_crm.constants;

import 'package:flutter/widgets.dart';

abstract class AppConstants {
  /// App display name.
  static const String appName = 'Nebula CRM';

  /// App version (mirrors pubspec).
  static const String appVersion = '1.0.0';

  /// Firestore collection names — keep single source of truth.
  static const String colUsers = 'users';
  static const String colContacts = 'contacts';
  static const String colDeals = 'deals';
  static const String colActivities = 'activities';
  static const String colCampaigns = 'campaigns';
  static const String colTickets = 'tickets';
  static const String colArticles = 'articles';
  static const String colChatThreads = 'chat_threads';
  static const String colInsights = 'insights';
  static const String colTeams = 'teams';
  static const String colSystem = 'system';
  static const String colInvites = 'invites';
  static const String colCompanies = 'companies';
  static const String colNotes = 'notes';

  /// Shared workspace every signup joins, so a team sees one pipeline.
  static const String defaultTeamId = 'default-team';

  /// Storage paths.
  static const String storageAvatars = 'avatars';
  static const String storageAttachments = 'attachments';
  static const String storageCampaignAssets = 'campaign_assets';

  /// Default page size for paginated lists.
  static const int defaultPageSize = 25;

  /// Animation durations.
  static const Duration durationFast = Duration(milliseconds: 150);
  static const Duration durationMedium = Duration(milliseconds: 300);
  static const Duration durationSlow = Duration(milliseconds: 500);

  /// Standard content padding.
  static const EdgeInsets paddingScreen =
      EdgeInsets.symmetric(horizontal: 20, vertical: 16);
  static const EdgeInsets paddingCard =
      EdgeInsets.symmetric(horizontal: 16, vertical: 14);
  static const EdgeInsets paddingChip =
      EdgeInsets.symmetric(horizontal: 12, vertical: 6);

  /// Border radii.
  static const double radiusS = 8;
  static const double radiusM = 12;
  static const double radiusL = 16;
  static const double radiusXL = 24;

  /// Deal pipeline stages — keep ordering consistent across app.
  static const List<String> pipelineStages = [
    'lead',
    'qualified',
    'proposal',
    'negotiation',
    'won',
  ];

  /// Map stage key → human label.
  static const Map<String, String> stageLabels = {
    'lead': 'Lead',
    'qualified': 'Qualified',
    'proposal': 'Proposal',
    'negotiation': 'Negotiation',
    'won': 'Closed Won',
    'lost': 'Closed Lost',
  };

  /// Default deal stage probabilities (for weighted forecast).
  static const Map<String, double> stageProbabilities = {
    'lead': 0.10,
    'qualified': 0.30,
    'proposal': 0.50,
    'negotiation': 0.75,
    'won': 1.00,
    'lost': 0.00,
  };

  /// Ticket priorities.
  static const List<String> ticketPriorities = [
    'low',
    'medium',
    'high',
    'urgent',
  ];

  /// SLA targets (hours to first response) by priority.
  static const Map<String, int> slaHours = {
    'low': 24,
    'medium': 8,
    'high': 4,
    'urgent': 1,
  };

  /// Campaign statuses.
  static const List<String> campaignStatuses = [
    'draft',
    'scheduled',
    'running',
    'paused',
    'completed',
  ];

  /// Activity types.
  static const List<String> activityTypes = [
    'call',
    'email',
    'meeting',
    'note',
    'task',
    'deal_created',
    'deal_stage_changed',
    'ticket_created',
  ];

  /// AI assistant message roles.
  static const String roleUser = 'user';
  static const String roleAssistant = 'assistant';
  static const String roleSystem = 'system';
}

/// Named routes — use these instead of literal strings.
abstract class AppRoutes {
  static const String splash = '/splash';
  static const String login = '/login';
  static const String register = '/register';
  static const String forgotPassword = '/forgot-password';

  // Shell-routed (bottom nav)
  static const String dashboard = '/dashboard';
  static const String contacts = '/contacts';
  static const String pipeline = '/pipeline';
  static const String assistant = '/assistant';
  static const String more = '/more';

  // Pushed (full-screen)
  static const String contactDetail = '/contacts/:id';
  static const String contactForm = '/contacts/new';
  static const String dealDetail = '/deals/:id';
  static const String dealForm = '/deals/new';
  static const String campaignDetail = '/campaigns/:id';
  static const String campaignBuilder = '/campaigns/new';
  static const String ticketDetail = '/tickets/:id';
  static const String knowledgeBase = '/knowledge-base';
  static const String articleDetail = '/knowledge-base/:id';
  static const String profile = '/profile';
  static const String settings = '/settings';
  static const String teamMembers = '/team';
  static const String analytics = '/analytics';
}

import '../../features/auth/models/app_user.dart';

/// Every distinct thing a person can do in this CRM.
///
/// Modelled on how Salesforce and Zoho separate concerns: a role gives a
/// baseline profile, and individual capabilities can then be granted or
/// revoked per person without inventing a new role. Two kinds live here:
///
///  * object actions - create/edit/delete within a module
///  * system actions - import, export, distribute, approve payouts
///
/// The second kind is what actually carries risk. Anyone can be trusted to
/// edit a contact; far fewer people should be able to bulk-import 15,000 of
/// them or export the entire database.
enum Capability {
  // ── Contacts ──
  contactsView,
  contactsCreate,
  contactsEdit,
  contactsDelete,
  contactsImport,
  contactsExport,

  // ── Leads / telecalling ──
  leadsDistribute,
  leadsReassign,
  callsLog,

  // ── Deals ──
  dealsView,
  dealsEdit,
  dealsDelete,

  // ── Tasks ──
  tasksCreate,
  tasksAssignOthers,

  // ── Team ──
  teamView,
  teamInvite,
  teamChangeRoles,
  teamManagePermissions,

  // ── Money ──
  commissionsViewOwn,
  commissionsViewTeam,
  commissionsApprove,
  commissionsSetRate,

  // ── Oversight ──
  performanceView,
  auditView,
  aiActions,
  settingsManage,
}

extension CapabilityX on Capability {
  /// Stable wire name. Never rename these: they are persisted on user
  /// documents and read by security rules.
  String get id {
    switch (this) {
      case Capability.contactsView:
        return 'contacts.view';
      case Capability.contactsCreate:
        return 'contacts.create';
      case Capability.contactsEdit:
        return 'contacts.edit';
      case Capability.contactsDelete:
        return 'contacts.delete';
      case Capability.contactsImport:
        return 'contacts.import';
      case Capability.contactsExport:
        return 'contacts.export';
      case Capability.leadsDistribute:
        return 'leads.distribute';
      case Capability.leadsReassign:
        return 'leads.reassign';
      case Capability.callsLog:
        return 'calls.log';
      case Capability.dealsView:
        return 'deals.view';
      case Capability.dealsEdit:
        return 'deals.edit';
      case Capability.dealsDelete:
        return 'deals.delete';
      case Capability.tasksCreate:
        return 'tasks.create';
      case Capability.tasksAssignOthers:
        return 'tasks.assignOthers';
      case Capability.teamView:
        return 'team.view';
      case Capability.teamInvite:
        return 'team.invite';
      case Capability.teamChangeRoles:
        return 'team.changeRoles';
      case Capability.teamManagePermissions:
        return 'team.managePermissions';
      case Capability.commissionsViewOwn:
        return 'commissions.viewOwn';
      case Capability.commissionsViewTeam:
        return 'commissions.viewTeam';
      case Capability.commissionsApprove:
        return 'commissions.approve';
      case Capability.commissionsSetRate:
        return 'commissions.setRate';
      case Capability.performanceView:
        return 'performance.view';
      case Capability.auditView:
        return 'audit.view';
      case Capability.aiActions:
        return 'ai.actions';
      case Capability.settingsManage:
        return 'settings.manage';
    }
  }

  String get label {
    switch (this) {
      case Capability.contactsView:
        return 'View contacts';
      case Capability.contactsCreate:
        return 'Add contacts';
      case Capability.contactsEdit:
        return 'Edit contacts';
      case Capability.contactsDelete:
        return 'Delete contacts';
      case Capability.contactsImport:
        return 'Import CSV';
      case Capability.contactsExport:
        return 'Export data';
      case Capability.leadsDistribute:
        return 'Distribute leads';
      case Capability.leadsReassign:
        return 'Reassign leads';
      case Capability.callsLog:
        return 'Log calls';
      case Capability.dealsView:
        return 'View deals';
      case Capability.dealsEdit:
        return 'Edit deals';
      case Capability.dealsDelete:
        return 'Delete deals';
      case Capability.tasksCreate:
        return 'Create tasks';
      case Capability.tasksAssignOthers:
        return 'Assign tasks to others';
      case Capability.teamView:
        return 'View team';
      case Capability.teamInvite:
        return 'Invite people';
      case Capability.teamChangeRoles:
        return 'Change roles';
      case Capability.teamManagePermissions:
        return 'Manage permissions';
      case Capability.commissionsViewOwn:
        return 'See own earnings';
      case Capability.commissionsViewTeam:
        return 'See team earnings';
      case Capability.commissionsApprove:
        return 'Approve payouts';
      case Capability.commissionsSetRate:
        return 'Set commission rate';
      case Capability.performanceView:
        return 'See performance';
      case Capability.auditView:
        return 'See audit trail';
      case Capability.aiActions:
        return 'Let AI act on data';
      case Capability.settingsManage:
        return 'Manage settings';
    }
  }

  /// Grouping for the permission editor.
  String get group {
    final n = id.split('.').first;
    switch (n) {
      case 'contacts':
        return 'Contacts';
      case 'leads':
      case 'calls':
        return 'Telecalling';
      case 'deals':
        return 'Pipeline';
      case 'tasks':
        return 'Tasks';
      case 'team':
        return 'Team';
      case 'commissions':
        return 'Commissions';
      default:
        return 'Oversight';
    }
  }

  /// Capabilities that can cause damage that is hard to undo, or that expose
  /// the whole database. Flagged in the editor so granting one is a
  /// deliberate act rather than a stray tap.
  bool get isSensitive =>
      this == Capability.contactsImport ||
      this == Capability.contactsExport ||
      this == Capability.contactsDelete ||
      this == Capability.dealsDelete ||
      this == Capability.teamChangeRoles ||
      this == Capability.teamManagePermissions ||
      this == Capability.commissionsApprove ||
      this == Capability.commissionsSetRate ||
      this == Capability.settingsManage;

  static Capability? parse(String id) {
    for (final c in Capability.values) {
      if (c.id == id) return c;
    }
    return null;
  }
}

/// The baseline each role starts from — the "profile".
///
/// Deliberately conservative for anyone below manager. A telecaller needs to
/// work their queue and log calls; they do not need to import a lead list or
/// export the contact database, and until now every role could do both.
Set<Capability> defaultCapabilitiesFor(UserRole role) {
  switch (role) {
    case UserRole.superAdmin:
      return Capability.values.toSet();

    case UserRole.admin:
      return {
        ...Capability.values.where((c) =>
            c != Capability.teamChangeRoles &&
            c != Capability.teamManagePermissions &&
            c != Capability.commissionsSetRate),
      };

    case UserRole.manager:
      return {
        Capability.contactsView,
        Capability.contactsCreate,
        Capability.contactsEdit,
        Capability.contactsImport,
        Capability.leadsDistribute,
        Capability.leadsReassign,
        Capability.callsLog,
        Capability.dealsView,
        Capability.dealsEdit,
        Capability.tasksCreate,
        Capability.tasksAssignOthers,
        Capability.teamView,
        Capability.commissionsViewOwn,
        Capability.commissionsViewTeam,
        Capability.performanceView,
        Capability.aiActions,
      };

    case UserRole.salesRep:
      return {
        Capability.contactsView,
        Capability.contactsCreate,
        Capability.contactsEdit,
        Capability.callsLog,
        Capability.dealsView,
        Capability.dealsEdit,
        Capability.tasksCreate,
        Capability.teamView,
        Capability.commissionsViewOwn,
      };

    case UserRole.supportAgent:
      return {
        Capability.contactsView,
        Capability.contactsEdit,
        Capability.callsLog,
        Capability.tasksCreate,
        Capability.teamView,
      };

    case UserRole.viewer:
      return {
        Capability.contactsView,
        Capability.dealsView,
        Capability.teamView,
      };
  }
}

List<String> defaultCapabilityIdsFor(UserRole role) =>
    defaultCapabilitiesFor(role).map((c) => c.id).toList()..sort();

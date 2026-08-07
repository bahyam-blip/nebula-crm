import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/firestore_service.dart';
import '../../auth/providers/auth_provider.dart';
import '../models/ticket.dart';

/// Tickets assigned to the current user.
final myTicketsProvider = StreamProvider<List<Ticket>>((ref) {
  final userId = ref.watch(currentUserIdProvider);
  final db = ref.watch(firestoreServiceProvider);
  return db.watchTickets(assigneeId: userId);
});

/// All tickets in the team (for managers).
final allTicketsProvider = StreamProvider<List<Ticket>>((ref) {
  final db = ref.watch(firestoreServiceProvider);
  return db.watchTickets();
});

/// Status filter for the tickets list.
final ticketStatusFilterProvider = StateProvider<String?>((ref) => null);

final filteredTicketsProvider = Provider<List<Ticket>>((ref) {
  final tickets = ref.watch(myTicketsProvider).valueOrNull ?? [];
  final status = ref.watch(ticketStatusFilterProvider);
  if (status == null) return tickets;
  return tickets.where((t) => t.status.name == status).toList();
});

/// SLA counts for the dashboard service widget.
final slaCountsProvider = Provider<SlaCounts>((ref) {
  final tickets = ref.watch(myTicketsProvider).valueOrNull ?? [];
  var within = 0;
  var atRisk = 0;
  var breached = 0;
  for (final t in tickets) {
    if (!t.status.isOpen) continue;
    switch (t.slaStatus) {
      case 'within':
        within++;
        break;
      case 'at_risk':
        atRisk++;
        break;
      case 'breached':
        breached++;
        break;
    }
  }
  return SlaCounts(within: within, atRisk: atRisk, breached: breached);
});

class SlaCounts {
  const SlaCounts({
    required this.within,
    required this.atRisk,
    required this.breached,
  });
  final int within;
  final int atRisk;
  final int breached;
  int get total => within + atRisk + breached;
}

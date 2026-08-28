import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/services/remote/data_api.dart';
import '../../../core/services/remote/data_codec.dart';
import '../../auth/providers/auth_provider.dart';
import '../../contacts/models/contact.dart';
import '../../pipeline/models/deal.dart';

/// An organisation. Contacts belong to one by name, so a company profile can
/// aggregate everyone at that account without a manual link step.
class Company {
  const Company({
    required this.id,
    required this.name,
    this.teamId,
    this.industry,
    this.website,
    this.phone,
    this.address,
    this.notes,
    this.ownerId,
    this.createdAt,
  });

  final String id;
  final String name;
  final String? teamId;
  final String? industry;
  final String? website;
  final String? phone;
  final String? address;
  final String? notes;
  final String? ownerId;
  final DateTime? createdAt;

  factory Company.fromFirestore(DataDoc doc) {
    final d = doc.data;
    return Company(
      id: doc.id,
      name: d['name'] as String? ?? '',
      teamId: d['teamId'] as String?,
      industry: d['industry'] as String?,
      website: d['website'] as String?,
      phone: d['phone'] as String?,
      address: d['address'] as String?,
      notes: d['notes'] as String?,
      ownerId: d['ownerId'] as String?,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'name': name,
        'teamId': teamId,
        'industry': industry,
        'website': website,
        'phone': phone,
        'address': address,
        'notes': notes,
        'ownerId': ownerId,
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : const ServerTimestamp(),
      };
}

/// Rolled-up view of one account.
class CompanyRollup {
  CompanyRollup({
    required this.name,
    this.record,
    this.contacts = const [],
    this.deals = const [],
  });

  final String name;
  final Company? record;
  final List<Contact> contacts;
  final List<Deal> deals;

  /// Stages are plain strings; 'won' and 'lost' are terminal.
  static bool _isOpen(Deal d) => d.stage != 'won' && d.stage != 'lost';

  double get openValue =>
      deals.where(_isOpen).fold(0.0, (a, d) => a + d.value);

  double get wonValue => deals
      .where((d) => d.stage == 'won')
      .fold(0.0, (a, d) => a + d.value);

  int get openDeals => deals.where(_isOpen).length;
}

final companiesProvider = StreamProvider<List<Company>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <Company>[]);
  final ds = ref.watch(remoteDataServiceProvider);
  return ds.watchList(
    () => ds
        .list(AppConstants.colCompanies, where: [WhereEq('teamId', teamId)], limit: 200)
        .then((docs) => docs.map(Company.fromFirestore).toList()),
  );
});

/// Every account, derived from contacts and deals as well as saved records.
///
/// Companies exist implicitly the moment a contact names one, so the list is
/// useful before anybody creates a company record by hand.
final companyRollupsProvider = Provider<List<CompanyRollup>>((ref) {
  final saved = ref.watch(companiesProvider).valueOrNull ?? const <Company>[];
  final contacts = ref.watch(allTeamContactsProvider).valueOrNull ?? const <Contact>[];
  final deals = ref.watch(allTeamDealsProvider).valueOrNull ?? const <Deal>[];

  final names = <String>{
    ...saved.map((c) => c.name),
    ...contacts.map((c) => c.company ?? '').where((n) => n.trim().isNotEmpty),
    ...deals.map((d) => d.company ?? '').where((n) => n.trim().isNotEmpty),
  };

  String key(String s) => s.trim().toLowerCase();

  final rollups = names.map((n) {
    return CompanyRollup(
      name: n.trim(),
      record: saved.where((c) => key(c.name) == key(n)).firstOrNullCompat,
      contacts:
          contacts.where((c) => key(c.company ?? '') == key(n)).toList(),
      deals: deals.where((d) => key(d.company ?? '') == key(n)).toList(),
    );
  }).toList()
    ..sort((a, b) => b.contacts.length.compareTo(a.contacts.length));

  return rollups;
});

/// Team-wide contacts and deals, used by the company rollup.
final allTeamContactsProvider = StreamProvider<List<Contact>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <Contact>[]);
  final ds = ref.watch(remoteDataServiceProvider);
  return ds.watchList(
    () => ds
        .list(AppConstants.colContacts, where: [WhereEq('teamId', teamId)], limit: 500)
        .then((docs) => docs.map(Contact.fromFirestore).toList()),
  );
});

final allTeamDealsProvider = StreamProvider<List<Deal>>((ref) {
  final teamId = ref.watch(currentTeamIdProvider);
  if (teamId.isEmpty) return Stream.value(const <Deal>[]);
  final ds = ref.watch(remoteDataServiceProvider);
  return ds.watchList(
    () => ds
        .list(AppConstants.colDeals, where: [WhereEq('teamId', teamId)], limit: 500)
        .then((docs) => docs.map(Deal.fromFirestore).toList()),
  );
});

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNullCompat => isEmpty ? null : first;
}

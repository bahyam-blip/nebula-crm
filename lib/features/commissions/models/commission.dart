import 'package:cloud_firestore/cloud_firestore.dart';

/// How the workspace pays out on a subscription sale.
///
/// Owned by the super admin. Stored once per team so a rate change applies
/// to future sales only — commissions already earned keep the amount that
/// was in force when the sale closed, which is the whole point of writing
/// the amount onto the record instead of recomputing it.
class CommissionSettings {
  const CommissionSettings({
    this.subscriptionPrice = 999,
    this.isPercentage = false,
    this.commissionValue = 100,
    this.currency = 'INR',
    this.updatedBy = '',
    this.updatedAt,
  });

  /// What the customer pays, per month.
  final double subscriptionPrice;

  /// True: commissionValue is a percentage of the price.
  /// False: commissionValue is a flat rupee amount per sale.
  final bool isPercentage;

  final double commissionValue;
  final String currency;
  final String updatedBy;
  final DateTime? updatedAt;

  /// What one sale pays the closer.
  double get payoutPerSale => isPercentage
      ? subscriptionPrice * (commissionValue / 100)
      : commissionValue;

  factory CommissionSettings.fromMap(Map<String, dynamic>? d) {
    if (d == null) return const CommissionSettings();
    return CommissionSettings(
      subscriptionPrice:
          (d['subscriptionPrice'] as num?)?.toDouble() ?? 999,
      isPercentage: d['isPercentage'] as bool? ?? false,
      commissionValue: (d['commissionValue'] as num?)?.toDouble() ?? 100,
      currency: d['currency'] as String? ?? 'INR',
      updatedBy: d['updatedBy'] as String? ?? '',
      updatedAt: (d['updatedAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toMap() => {
        'subscriptionPrice': subscriptionPrice,
        'isPercentage': isPercentage,
        'commissionValue': commissionValue,
        'currency': currency,
        'updatedBy': updatedBy,
        'updatedAt': FieldValue.serverTimestamp(),
      };
}

/// Where a commission stands between being earned and being paid.
enum CommissionStatus { pending, approved, paid, cancelled }

extension CommissionStatusX on CommissionStatus {
  String get label {
    switch (this) {
      case CommissionStatus.pending:
        return 'Pending';
      case CommissionStatus.approved:
        return 'Approved';
      case CommissionStatus.paid:
        return 'Paid';
      case CommissionStatus.cancelled:
        return 'Cancelled';
    }
  }

  /// Cancelled commissions are excluded from every total.
  bool get counts => this != CommissionStatus.cancelled;

  static CommissionStatus parse(String? s) => CommissionStatus.values
      .firstWhere((v) => v.name == s, orElse: () => CommissionStatus.pending);
}

/// One earned commission, written the moment a lead is marked converted.
class Commission {
  const Commission({
    required this.id,
    required this.teamId,
    required this.salesPersonId,
    required this.salesPersonName,
    required this.amount,
    required this.subscriptionPrice,
    this.contactId = '',
    this.contactName = '',
    this.status = CommissionStatus.pending,
    this.note,
    this.createdAt,
    this.settledAt,
  });

  final String id;
  final String teamId;
  final String salesPersonId;
  final String salesPersonName;

  /// Frozen at the rate in force when the sale closed.
  final double amount;
  final double subscriptionPrice;

  final String contactId;
  final String contactName;
  final CommissionStatus status;
  final String? note;
  final DateTime? createdAt;
  final DateTime? settledAt;

  factory Commission.fromFirestore(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>? ?? {};
    return Commission(
      id: doc.id,
      teamId: d['teamId'] as String? ?? '',
      salesPersonId: d['salesPersonId'] as String? ?? '',
      salesPersonName: d['salesPersonName'] as String? ?? '',
      amount: (d['amount'] as num?)?.toDouble() ?? 0,
      subscriptionPrice: (d['subscriptionPrice'] as num?)?.toDouble() ?? 0,
      contactId: d['contactId'] as String? ?? '',
      contactName: d['contactName'] as String? ?? '',
      status: CommissionStatusX.parse(d['status'] as String?),
      note: d['note'] as String?,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
      settledAt: (d['settledAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() => {
        'teamId': teamId,
        'salesPersonId': salesPersonId,
        'salesPersonName': salesPersonName,
        'amount': amount,
        'subscriptionPrice': subscriptionPrice,
        'contactId': contactId,
        'contactName': contactName,
        'status': status.name,
        'note': note,
        'createdAt': FieldValue.serverTimestamp(),
      };
}

/// Per-person totals for the leaderboard.
class EarningsRow {
  EarningsRow({required this.userId, required this.name});

  final String userId;
  final String name;
  int sales = 0;
  double earned = 0;
  double paid = 0;
  double revenue = 0;

  double get outstanding => earned - paid;
}

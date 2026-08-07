import 'package:cloud_firestore/cloud_firestore.dart';

import '../../../core/constants/app_constants.dart';
import '../models/contact.dart';

/// One parsed row, with whatever problems we found on it.
class CsvRow {
  CsvRow({
    required this.lineNumber,
    required this.values,
    this.error,
  });

  final int lineNumber;
  final Map<String, String> values;
  String? error;

  bool get isValid => error == null;

  String? get name => _pick(['name', 'full name', 'fullname', 'contact name']);
  String? get email => _pick(['email', 'email address', 'e-mail']);
  String? get phone =>
      _pick(['phone', 'mobile', 'phone number', 'contact number', 'number']);
  String? get company => _pick(['company', 'organisation', 'organization']);
  String? get jobTitle => _pick(['title', 'job title', 'designation', 'role']);
  String? get notes => _pick(['notes', 'note', 'remarks', 'comments']);
  String? get city => _pick(['city', 'location', 'address']);

  String? _pick(List<String> keys) {
    for (final k in keys) {
      final v = values[k];
      if (v != null && v.trim().isNotEmpty) return v.trim();
    }
    return null;
  }
}

class CsvParseResult {
  CsvParseResult({
    required this.headers,
    required this.rows,
  });

  final List<String> headers;
  final List<CsvRow> rows;

  List<CsvRow> get validRows => rows.where((r) => r.isValid).toList();
  List<CsvRow> get invalidRows => rows.where((r) => !r.isValid).toList();
}

/// Parses and imports contacts from CSV.
///
/// Written without a CSV package dependency: the parser below handles
/// quoted fields, embedded commas, escaped quotes and CRLF, which covers
/// what Excel and Google Sheets actually emit.
class CsvImportService {
  CsvImportService(this._db);

  final FirebaseFirestore _db;

  /// Firestore caps a batch at 500 writes.
  static const int _batchLimit = 400;

  // ── Parsing ──────────────────────────────────────────────────

  /// Split raw CSV text into rows of fields (RFC 4180-ish).
  static List<List<String>> tokenise(String input) {
    final rows = <List<String>>[];
    var field = StringBuffer();
    var row = <String>[];
    var inQuotes = false;

    for (var i = 0; i < input.length; i++) {
      final ch = input[i];

      if (inQuotes) {
        if (ch == '"') {
          // A doubled quote is a literal quote.
          if (i + 1 < input.length && input[i + 1] == '"') {
            field.write('"');
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field.write(ch);
        }
        continue;
      }

      switch (ch) {
        case '"':
          inQuotes = true;
        case ',':
          row.add(field.toString());
          field = StringBuffer();
        case '\r':
          break; // handled by \n
        case '\n':
          row.add(field.toString());
          field = StringBuffer();
          rows.add(row);
          row = <String>[];
        default:
          field.write(ch);
      }
    }

    // Trailing field / row without a newline terminator.
    if (field.isNotEmpty || row.isNotEmpty) {
      row.add(field.toString());
      rows.add(row);
    }

    return rows.where((r) => r.any((c) => c.trim().isNotEmpty)).toList();
  }

  /// Parse CSV text into validated rows keyed by lowercase header.
  static CsvParseResult parse(String csvText) {
    final table = tokenise(csvText);
    if (table.isEmpty) {
      return CsvParseResult(headers: const [], rows: const []);
    }

    final headers =
        table.first.map((h) => h.trim().toLowerCase()).toList(growable: false);
    final rows = <CsvRow>[];

    for (var i = 1; i < table.length; i++) {
      final cells = table[i];
      final map = <String, String>{};
      for (var c = 0; c < headers.length && c < cells.length; c++) {
        map[headers[c]] = cells[c].trim();
      }

      final row = CsvRow(lineNumber: i + 1, values: map);

      // A contact is useless without a name and some way to reach them.
      if ((row.name ?? '').isEmpty) {
        row.error = 'Missing name';
      } else if ((row.phone ?? '').isEmpty && (row.email ?? '').isEmpty) {
        row.error = 'Needs a phone number or an email';
      } else if (row.email != null && !_looksLikeEmail(row.email!)) {
        row.error = 'Invalid email: ${row.email}';
      }

      rows.add(row);
    }

    return CsvParseResult(headers: headers, rows: rows);
  }

  static bool _looksLikeEmail(String s) =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(s);

  /// Normalise a phone number for duplicate comparison.
  static String normalisePhone(String raw) {
    final digits = raw.replaceAll(RegExp(r'[^0-9]'), '');
    // Indian numbers are frequently stored with and without the 91 prefix.
    if (digits.length > 10) return digits.substring(digits.length - 10);
    return digits;
  }

  // ── Import ───────────────────────────────────────────────────

  /// Existing phone/email keys for a team, used to skip duplicates.
  Future<Set<String>> existingKeys(String teamId) async {
    final snap = await _db
        .collection(AppConstants.colContacts)
        .where('teamId', isEqualTo: teamId)
        .get();

    final keys = <String>{};
    for (final d in snap.docs) {
      final data = d.data();
      final phone = (data['phone'] as String?) ?? '';
      final email = (data['email'] as String?) ?? '';
      if (phone.isNotEmpty) keys.add('p:${normalisePhone(phone)}');
      if (email.isNotEmpty) keys.add('e:${email.toLowerCase()}');
    }
    return keys;
  }

  /// Write [rows] as contacts, round-robin across [assigneeIds].
  ///
  /// Returns a summary of what happened. Duplicates are skipped rather than
  /// overwritten — silently merging records loses data.
  Future<ImportSummary> import({
    required List<CsvRow> rows,
    required String teamId,
    required String importedBy,
    List<String> assigneeIds = const [],
    bool skipDuplicates = true,
    List<String> tags = const [],
    void Function(int done, int total)? onProgress,
  }) async {
    final existing = skipDuplicates ? await existingKeys(teamId) : <String>{};

    var created = 0;
    var skipped = 0;
    final seenInFile = <String>{};
    final batchQueue = <Map<String, dynamic>>[];

    for (final row in rows) {
      if (!row.isValid) {
        skipped++;
        continue;
      }

      final phone = row.phone ?? '';
      final email = row.email ?? '';
      final pKey = phone.isNotEmpty ? 'p:${normalisePhone(phone)}' : null;
      final eKey = email.isNotEmpty ? 'e:${email.toLowerCase()}' : null;

      final dupe = (pKey != null &&
              (existing.contains(pKey) || seenInFile.contains(pKey))) ||
          (eKey != null &&
              (existing.contains(eKey) || seenInFile.contains(eKey)));

      if (dupe) {
        skipped++;
        continue;
      }

      if (pKey != null) seenInFile.add(pKey);
      if (eKey != null) seenInFile.add(eKey);

      // Round-robin assignment across the selected telecallers.
      final assignee = assigneeIds.isEmpty
          ? null
          : assigneeIds[created % assigneeIds.length];

      batchQueue.add({
        'name': row.name,
        'email': email.isEmpty ? null : email,
        'phone': phone.isEmpty ? null : phone,
        'company': row.company,
        'jobTitle': row.jobTitle,
        'address': row.city,
        'notes': row.notes,
        'status': ContactStatus.lead.name,
        'ownerId': assignee,
        'assignedTo': assignee,
        'assignedAt':
            assignee == null ? null : FieldValue.serverTimestamp(),
        'assignedBy': assignee == null ? null : importedBy,
        'teamId': teamId,
        'tags': tags,
        'segments': <String>[],
        'callStatus': CallStatus.notCalled.name,
        'callAttempts': 0,
        'source': 'csv_import',
        'importedBy': importedBy,
        'lifetimeValue': 0,
        'activityCount': 0,
        'openDealsCount': 0,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'lastActivityAt': FieldValue.serverTimestamp(),
      });

      created++;
    }

    // Commit in chunks under the 500-write batch cap.
    for (var i = 0; i < batchQueue.length; i += _batchLimit) {
      final end = (i + _batchLimit).clamp(0, batchQueue.length);
      final batch = _db.batch();
      for (final data in batchQueue.sublist(i, end)) {
        batch.set(_db.collection(AppConstants.colContacts).doc(), data);
      }
      await batch.commit();
      onProgress?.call(end, batchQueue.length);
    }

    return ImportSummary(
      created: created,
      skipped: skipped,
      assignedTo: assigneeIds.length,
    );
  }
}

class ImportSummary {
  const ImportSummary({
    required this.created,
    required this.skipped,
    required this.assignedTo,
  });

  final int created;
  final int skipped;
  final int assignedTo;
}

/// Where a lead sits in the calling workflow.
///
/// Deliberately separate from [ContactStatus], which tracks the marketing
/// funnel. A telecaller cares about "did I reach them", not "are they an MQL".
enum CallStatus {
  notCalled,
  attempted,
  connected,
  callback,
  interested,
  notInterested,
  wrongNumber,
  doNotCall,
  converted,
}

extension CallStatusX on CallStatus {
  String get label {
    switch (this) {
      case CallStatus.notCalled:
        return 'Not called';
      case CallStatus.attempted:
        return 'Attempted';
      case CallStatus.connected:
        return 'Connected';
      case CallStatus.callback:
        return 'Callback';
      case CallStatus.interested:
        return 'Interested';
      case CallStatus.notInterested:
        return 'Not interested';
      case CallStatus.wrongNumber:
        return 'Wrong number';
      case CallStatus.doNotCall:
        return 'Do not call';
      case CallStatus.converted:
        return 'Converted';
    }
  }

  /// Leads still worth a telecaller's time.
  bool get isOpen =>
      this == CallStatus.notCalled ||
      this == CallStatus.attempted ||
      this == CallStatus.callback ||
      this == CallStatus.interested;

  static CallStatus parse(String? s) => CallStatus.values.firstWhere(
        (v) => v.name == s,
        orElse: () => CallStatus.notCalled,
      );
}

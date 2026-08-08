import 'package:cloud_firestore/cloud_firestore.dart';

import '../../../core/constants/app_constants.dart';
import '../models/call_status.dart';
import '../models/contact.dart';

/// One parsed row, with whatever problems we found on it.
class CsvRow {
  CsvRow({
    required this.lineNumber,
    required this.cells,
    this.name,
    this.email,
    this.phone,
    this.company,
    this.jobTitle,
    this.notes,
    this.city,
    this.error,
  });

  final int lineNumber;
  final List<String> cells;
  String? name;
  String? email;
  String? phone;
  String? company;
  String? jobTitle;
  String? notes;
  String? city;
  String? error;

  bool get isValid => error == null;
}

/// Which column feeds which field, worked out from the header row.
class ColumnMap {
  ColumnMap({
    this.name = -1,
    this.email = -1,
    this.phone = -1,
    this.company = -1,
    this.jobTitle = -1,
    this.notes = -1,
    this.city = -1,
  });

  int name;
  int email;
  int phone;
  int company;
  int jobTitle;
  int notes;
  int city;

  /// Human summary so the user can see what we understood.
  List<String> describe(List<String> headers) {
    String at(int i) => i >= 0 && i < headers.length ? headers[i] : '-';
    final out = <String>[];
    if (name >= 0) out.add('Name <- ${at(name)}');
    if (phone >= 0) out.add('Phone <- ${at(phone)}');
    if (email >= 0) out.add('Email <- ${at(email)}');
    if (company >= 0) out.add('Company <- ${at(company)}');
    if (jobTitle >= 0) out.add('Title <- ${at(jobTitle)}');
    if (city >= 0) out.add('Address <- ${at(city)}');
    if (notes >= 0) out.add('Notes <- ${at(notes)}');
    return out;
  }
}

class CsvParseResult {
  CsvParseResult({
    required this.headers,
    required this.rows,
    required this.mapping,
  });

  final List<String> headers;
  final List<CsvRow> rows;
  final ColumnMap mapping;

  List<CsvRow> get validRows => rows.where((r) => r.isValid).toList();
  List<CsvRow> get invalidRows => rows.where((r) => !r.isValid).toList();
}

class CsvImportService {
  CsvImportService(this._db);

  final FirebaseFirestore _db;

  /// Firestore caps a batch at 500 writes.
  static const int _batchLimit = 400;

  // ── Parsing ──────────────────────────────────────────────────

  /// Split raw CSV text into rows of fields (RFC 4180-ish).
  ///
  /// [delimiter] defaults to comma but exports from Indian and European
  /// tools frequently use semicolons or tabs, so it is detected per file.
  static List<List<String>> tokenise(String input, {String delimiter = ','}) {
    final rows = <List<String>>[];
    var field = StringBuffer();
    var row = <String>[];
    var inQuotes = false;

    for (var i = 0; i < input.length; i++) {
      final ch = input[i];

      if (inQuotes) {
        if (ch == '"') {
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

      if (ch == '"') {
        inQuotes = true;
      } else if (ch == delimiter) {
        row.add(field.toString());
        field = StringBuffer();
      } else if (ch == '\r') {
        // Part of a CRLF pair; the \n does the work.
      } else if (ch == '\n') {
        row.add(field.toString());
        field = StringBuffer();
        rows.add(row);
        row = <String>[];
      } else {
        field.write(ch);
      }
    }

    if (field.isNotEmpty || row.isNotEmpty) {
      row.add(field.toString());
      rows.add(row);
    }

    return rows.where((r) => r.any((c) => c.trim().isNotEmpty)).toList();
  }

  /// Guess the delimiter from the header line.
  static String detectDelimiter(String input) {
    final firstLine = input.split('\n').first;
    var best = ',';
    var bestCount = 0;
    for (final d in [',', ';', '\t', '|']) {
      final n = firstLine.split(d).length - 1;
      if (n > bestCount) {
        bestCount = n;
        best = d;
      }
    }
    return best;
  }

  static final RegExp _emailRe =
      RegExp(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}');

  /// Indian mobile numbers, with or without +91, and generic 8-15 digit runs.
  static final RegExp _phoneRe = RegExp(r'(?:\+?91[\-\s]?)?[0-9][0-9\-\s]{7,16}[0-9]');

  /// Pull the first email out of a cell that may hold several.
  static String? firstEmail(String cell) {
    final m = _emailRe.firstMatch(cell);
    return m?.group(0);
  }

  /// Pull the first usable phone number out of a cell.
  static String? firstPhone(String cell) {
    for (final m in _phoneRe.allMatches(cell)) {
      final digits = (m.group(0) ?? '').replaceAll(RegExp(r'[^0-9]'), '');
      if (digits.length >= 8 && digits.length <= 13) return digits;
    }
    return null;
  }

  /// Reduce a header to letters only, so "Phone No." and "phone_no" match.
  static String _norm(String h) =>
      h.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

  /// Work out which column feeds which field.
  ///
  /// Header names vary wildly between exports - this file used "emails" and
  /// "phones", which an exact-match list missed entirely and rejected all
  /// 15,099 rows. Matching is therefore by synonym AND substring, and
  /// anything still unmapped is recovered by scanning cell contents.
  static ColumnMap mapColumns(List<String> headers, List<List<String>> sample) {
    const synonyms = <String, List<String>>{
      'name': [
        'name', 'names', 'fullname', 'full', 'contactname', 'customername',
        'clientname', 'person', 'contact', 'customer', 'client', 'advocate',
        'lawyer', 'owner', 'leadname', 'firstname'
      ],
      'email': ['email', 'emails', 'mail', 'mails', 'emailaddress', 'eid'],
      'phone': [
        'phone', 'phones', 'mobile', 'mobiles', 'phonenumber', 'phoneno',
        'mobileno', 'contactnumber', 'contactno', 'number', 'cell',
        'whatsapp', 'tel', 'telephone', 'msisdn'
      ],
      'company': [
        'company', 'companyname', 'organisation', 'organization', 'org',
        'firm', 'business', 'account', 'employer'
      ],
      'jobTitle': ['title', 'jobtitle', 'designation', 'role', 'position'],
      'city': [
        'city', 'address', 'location', 'area', 'town', 'district', 'state',
        'addresscontext', 'place'
      ],
      'notes': [
        'notes', 'note', 'remark', 'remarks', 'comment', 'comments',
        'description', 'details', 'source', 'context'
      ],
    };

    final normalised = headers.map(_norm).toList();
    final map = ColumnMap();

    int findFor(String field, {List<int> taken = const []}) {
      final keys = synonyms[field]!;
      // Exact match wins over a substring match.
      for (final k in keys) {
        for (var i = 0; i < normalised.length; i++) {
          if (taken.contains(i)) continue;
          if (normalised[i] == k) return i;
        }
      }
      for (final k in keys) {
        for (var i = 0; i < normalised.length; i++) {
          if (taken.contains(i)) continue;
          if (normalised[i].contains(k)) return i;
        }
      }
      return -1;
    }

    final taken = <int>[];
    void assign(String field, void Function(int) set) {
      final i = findFor(field, taken: taken);
      if (i >= 0) {
        set(i);
        taken.add(i);
      }
    }

    // Order matters: phone/email are the most distinctive, and "contact"
    // appears in both "contact name" and "contact number".
    assign('email', (i) => map.email = i);
    assign('phone', (i) => map.phone = i);
    assign('name', (i) => map.name = i);
    assign('company', (i) => map.company = i);
    assign('jobTitle', (i) => map.jobTitle = i);
    assign('city', (i) => map.city = i);
    assign('notes', (i) => map.notes = i);

    // Recover anything the headers did not reveal by looking at the data.
    // This is what makes an unlabelled or oddly-labelled export still work.
    if (sample.isNotEmpty) {
      final cols = headers.length;
      List<String> column(int i) => sample
          .where((r) => i < r.length)
          .map((r) => r[i])
          .toList();

      if (map.email < 0) {
        for (var i = 0; i < cols; i++) {
          if (taken.contains(i)) continue;
          final hits = column(i).where((v) => _emailRe.hasMatch(v)).length;
          if (hits > sample.length * 0.5) {
            map.email = i;
            taken.add(i);
            break;
          }
        }
      }
      if (map.phone < 0) {
        for (var i = 0; i < cols; i++) {
          if (taken.contains(i)) continue;
          final hits = column(i).where((v) => firstPhone(v) != null).length;
          if (hits > sample.length * 0.5) {
            map.phone = i;
            taken.add(i);
            break;
          }
        }
      }
      if (map.name < 0) {
        // A name column is mostly letters and mostly unique.
        for (var i = 0; i < cols; i++) {
          if (taken.contains(i)) continue;
          final vals = column(i).where((v) => v.trim().isNotEmpty).toList();
          if (vals.isEmpty) continue;
          final wordy = vals
              .where((v) =>
                  RegExp(r'^[A-Za-z][A-Za-z .,\-]{1,60}$').hasMatch(v.trim()))
              .length;
          if (wordy > vals.length * 0.7) {
            map.name = i;
            taken.add(i);
            break;
          }
        }
      }
    }

    return map;
  }

  /// Parse CSV text into validated rows.
  static CsvParseResult parse(String csvText) {
    final delimiter = detectDelimiter(csvText);
    final table = tokenise(csvText, delimiter: delimiter);
    if (table.isEmpty) {
      return CsvParseResult(
          headers: const [], rows: const [], mapping: ColumnMap());
    }

    final headers = table.first.map((h) => h.trim()).toList();
    final body = table.skip(1).toList();
    final sample = body.take(40).toList();
    final map = mapColumns(headers, sample);

    final rows = <CsvRow>[];
    for (var i = 0; i < body.length; i++) {
      final cells = body[i];
      String? at(int idx) {
        if (idx < 0 || idx >= cells.length) return null;
        final v = cells[idx].trim();
        return v.isEmpty ? null : v;
      }

      final row = CsvRow(lineNumber: i + 2, cells: cells);
      row.name = at(map.name);
      row.company = at(map.company);
      row.jobTitle = at(map.jobTitle);
      row.city = at(map.city);
      row.notes = at(map.notes);

      // Cells often hold several values; take the first usable one.
      final rawEmail = at(map.email);
      row.email = rawEmail == null ? null : firstEmail(rawEmail);
      final rawPhone = at(map.phone);
      row.phone = rawPhone == null ? null : firstPhone(rawPhone);

      // Last resort: scan the whole row. Better to find a number in an
      // unexpected column than to reject a usable lead.
      if (row.email == null) {
        for (final c in cells) {
          final e = firstEmail(c);
          if (e != null) {
            row.email = e;
            break;
          }
        }
      }
      if (row.phone == null) {
        for (var c = 0; c < cells.length; c++) {
          if (c == map.email) continue;
          final ph = firstPhone(cells[c]);
          if (ph != null) {
            row.phone = ph;
            break;
          }
        }
      }
      if (row.name == null || row.name!.isEmpty) {
        // Fall back to the local part of the email rather than dropping it.
        if (row.email != null) row.name = row.email!.split('@').first;
      }

      if ((row.name ?? '').isEmpty) {
        row.error = 'No name found';
      } else if ((row.phone ?? '').isEmpty && (row.email ?? '').isEmpty) {
        row.error = 'No phone or email found';
      }

      rows.add(row);
    }

    return CsvParseResult(headers: headers, rows: rows, mapping: map);
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

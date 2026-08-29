import 'package:cloud_firestore/cloud_firestore.dart';

/// Wire codec for the Cloudflare D1 document API.
///
/// Mirrors `cloudflare/worker/src/data.js` exactly. Rich values travel as
/// typed markers inside plain JSON; on the way back they are hydrated into
/// the SAME cloud_firestore objects the models have always parsed — so
/// `Contact.fromFirestore`-style parsers keep working unmodified.
///
///   Dart → server : Timestamp/DateTime  → {"__type":"ts","v":ISO}
///                   ServerTimestamp()   → {"__type":"svts"}
///                   Inc(n)              → {"__type":"inc","n":n}
///                   ArrayUnion/Remove   → {"__type":"aunion|aremove","v":[…]}
///   server → Dart : {"__type":"ts",…}   → Timestamp  (everything else as-is)

/// One document, shape-compatible with what the model parsers need.
class DataDoc {
  const DataDoc(this.id, this.data);
  final String id;
  final Map<String, dynamic> data;
}

/// Write-time sentinel: server stamps the current time (FieldValue.serverTimestamp).
class ServerTimestamp {
  const ServerTimestamp();
}

/// Write-time sentinel: numeric increment (FieldValue.increment).
class Inc {
  const Inc(this.n);
  final num n;
}

/// Write-time sentinel: arrayUnion.
class ArrayUnion {
  const ArrayUnion(this.values);
  final List<dynamic> values;
}

/// Write-time sentinel: arrayRemove.
class ArrayRemove {
  const ArrayRemove(this.values);
  final List<dynamic> values;
}

/// Marker → Timestamp (or passthrough for anything that is not a marker).
dynamic decodeValue(dynamic v) {
  if (v is Map<String, dynamic>) {
    if (v['__type'] == 'ts' && v['v'] is String) {
      return Timestamp.fromDate(DateTime.parse(v['v'] as String).toUtc());
    }
    return {for (final e in v.entries) e.key: decodeValue(e.value)};
  }
  if (v is List) return v.map(decodeValue).toList();
  return v;
}

/// Dart value → JSON-safe form (sentinels + Timestamp markers, recursive).
dynamic encodeValue(dynamic v) {
  if (v is ServerTimestamp) return {'__type': 'svts'};
  if (v is Inc) return {'__type': 'inc', 'n': v.n};
  if (v is ArrayUnion) return {'__type': 'aunion', 'v': v.values.map(encodeValue).toList()};
  if (v is ArrayRemove) return {'__type': 'aremove', 'v': v.values.map(encodeValue).toList()};
  if (v is Timestamp) return {'__type': 'ts', 'v': v.toDate().toUtc().toIso8601String()};
  if (v is DateTime) return {'__type': 'ts', 'v': v.toUtc().toIso8601String()};
  if (v is Map<String, dynamic>) return {for (final e in v.entries) e.key: encodeValue(e.value)};
  if (v is Map) return {for (final e in v.entries) e.key.toString(): encodeValue(e.value)};
  if (v is List) return v.map(encodeValue).toList();
  return v;
}

/// Decode a full payload map.
Map<String, dynamic> decodeData(Map<String, dynamic> raw) =>
    {for (final e in raw.entries) e.key: decodeValue(e.value)};

/// Encode a full payload map.
Map<String, dynamic> encodeData(Map<String, dynamic> raw) =>
    {for (final e in raw.entries) e.key: encodeValue(e.value)};

/// Tolerant timestamp reader for model parsers.
///
/// Rows reach the app from three writers: this app (Timestamp markers),
/// the Worker's server-side stamps, and the Firestore migration. The
/// server stamps used to land as PLAIN ISO strings (and `serverTimestamp`
/// sentinels still resolve to them), so `value as Timestamp?` threw a
/// TypeError for whole collections — contacts, campaigns, even the signed-in
/// user's own profile. This accepts every shape that has ever been stored:
///
///   Timestamp            → .toDate()
///   {__type:'ts', v:ISO} → parsed (defensive; decodeValue already hydrates)
///   "2026-…T…Z" (String) → DateTime.tryParse
///   epoch millis (num)   → DateTime.fromMillisecondsSinceEpoch
///   anything else        → null
DateTime? flexTs(dynamic v) {
  if (v == null) return null;
  if (v is Timestamp) return v.toDate();
  if (v is DateTime) return v;
  if (v is String) {
    final s = v.trim();
    if (s.isEmpty) return null;
    return DateTime.tryParse(s)?.toUtc();
  }
  if (v is num) {
    // Heuristic: plain seconds vs milliseconds. Nothing in the CRM stores
    // epoch-second dates, but the cost of supporting both is one comparison.
    final ms = v > 1e11 ? v.toInt() : (v * 1000).toInt();
    return DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
  }
  if (v is Map && v['__type'] == 'ts' && v['v'] is String) {
    return DateTime.tryParse(v['v'] as String)?.toUtc();
  }
  return null;
}

/// Tolerant string-list reader. One non-string element (a number from CSV
/// import, a map written by an older build) used to throw for the WHOLE
/// list and crash the screen it fed. Elements are stringified instead.
List<String> stringList(dynamic v) {
  if (v is List) return v.map((e) => e?.toString() ?? '').where((s) => true).toList();
  if (v is String) return v.isEmpty ? const [] : [v];
  return const [];
}

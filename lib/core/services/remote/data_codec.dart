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

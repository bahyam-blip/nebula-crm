import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../storage_service.dart' show kStorageBaseUrl;
import 'data_codec.dart';

/// Exception surfaced by the data API.
class DataApiException implements Exception {
  const DataApiException(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => 'DataApiException($status): $message';
}

/// A single equality filter — the only operator the old Firestore queries
/// ever used (`isEqualTo`), so it is the only one the API needs.
class WhereEq {
  const WhereEq(this.field, this.value);
  final String field;
  final dynamic value;
}

/// One write inside a [RemoteDataSource.batch].
class BatchOp {
  BatchOp.set(this.col, this.data, {this.id, this.merge = true}) : op = 'set';
  BatchOp.update(this.col, this.id, this.data)
      : op = 'update',
        merge = true;
  BatchOp.delete(this.col, this.id)
      : op = 'delete',
        data = null,
        merge = false;
  final String op; // set | update | delete
  final String col;
  final String? id;
  final Map<String, dynamic>? data;
  final bool merge;
}

/// The CRM database client — every byte of app data now lives in
/// Cloudflare D1 behind the Worker. Google Sign-In stays on Firebase and
/// its ID token is what authorizes every call.
class RemoteDataSource {
  RemoteDataSource(this._ref, {http.Client? client})
      : _client = client ?? http.Client();

  final Ref _ref;
  final http.Client _client;

  static final String _baseUrl =
      kStorageBaseUrl.replaceAll(RegExp(r'/+$'), '');

  Future<String> _token() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw const DataApiException(401, 'not signed in');
    final token = await user.getIdToken();
    if (token.isEmpty) throw const DataApiException(401, 'empty id token');
    return token;
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final token = await _token();
    final res = await _client.post(
      Uri.parse('$_baseUrl$path'),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(body),
    );
    final text = res.body;
    Map<String, dynamic> json;
    try {
      json = jsonDecode(text) as Map<String, dynamic>;
    } catch (_) {
      throw DataApiException(res.statusCode, 'non-JSON reply: ${text.substring(0, text.length.clamp(0, 200))}');
    }
    if (res.statusCode >= 400) {
      throw DataApiException(res.statusCode, (json['error'] as String?) ?? 'request failed');
    }
    return json;
  }

  // ── Reads ──

  /// List documents of [col], scoped server-side to the caller's team.
  Future<List<DataDoc>> list(
    String col, {
    List<WhereEq>? where,
    int limit = 100,
    bool orderByIdDesc = false,
  }) async {
    final res = await _post('/v1/data/query', {
      'col': col,
      'where': (where ?? const [])
          .map((w) => {'field': w.field, 'op': '==', 'value': encodeValue(w.value)})
          .toList(),
      'limit': limit,
      'orderByIdDesc': orderByIdDesc,
    });
    final docs = (res['docs'] as List? ?? const []);
    return docs
        .map((d) => DataDoc(
              (d as Map)['id'] as String,
              decodeData(Map<String, dynamic>.from((d)['data'] as Map)),
            ))
        .toList();
  }

  Future<DataDoc?> get(String col, String id) async {
    final res = await _post('/v1/data/get', {'col': col, 'id': id});
    final doc = res['doc'];
    if (doc == null) return null;
    final map = Map<String, dynamic>.from(doc as Map);
    return DataDoc(map['id'] as String, decodeData(Map<String, dynamic>.from(map['data'] as Map)));
  }

  // ── Writes ──

  /// Create-or-merge. Omit [id] to let the server generate one.
  Future<String> set(String col, String? id, Map<String, dynamic> data, {bool merge = true}) async {
    final res = await _post('/v1/data/set', {
      'col': col,
      if (id != null) 'id': id,
      'data': encodeData(data),
      'merge': merge,
    });
    return res['id'] as String;
  }

  /// Shallow-merge patch into an existing document.
  Future<void> update(String col, String id, Map<String, dynamic> patch) async {
    await set(col, id, patch, merge: true);
  }

  Future<void> delete(String col, String id) async {
    await _post('/v1/data/delete', {'col': col, 'id': id});
  }

  /// Apply several writes in one round trip (mirrors Firestore batches).
  Future<void> batch(List<BatchOp> ops) async {
    await _post('/v1/data/batch', {
      'ops': ops
          .map((o) => {
                'op': o.op,
                'col': o.col,
                if (o.id != null) 'id': o.id,
                if (o.data != null) 'data': encodeData(o.data!),
                'merge': o.merge,
              })
          .toList(),
    });
  }

  // ── Auth bootstrap ──

  /// Create/refresh the signed-in user's profile server-side and return it.
  /// This is what replaced the whole Firestore signup dance: the Worker
  /// claims the workspace for the first user, adopts invites, ensures the
  /// team and seeds capabilities.
  Future<DataDoc> bootstrap() async {
    final res = await _post('/v1/data/bootstrap', {});
    final user = Map<String, dynamic>.from(res['user'] as Map);
    return DataDoc(user['id'] as String, decodeData(user));
  }

  // ── Realtime-ish helpers ──

  /// Single-value variant of [watchList] — for profile/settings streams.
  Stream<T> watch(
    Future<T> Function() fetch, {
    Duration interval = const Duration(seconds: 30),
  }) {
    late StreamController<T> controller;
    Timer? timer;
    var busy = false;

    Future<void> tick() async {
      if (busy || !controller.hasListener) return;
      busy = true;
      try {
        final value = await fetch();
        if (!controller.isClosed) controller.add(value);
      } catch (e) {
        if (!controller.isClosed) controller.addError(e);
      } finally {
        busy = false;
      }
    }

    controller = StreamController<T>(
      onListen: () async {
        await tick();
        timer = Timer.periodic(interval, (_) => tick());
      },
      onPause: () => timer?.cancel(),
      onResume: () => timer = Timer.periodic(interval, (_) => tick()),
      onCancel: () {
        timer?.cancel();
        timer = null;
      },
    );
    return controller.stream;
  }

  //
  // Firestore gave us push updates via snapshots(); D1 does not. These
  // wrappers give the same Stream<List<T>> API the screens already consume,
  // driven by polling: instant first fetch, then a steady tick. The timer
  // only runs while someone is actually listening.

  Stream<List<T>> watchList<T>(
    Future<List<T>> Function() fetch, {
    Duration interval = const Duration(seconds: 20),
  }) {
    late StreamController<List<T>> controller;
    Timer? timer;
    var busy = false;

    Future<void> tick() async {
      if (busy || !controller.hasListener) return;
      busy = true;
      try {
        final items = await fetch();
        if (!controller.isClosed) controller.add(items);
      } catch (e) {
        if (!controller.isClosed) controller.addError(e);
      } finally {
        busy = false;
      }
    }

    controller = StreamController<List<T>>(
      onListen: () async {
        await tick();
        timer = Timer.periodic(interval, (_) => tick());
      },
      onPause: () => timer?.cancel(),
      onResume: () => timer = Timer.periodic(interval, (_) => tick()),
      onCancel: () {
        timer?.cancel();
        timer = null;
      },
    );
    return controller.stream;
  }
}

final remoteDataServiceProvider = Provider<RemoteDataSource>((ref) {
  return RemoteDataSource(ref);
});

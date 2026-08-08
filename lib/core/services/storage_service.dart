import 'dart:io';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

/// Base URL of the Cloudflare Worker that brokers R2 access.
///
/// Overridable at build time:
///   flutter build apk --dart-define=STORAGE_BASE_URL=https://...workers.dev
const String kStorageBaseUrl = String.fromEnvironment(
  'STORAGE_BASE_URL',
  // Must be the real deployed host. The previous default omitted the
  // account subdomain, so any avatar uploaded from a build without the
  // STORAGE_BASE_URL variable was saved pointing at a host that does not
  // exist - the image then failed silently and fell back to initials,
  // which looked like the photo had been wiped.
  defaultValue: 'https://nebula-crm-storage.nebula-crm.workers.dev',
);

/// Rewrite a stored media URL against the current storage host.
///
/// Existing records may hold a URL built with an older or wrong host. The
/// object key is the durable part, so re-point the URL at render time
/// rather than migrating every document.
String resolveMediaUrl(String? url) {
  if (url == null || url.isEmpty) return '';
  const marker = '/v1/file/';
  final i = url.indexOf(marker);
  if (i == -1) return url;
  return '$kStorageBaseUrl$marker${url.substring(i + marker.length)}';
}

class StorageException implements Exception {
  StorageException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Uploads media to Cloudflare R2 by way of the storage Worker.
///
/// The app holds no bucket credentials. It sends the user's Firebase ID
/// token; the Worker verifies it and decides what that user may write.
/// This is the whole reason for the Worker: an APK can be decompiled, so
/// R2 access keys can never ship inside one.
class StorageService {
  StorageService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = (baseUrl ?? kStorageBaseUrl).replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _baseUrl;

  static const Duration _timeout = Duration(seconds: 60);

  Future<String> _idToken() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      throw StorageException('You must be signed in to upload files.');
    }
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw StorageException('Could not obtain an auth token.');
    }
    return token;
  }

  /// Upload raw [bytes] to [key], returning the public URL.
  ///
  /// Keys are namespaced by purpose (`avatars/{uid}/…`, `contacts/{id}/…`);
  /// the Worker enforces that a user can only write to their own avatar.
  Future<String> uploadBytes({
    required String key,
    required Uint8List bytes,
    required String contentType,
  }) async {
    final token = await _idToken();
    final uri = Uri.parse(
      '$_baseUrl/v1/upload?path=${Uri.encodeQueryComponent(key)}',
    );

    late http.Response res;
    try {
      res = await _client
          .post(
            uri,
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': contentType,
            },
            body: bytes,
          )
          .timeout(_timeout);
    } on SocketException {
      throw StorageException('No connection. Check your network and retry.');
    } catch (e) {
      throw StorageException('Upload failed: $e');
    }

    if (res.statusCode == 200) {
      // The Worker echoes the canonical URL; fall back to composing it.
      final body = res.body;
      final match = RegExp(r'"url"\s*:\s*"([^"]+)"').firstMatch(body);
      if (match != null) return match.group(1)!.replaceAll(r'\/', '/');
      return publicUrl(key);
    }

    throw StorageException(_explain(res.statusCode, res.body));
  }

  Future<String> uploadFile({
    required String key,
    required File file,
    required String contentType,
  }) async {
    final bytes = await file.readAsBytes();
    return uploadBytes(key: key, bytes: bytes, contentType: contentType);
  }

  Future<void> delete(String key) async {
    final token = await _idToken();
    final res = await _client
        .delete(
          Uri.parse('$_baseUrl/v1/file/${Uri.encodeComponent(key)}'),
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(_timeout);
    if (res.statusCode != 200) {
      throw StorageException(_explain(res.statusCode, res.body));
    }
  }

  String publicUrl(String key) =>
      '$_baseUrl/v1/file/${Uri.encodeComponent(key)}';

  /// Unique-ish key for a user's avatar.
  ///
  /// The timestamp busts caches: the Worker serves media as immutable, so
  /// a fixed filename would leave the old photo showing after a change.
  static String avatarKey(String uid, String extension) =>
      'avatars/$uid/${DateTime.now().millisecondsSinceEpoch}.$extension';

  static String attachmentKey(
    String collection,
    String recordId,
    String filename,
  ) {
    final safe = filename.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    return '$collection/$recordId/${DateTime.now().millisecondsSinceEpoch}_$safe';
  }

  static String contentTypeFor(String path) {
    final ext = path.split('.').last.toLowerCase();
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'pdf':
        return 'application/pdf';
      case 'txt':
      case 'csv':
        return 'text/plain';
      default:
        return 'application/octet-stream';
    }
  }

  String _explain(int status, String body) {
    switch (status) {
      case 401:
        return 'Your session expired. Sign in again and retry.';
      case 403:
        return 'You do not have permission to upload here.';
      case 413:
        return 'That file is too large. The limit is 25 MB.';
      case 415:
        return 'That file type is not supported.';
      default:
        return 'Upload failed ($status). ${body.length > 120 ? '' : body}';
    }
  }
}

final storageServiceProvider = Provider<StorageService>((ref) {
  return StorageService();
});

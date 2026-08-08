import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../constants/app_constants.dart';
import 'notification_service.dart';
import 'storage_service.dart' show kStorageBaseUrl;

/// Cross-user push, delivered through Cloudflare rather than Cloud Functions.
///
/// FCM is free; it is Cloud Functions that needs Blaze billing. So the
/// Worker does the job Functions would have done: it holds the service
/// account, resolves who should be notified, and calls the FCM v1 API. The
/// app only ever says "tell these people this" — it cannot address devices
/// directly, because it never sees anyone else's tokens.
class PushService {
  PushService(this._db, {http.Client? client})
      : _client = client ?? http.Client();

  final FirebaseFirestore _db;
  final http.Client _client;

  static final String _baseUrl =
      kStorageBaseUrl.replaceAll(RegExp(r'/+$'), '');

  /// Ask permission, then record this device against the signed-in user.
  ///
  /// Tokens are stored as an array so one person can be reached on their
  /// phone and tablet, and rotated tokens accumulate rather than replacing
  /// a device that is still valid.
  Future<void> registerDevice() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(
        alert: true,
        badge: false,
        sound: true,
      );
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;

      final token = await messaging.getToken();
      if (token == null || token.isEmpty) return;

      await _saveToken(user.uid, token);

      // A rotated token must replace the old one or pushes stop silently.
      messaging.onTokenRefresh.listen((t) => _saveToken(user.uid, t));

      // Foreground messages do not raise a system notification on Android,
      // so surface them through the local plugin.
      FirebaseMessaging.onMessage.listen((msg) {
        final n = msg.notification;
        if (n == null) return;
        NotificationService().showNow(n.title ?? 'Nebula CRM', n.body ?? '');
      });
    } catch (e) {
      if (kDebugMode) debugPrint('Push registration failed: $e');
    }
  }

  Future<void> _saveToken(String uid, String token) async {
    try {
      await _db.collection(AppConstants.colUsers).doc(uid).set({
        'fcmTokens': FieldValue.arrayUnion([token]),
      }, SetOptions(merge: true));
    } catch (_) {}
  }

  /// Drop this device on sign-out, so a shared handset stops receiving the
  /// previous user's notifications.
  Future<void> unregisterDevice() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      final token = await FirebaseMessaging.instance.getToken();
      if (user == null || token == null) return;
      await _db.collection(AppConstants.colUsers).doc(user.uid).set({
        'fcmTokens': FieldValue.arrayRemove([token]),
      }, SetOptions(merge: true));
    } catch (_) {}
  }

  /// Notify specific people, a role, or the whole team.
  ///
  /// Best-effort by design: a notification that fails to send must never
  /// roll back the action that triggered it. Assigning a task matters more
  /// than announcing it.
  Future<void> notify({
    required String title,
    String body = '',
    List<String>? userIds,
    String? role,
    bool everyone = false,
    Map<String, String> data = const {},
    String channel = 'tasks',
  }) async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;
      final idToken = await user.getIdToken();
      if (idToken == null) return;

      await _client
          .post(
            Uri.parse('$_baseUrl/v1/notify'),
            headers: {
              'Authorization': 'Bearer $idToken',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'title': title,
              'body': body,
              if (userIds != null && userIds.isNotEmpty) 'userIds': userIds,
              if (role != null) 'role': role,
              if (everyone) 'everyone': true,
              'data': data,
              'channel': channel,
            }),
          )
          .timeout(const Duration(seconds: 15));
    } catch (e) {
      if (kDebugMode) debugPrint('Push send failed: $e');
    }
  }
}

final pushServiceProvider = Provider<PushService>((ref) {
  return PushService(FirebaseFirestore.instance);
});

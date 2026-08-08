import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// On-device reminders for callbacks, tasks and follow-ups.
///
/// Deliberately local rather than push. Server-sent push would need Cloud
/// Functions, which needs Firebase Blaze billing, and every reminder this
/// app cares about is already known on the device that scheduled it: a
/// telecaller promising to ring back at 4pm does not need a round trip to
/// a server to be reminded. Cross-user notifications (a manager assigning
/// you a task) still need push, and are noted as such below.
class NotificationService {
  NotificationService();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  bool _ready = false;

  static const _callbackChannel = AndroidNotificationChannel(
    'callbacks',
    'Callbacks and follow-ups',
    description: 'Reminders to ring a customer back',
    importance: Importance.high,
  );

  static const _taskChannel = AndroidNotificationChannel(
    'tasks',
    'Tasks and reminders',
    description: 'Due tasks and scheduled reminders',
    importance: Importance.defaultImportance,
  );

  Future<void> init() async {
    if (_ready) return;
    try {
      tzdata.initializeTimeZones();

      const android = AndroidInitializationSettings('@mipmap/ic_launcher');
      const ios = DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: false,
        requestSoundPermission: true,
      );
      await _plugin.initialize(
        const InitializationSettings(android: android, iOS: ios),
      );

      final android0 = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      await android0?.createNotificationChannel(_callbackChannel);
      await android0?.createNotificationChannel(_taskChannel);
      // Android 13+ requires the user to opt in.
      await android0?.requestNotificationsPermission();

      _ready = true;
    } catch (e) {
      if (kDebugMode) debugPrint('Notifications unavailable: $e');
    }
  }

  /// Stable id from a document id, so rescheduling replaces rather than
  /// duplicates a reminder.
  static int idFor(String key) => key.hashCode & 0x7FFFFFFF;

  Future<void> scheduleCallback({
    required String contactId,
    required String contactName,
    required DateTime at,
    String? note,
  }) =>
      _schedule(
        id: idFor('callback:$contactId'),
        title: 'Call $contactName',
        body: note == null || note.isEmpty
            ? 'You promised to ring back now.'
            : note,
        at: at,
        channel: _callbackChannel,
      );

  Future<void> scheduleTask({
    required String taskId,
    required String title,
    required DateTime at,
    String? body,
  }) =>
      _schedule(
        id: idFor('task:$taskId'),
        title: title,
        body: body ?? 'Task due now',
        at: at,
        channel: _taskChannel,
      );

  Future<void> _schedule({
    required int id,
    required String title,
    required String body,
    required DateTime at,
    required AndroidNotificationChannel channel,
  }) async {
    await init();
    if (!_ready) return;
    // A reminder for a moment that has passed is noise.
    if (at.isBefore(DateTime.now())) return;

    try {
      await _plugin.zonedSchedule(
        id,
        title,
        body,
        tz.TZDateTime.from(at, tz.local),
        NotificationDetails(
          android: AndroidNotificationDetails(
            channel.id,
            channel.name,
            channelDescription: channel.description,
            importance: channel.importance,
            priority: Priority.high,
          ),
          iOS: const DarwinNotificationDetails(),
        ),
        // Inexact on purpose: exact alarms need a special Android 14
        // permission that users must grant in system settings, and a
        // callback reminder is fine landing a few minutes late.
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        uiLocalNotificationDateInterpretation:
            UILocalNotificationDateInterpretation.absoluteTime,
      );
    } catch (e) {
      if (kDebugMode) debugPrint('Could not schedule notification: $e');
    }
  }

  Future<void> cancel(String key) async {
    await init();
    if (!_ready) return;
    try {
      await _plugin.cancel(idFor(key));
    } catch (_) {}
  }

  Future<void> showNow(String title, String body) async {
    await init();
    if (!_ready) return;
    try {
      await _plugin.show(
        DateTime.now().millisecondsSinceEpoch & 0x7FFFFFFF,
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _taskChannel.id,
            _taskChannel.name,
            channelDescription: _taskChannel.description,
          ),
          iOS: const DarwinNotificationDetails(),
        ),
      );
    } catch (_) {}
  }
}

final notificationServiceProvider = Provider<NotificationService>((ref) {
  return NotificationService();
});

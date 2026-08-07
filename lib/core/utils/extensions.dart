import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme/app_colors.dart';

/// Common extensions on [BuildContext] for terse access to theme + nav.
extension BuildContextX on BuildContext {
  ThemeData get theme => Theme.of(this);
  TextTheme get textTheme => Theme.of(this).textTheme;
  ColorScheme get colors => Theme.of(this).colorScheme;
  Size get screenSize => MediaQuery.sizeOf(this);
  double get screenWidth => MediaQuery.sizeOf(this).width;
  double get screenHeight => MediaQuery.sizeOf(this).height;
  double get bottomPadding => MediaQuery.viewPaddingOf(this).bottom;
  double get topPadding => MediaQuery.viewPaddingOf(this).top;
  bool get isSmallScreen => screenWidth < 360;
  bool get isTablet => screenWidth >= 600;

  void showSnack(String message, {Color? color}) {
    ScaffoldMessenger.of(this).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: color ?? AppColors.surfaceHigh,
      ),
    );
  }

  void showError(String message) {
    ScaffoldMessenger.of(this).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.danger,
      ),
    );
  }

  void showSuccess(String message) {
    ScaffoldMessenger.of(this).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle, color: AppColors.success, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: AppColors.surfaceHigh,
      ),
    );
  }
}

/// Riverpod convenience: read + watch shorthand on [WidgetRef].
extension WidgetRefX on WidgetRef {
  Future<T> readAsync<T>(ProviderListenable<Future<T>> provider) async {
    return read(provider);
  }
}

/// [DateTime] helpers for ranges.
extension DateTimeX on DateTime {
  DateTime get startOfDay => DateTime(year, month, day);
  DateTime get endOfDay => DateTime(year, month, day, 23, 59, 59);
  DateTime get startOfWeek => subtract(Duration(days: weekday - 1)).startOfDay;
  DateTime get startOfMonth => DateTime(year, month);
  DateTime get endOfMonth => DateTime(year, month + 1, 0, 23, 59, 59);
  DateTime get startOfYear => DateTime(year);

  bool get isToday => startOfDay == DateTime.now().startOfDay;
  bool get isThisWeek => startOfWeek == DateTime.now().startOfWeek;
  bool get isThisMonth => startOfMonth == DateTime.now().startOfMonth;
  bool get isThisYear => year == DateTime.now().year;

  /// Days until [other] (positive if [other] is in the future).
  int daysUntil(DateTime other) => other.difference(this).inDays;
}

/// [num] / [double] helpers for chart math.
extension NumX on num {
  double toPercent() => this / 100;
  double clampPercent() => clamp(0, 100).toDouble();
}

/// [String] helpers.
extension StringX on String {
  String capitalize() {
    if (isEmpty) return this;
    return '${this[0].toUpperCase()}${substring(1)}';
  }

  String titleCase() {
    if (isEmpty) return this;
    return split(' ').map((w) => w.capitalize()).join(' ');
  }

  String get initials {
    final parts = trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts[0].isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }
}

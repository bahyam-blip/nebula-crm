import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:timeago/timeago.dart' as timeago;

/// Formatting helpers — currency, dates, percentages, compact numbers.
abstract class Formatters {
  static String currency(num value, {String symbol = r'$', int decimals = 0}) {
    final fmt = NumberFormat.currency(
      symbol: symbol,
      decimalDigits: decimals,
    );
    return fmt.format(value);
  }

  /// Compact currency — $12.4K, $1.2M, $3.4B.
  static String currencyCompact(num value, {String symbol = r'$'}) {
    if (value.abs() >= 1e9) return '$symbol${(value / 1e9).toStringAsFixed(1)}B';
    if (value.abs() >= 1e6) return '$symbol${(value / 1e6).toStringAsFixed(1)}M';
    if (value.abs() >= 1e3) return '$symbol${(value / 1e3).toStringAsFixed(1)}K';
    return '$symbol${value.toStringAsFixed(0)}';
  }

  static String percent(num value, {int decimals = 0}) {
    return '${value.toStringAsFixed(decimals)}%';
  }

  static String compact(num value) {
    final fmt = NumberFormat.compact();
    return fmt.format(value);
  }

  static String date(DateTime dt) {
    return DateFormat('MMM d, yyyy').format(dt);
  }

  static String dateTime(DateTime dt) {
    return DateFormat('MMM d, yyyy · h:mm a').format(dt);
  }

  static String time(DateTime dt) {
    return DateFormat('h:mm a').format(dt);
  }

  /// "2h ago", "yesterday", etc.
  static String timeAgo(DateTime dt) {
    return timeago.format(dt);
  }

  /// "Mon, Mar 4" — short day + date.
  static String shortDate(DateTime dt) {
    return DateFormat('EEE, MMM d').format(dt);
  }

  /// Days from now until [dt]; negative if past.
  static int daysUntil(DateTime dt) {
    final today = DateTime.now();
    return dt.difference(today).inDays;
  }

  /// Returns "[Initials]" from a full name.
  static String initials(String name) {
    if (name.trim().isEmpty) return '?';
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }

  /// Mask an email for privacy in lists: `j***@acme.com`.
  static String maskEmail(String email) {
    final atIndex = email.indexOf('@');
    if (atIndex < 2) return email;
    return '${email[0]}***${email.substring(atIndex)}';
  }

  /// Pluralize: `Formatters.plural(3, 'deal')` → `3 deals`.
  static String plural(num n, String singular, {String? plural}) {
    final pluralWord = plural ?? '${singular}s';
    return n == 1 ? '$n $singular' : '$n $pluralWord';
  }
}

/// Color helpers for charts and stage badges.
abstract class ColorHelpers {
  static Color withAlpha(Color c, double alpha) {
    return c.withValues(alpha: alpha);
  }
}

/// String helpers.
abstract class StringHelpers {
  /// Truncate a string to [max] chars with ellipsis.
  static String truncate(String s, int max) {
    if (s.length <= max) return s;
    return '${s.substring(0, max - 1)}…';
  }

  /// Empty or null → '—'.
  static String orDash(String? s) {
    if (s == null || s.trim().isEmpty) return '—';
    return s;
  }
}

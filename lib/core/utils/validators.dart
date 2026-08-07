import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Common form validators — pure functions, easy to unit test.
abstract class Validators {
  static String? required(String? value, {String message = 'Required'}) {
    if (value == null || value.trim().isEmpty) return message;
    return null;
  }

  static String? email(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    final regex = RegExp(r'^[\w.+-]+@[\w-]+\.[\w.-]+$');
    if (!regex.hasMatch(value.trim())) return 'Enter a valid email';
    return null;
  }

  static String? password(String? value) {
    if (value == null || value.isEmpty) return 'Required';
    if (value.length < 8) return 'Min 8 characters';
    if (!RegExp(r'[A-Z]').hasMatch(value)) return 'Add an uppercase letter';
    if (!RegExp(r'[a-z]').hasMatch(value)) return 'Add a lowercase letter';
    if (!RegExp(r'\d').hasMatch(value)) return 'Add a number';
    return null;
  }

  static String? phone(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    final digits = value.replaceAll(RegExp(r'[^\d+]'), '');
    if (digits.length < 7) return 'Enter a valid phone';
    return null;
  }

  static String? url(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasAbsolutePath) return 'Enter a valid URL';
    return null;
  }

  static String? Function(String?) min(int len) {
    return (String? value) {
      if (value == null || value.length < len) {
        return 'Min $len characters';
      }
      return null;
    };
  }

  static String? Function(String?) max(int len) {
    return (String? value) {
      if (value != null && value.length > len) {
        return 'Max $len characters';
      }
      return null;
    };
  }

  static String? currencyValue(String? value) {
    if (value == null || value.trim().isEmpty) return 'Required';
    final n = num.tryParse(value.replaceAll(RegExp(r'[^\d.]'), ''));
    if (n == null || n <= 0) return 'Enter a positive amount';
    return null;
  }
}

/// Input formatters — reuse for currency, phone, etc.
abstract class AppInputFormatters {
  /// 1,234,567 → digit grouping.
  static TextInputFormatter thousandsSeparator() {
    return FilteringTextInputFormatter.digitsOnly;
  }

  /// Currency input — keeps at most 2 decimal places.
  static List<TextInputFormatter> currency() {
    return [
      FilteringTextInputFormatter.allow(RegExp(r'^\d+\.?\d{0,2}')),
    ];
  }

  /// Lowercase email only.
  static List<TextInputFormatter> email() {
    return [
      FilteringTextInputFormatter.deny(RegExp(r'\s')),
      LowerCaseTextFormatter(),
    ];
  }
}

class LowerCaseTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    return newValue.copyWith(
      text: newValue.text.toLowerCase(),
      selection: newValue.selection,
    );
  }
}

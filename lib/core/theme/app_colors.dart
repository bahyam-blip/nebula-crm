import 'package:flutter/material.dart';

/// Nebula CRM color palette — dark premium (Bloomberg / Linear inspired).
///
/// All colors are 8-digit hex (RRGGBBAA) or 6-digit. Designed for OLED
/// efficiency (true black backgrounds) while keeping enough elevation
/// to read cards and surfaces.
abstract class AppColors {
  // ── Backgrounds ──────────────────────────────────────────────
  /// Pure-black canvas (OLED-friendly).
  static const Color background = Color(0xFF0A0E1A);

  /// Slightly raised surface — used by Scaffold body behind cards.
  static const Color surface = Color(0xFF10162A);

  /// Card / list-item background.
  static const Color surfaceElevated = Color(0xFF161E36);

  /// Higher-elevation card (modals, FAB backgrounds).
  static const Color surfaceHigh = Color(0xFF1E2746);

  /// Hairline borders, dividers.
  static const Color border = Color(0xFF233055);

  // ── Text ─────────────────────────────────────────────────────
  /// Primary text — high-contrast white.
  static const Color textPrimary = Color(0xFFF4F6FB);

  /// Secondary text — labels, captions.
  static const Color textSecondary = Color(0xFF9AA3BC);

  /// Tertiary / disabled text.
  static const Color textTertiary = Color(0xFF5B6680);

  // ── Brand ────────────────────────────────────────────────────
  /// Primary accent — electric indigo. Used for CTAs, active nav.
  static const Color primary = Color(0xFF6C8CFF);

  /// Primary accent — slightly darker for pressed states.
  static const Color primaryPressed = Color(0xFF5577E6);

  /// Secondary accent — cyan/teal. Used for highlights, links.
  static const Color accent = Color(0xFF3DD8D8);

  /// Tertiary accent — magenta/pink for alerts, hot streaks.
  static const Color tertiary = Color(0xFFFF5C8A);

  // ── Semantic ─────────────────────────────────────────────────
  static const Color success = Color(0xFF3DD9A0);
  static const Color warning = Color(0xFFFFB547);
  static const Color danger = Color(0xFFFF5C5C);
  static const Color info = Color(0xFF5BB8FF);

  // ── Stage colors (sales pipeline) ───────────────────────────
  static const Color stageLead = Color(0xFF8B95B5);
  static const Color stageQualified = Color(0xFF5BB8FF);
  static const Color stageProposal = Color(0xFFB07CFF);
  static const Color stageNegotiation = Color(0xFFFFB547);
  static const Color stageWon = Color(0xFF3DD9A0);
  static const Color stageLost = Color(0xFFFF5C5C);

  // ── Gradients ────────────────────────────────────────────────
  static const LinearGradient primaryGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF6C8CFF), Color(0xFF3DD8D8)],
  );

  static const LinearGradient premiumGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF6C8CFF), Color(0xFFB07CFF)],
  );

  static const LinearGradient revenueGradient = LinearGradient(
    begin: Alignment.bottomCenter,
    end: Alignment.topCenter,
    colors: [Color(0x006C8CFF), Color(0xFF6C8CFF)],
  );

  static const LinearGradient dangerGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFFF5C8A), Color(0xFFFF5C5C)],
  );

  /// Helper: stage color by string key.
  static Color stageColor(String stageKey) {
    switch (stageKey.toLowerCase()) {
      case 'lead':
      case 'new':
        return stageLead;
      case 'qualified':
        return stageQualified;
      case 'proposal':
        return stageProposal;
      case 'negotiation':
        return stageNegotiation;
      case 'won':
      case 'closed_won':
        return stageWon;
      case 'lost':
      case 'closed_lost':
        return stageLost;
      default:
        return textTertiary;
    }
  }
}

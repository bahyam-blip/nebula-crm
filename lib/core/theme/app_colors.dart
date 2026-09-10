import 'package:flutter/material.dart';

/// Nebula Design Language 3.0 — "MONO".
///
/// The user's verdict on 2.0: the colored aurora accents and gradient
/// buttons read as toy-grade. 3.0 is the correction — deep black,
/// aggressively minimal, monochrome:
///
/// 1. TRUE BLACK CANVAS — #000000. Battery-friendly OLED, infinite depth,
///    no blue-cast "near black" that reads as another theme.
/// 2. WHITE IS THE ACCENT — every action, selection and highlight is
///    pure white on black. Hierarchy comes from opacity steps of white,
///    not from hue.
/// 3. HAIRLINE CHROME — 1px #1F1F1F lines separate everything; no
///    glows, no glass, no gradients. Content is the only color.
/// 4. SEMANTICS STAY SEMANTIC — success/warning/danger survive, mildly
///    desaturated, and are used ONLY for meaning.
///
/// All 2.0 symbol names are preserved (aurora*, gradients) with
/// monochrome values so the entire app flips at once with zero churn.
abstract class AppColors {
  // ── Backgrounds ──────────────────────────────────────────────
  /// Deepest canvas — true black.
  static const Color background = Color(0xFF000000);

  /// Raised surface behind cards and lists.
  static const Color surface = Color(0xFF070707);

  /// Card / list-item background.
  static const Color surfaceElevated = Color(0xFF0C0C0C);

  /// Higher-elevation surface (modals, FAB, menus).
  static const Color surfaceHigh = Color(0xFF131313);

  /// Highest elevation (dialogs above sheets).
  static const Color surfaceHighest = Color(0xFF1A1A1A);

  /// Hairline borders, dividers.
  static const Color border = Color(0xFF1F1F1F);

  // ── Legacy glass tokens (kept for compatibility, now flat) ───
  static const Color glassFill = Color(0x08FFFFFF);
  static const Color glassFillStrong = Color(0x12FFFFFF);
  static const Color glassEdge = Color(0x24FFFFFF);

  // ── Ambient (legacy aurora names — now a faint white light) ──
  static const Color auroraIndigo = Color(0xFFE8E8E8);
  static const Color auroraViolet = Color(0xFFD6D6D6);
  static const Color auroraCyan = Color(0xFFB8B8B8);
  static const Color auroraRose = Color(0xFF9E9E9E);

  // ── Text ─────────────────────────────────────────────────────
  /// Primary text — pure white.
  static const Color textPrimary = Color(0xFFF7F7F7);

  /// Secondary text — mid gray.
  static const Color textSecondary = Color(0xFF8F8F8F);

  /// Tertiary / disabled text — dark gray.
  static const Color textTertiary = Color(0xFF525252);

  // ── Brand ────────────────────────────────────────────────────
  /// Primary accent — WHITE. CTAs, active nav, focus.
  static const Color primary = Color(0xFFFFFFFF);

  /// Pressed / dimmed variant.
  static const Color primaryPressed = Color(0xFFD9D9D9);

  /// Secondary accent — white (monochrome system).
  static const Color accent = Color(0xFFFFFFFF);

  /// Tertiary accent — reserved for destructive highlights only.
  static const Color tertiary = Color(0xFFE5484D);

  // ── Semantic (desaturated, meaning-only) ─────────────────────
  static const Color success = Color(0xFF46A758);
  static const Color warning = Color(0xFFF5A524);
  static const Color danger = Color(0xFFE5484D);
  static const Color info = Color(0xFF8A8F98);

  // ── Stage colors (sales pipeline) — ink-first, meaning-second ─
  static const Color stageLead = Color(0xFF6E6E6E);
  static const Color stageQualified = Color(0xFF9C9C9C);
  static const Color stageProposal = Color(0xFFC9C9C9);
  static const Color stageNegotiation = Color(0xFFF5A524);
  static const Color stageWon = Color(0xFF46A758);
  static const Color stageLost = Color(0xFFE5484D);

  // ── Gradients (kept for compatibility — now monochrome) ──────
  /// Primary "gradient" — flat white (mono system rejects decoration).
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [Color(0xFFFFFFFF), Color(0xFFEDEDED)],
  );

  static const LinearGradient premiumGradient = LinearGradient(
    colors: [Color(0xFFF7F7F7), Color(0xFFC9C9C9)],
  );

  static const LinearGradient auroraGradient = LinearGradient(
    colors: [Color(0xFFF7F7F7), Color(0xFFB8B8B8)],
    stops: [0.0, 1.0],
  );

  static const LinearGradient revenueGradient = LinearGradient(
    begin: Alignment.bottomCenter,
    end: Alignment.topCenter,
    colors: [Color(0x00FFFFFF), Color(0xFFFFFFFF)],
  );

  static const LinearGradient dangerGradient = LinearGradient(
    colors: [Color(0xFFE5484D), Color(0xFFC93338)],
  );

  /// Soft wash behind hero sections — a whisper of gray light on black.
  static const LinearGradient heroWash = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF111111), Color(0x00000000)],
    stops: [0.0, 1.0],
  );

  // ── Elevation ────────────────────────────────────────────────
  /// Legacy glow factory — now an almost-invisible ambient shadow.
  static List<BoxShadow> glow(Color color, {double alpha = 0.30}) => [
        BoxShadow(
          color: const Color(0xFF000000).withValues(alpha: 0.5),
          blurRadius: 24,
          offset: const Offset(0, 6),
          spreadRadius: -10,
        ),
      ];

  /// Ambient card shadow — grounds cards without heaviness.
  static List<BoxShadow> get cardShadow => [
        BoxShadow(
          color: const Color(0xFF000000).withValues(alpha: 0.6),
          blurRadius: 18,
          offset: const Offset(0, 6),
          spreadRadius: -12,
        ),
      ];

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

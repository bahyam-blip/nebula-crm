import 'package:flutter/material.dart';

/// Nebula Design Language 2.0 — color system.
///
/// Built on three principles borrowed from the best dark UIs (Linear,
/// Raycast, Arc):
///
/// 1. DEPTH OVER FLATNESS — the canvas is not one black rectangle; it is
///    layered near-black surfaces with ambient aurora glows that give the
///    screen atmosphere and a sense of space.
/// 2. ONE ACCENT FAMILY — indigo/violet/cyan carry brand, action and
///    energy; semantic colors are reserved for meaning only.
/// 3. QUIET CHROME, LOUD CONTENT — hairlines and glass fills separate
///    content instead of heavy borders, so data and words lead.
abstract class AppColors {
  // ── Backgrounds ──────────────────────────────────────────────
  /// Deepest canvas — true OLED black with a hint of indigo.
  static const Color background = Color(0xFF07080D);

  /// Raised surface behind cards and lists.
  static const Color surface = Color(0xFF0D0F16);

  /// Card / list-item background.
  static const Color surfaceElevated = Color(0xFF12141C);

  /// Higher-elevation surface (modals, FAB, menus).
  static const Color surfaceHigh = Color(0xFF181B26);

  /// Highest elevation (dialogs above sheets).
  static const Color surfaceHighest = Color(0xFF1F2330);

  /// Hairline borders, dividers.
  static const Color border = Color(0xFF232734);

  // ── Glass system (frosted fills over the aurora) ─────────────
  /// Fill for glass cards — a whisper of white.
  static const Color glassFill = Color(0x0AFFFFFF);

  /// Stronger glass fill for emphasized surfaces.
  static const Color glassFillStrong = Color(0x12FFFFFF);

  /// Hairline on glass — light catches the edge.
  static const Color glassEdge = Color(0x1AFFFFFF);

  // ── Aurora ambient (atmosphere, used at low alpha) ───────────
  /// Ambient glow color 1 — indigo.
  static const Color auroraIndigo = Color(0xFF6C8CFF);

  /// Ambient glow color 2 — violet.
  static const Color auroraViolet = Color(0xFFA78BFA);

  /// Ambient glow color 3 — cyan/mint.
  static const Color auroraCyan = Color(0xFF5EEAD4);

  /// Ambient glow color 4 — rose (sparingly, for warmth).
  static const Color auroraRose = Color(0xFFFB7FA8);

  // ── Text ─────────────────────────────────────────────────────
  /// Primary text — high-contrast white.
  static const Color textPrimary = Color(0xFFF5F6F8);

  /// Secondary text — labels, captions.
  static const Color textSecondary = Color(0xFF9AA1B2);

  /// Tertiary / disabled text.
  static const Color textTertiary = Color(0xFF5C6373);

  // ── Brand ────────────────────────────────────────────────────
  /// Primary accent — electric indigo. CTAs, active nav, focus.
  static const Color primary = Color(0xFF6C8CFF);

  /// Pressed / deep variant.
  static const Color primaryPressed = Color(0xFF5577E6);

  /// Secondary accent — cyan/teal. Highlights, links.
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

  static const LinearGradient auroraGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [auroraIndigo, auroraViolet, auroraCyan],
    stops: [0.0, 0.55, 1.0],
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

  /// Soft wash used behind hero sections (dashboard header, studio hero).
  static const LinearGradient heroWash = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF141B33), Color(0x0007080D)],
    stops: [0.0, 1.0],
  );

  // ── Elevation glow (light emitted by interactive elements) ──
  /// Glow shadow for primary buttons / hero cards.
  static List<BoxShadow> glow(Color color, {double alpha = 0.30}) => [
        BoxShadow(
          color: color.withValues(alpha: alpha),
          blurRadius: 24,
          offset: const Offset(0, 6),
          spreadRadius: -6,
        ),
        BoxShadow(
          color: color.withValues(alpha: alpha * 0.5),
          blurRadius: 48,
          offset: const Offset(0, 12),
          spreadRadius: -12,
        ),
      ];

  /// Ambient card shadow — grounds cards without heaviness.
  static List<BoxShadow> get cardShadow => [
        BoxShadow(
          color: const Color(0xFF000000).withValues(alpha: 0.35),
          blurRadius: 20,
          offset: const Offset(0, 8),
          spreadRadius: -10,
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

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import './app_colors.dart';

/// Nebula Design Language 2.0 — typography.
///
/// TWO-VOICE SYSTEM:
///  * Sora — geometric display voice with a slightly futuristic silhouette.
///    Carries every headline, page title and KPI value. This is what makes
///    a screen feel designed rather than defaulted.
///  * Inter — neutral workhorse for body, labels, inputs. Never tires.
///
/// Tracking rules: display sizes tighten (negative tracking), labels
/// loosen (positive tracking, uppercase for overlines).
abstract class AppTypography {
  // ── Display voice (Sora) ─────────────────────────────────────
  static TextStyle get displayHero => GoogleFonts.sora(
        fontSize: 34,
        fontWeight: FontWeight.w700,
        letterSpacing: -1.0,
        color: AppColors.textPrimary,
        height: 1.12,
      );

  static TextTheme get textTheme => TextTheme(
        // Display — Sora, tight tracking, confident.
        displayLarge: GoogleFonts.sora(
          fontSize: 44,
          fontWeight: FontWeight.w700,
          letterSpacing: -1.0,
          color: AppColors.textPrimary,
          height: 1.08,
        ),
        displayMedium: GoogleFonts.sora(
          fontSize: 34,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.8,
          color: AppColors.textPrimary,
          height: 1.12,
        ),
        displaySmall: GoogleFonts.sora(
          fontSize: 27,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.6,
          color: AppColors.textPrimary,
          height: 1.18,
        ),

        // Headlines — Sora.
        headlineLarge: GoogleFonts.sora(
          fontSize: 23,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.4,
          color: AppColors.textPrimary,
          height: 1.24,
        ),
        headlineMedium: GoogleFonts.sora(
          fontSize: 19,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.3,
          color: AppColors.textPrimary,
          height: 1.3,
        ),
        headlineSmall: GoogleFonts.sora(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
          color: AppColors.textPrimary,
          height: 1.34,
        ),

        // Body — Inter.
        bodyLarge: GoogleFonts.inter(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: AppColors.textPrimary,
          height: 1.55,
        ),
        bodyMedium: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: AppColors.textPrimary,
          height: 1.5,
        ),
        bodySmall: GoogleFonts.inter(
          fontSize: 12.5,
          fontWeight: FontWeight.w400,
          color: AppColors.textSecondary,
          height: 1.45,
        ),

        // Labels — Inter, purposeful tracking.
        labelLarge: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
          letterSpacing: 0.1,
        ),
        labelMedium: GoogleFonts.inter(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: AppColors.textSecondary,
          letterSpacing: 0.2,
        ),
        labelSmall: GoogleFonts.inter(
          fontSize: 10.5,
          fontWeight: FontWeight.w600,
          color: AppColors.textTertiary,
          letterSpacing: 0.6,
        ),

        // Titles — Sora keeps hierarchy consistent with headlines.
        titleLarge: GoogleFonts.sora(
          fontSize: 20,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
          color: AppColors.textPrimary,
        ),
        titleMedium: GoogleFonts.sora(
          fontSize: 15.5,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
          color: AppColors.textPrimary,
        ),
        titleSmall: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
      );

  /// Overline — tiny uppercase eyebrow above sections/hero text.
  static TextStyle overline(Color color) => GoogleFonts.inter(
        fontSize: 10.5,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.6,
        color: color,
        height: 1.2,
      );

  // ── Numeric (KPI cards, deal values) — Sora w/ tabular figures ──
  static TextStyle get numeric => GoogleFonts.sora(
        fontSize: 26,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.6,
        color: AppColors.textPrimary,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  static TextStyle get numericLarge => GoogleFonts.sora(
        fontSize: 34,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.9,
        color: AppColors.textPrimary,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  static TextStyle get numericSmall => GoogleFonts.inter(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: AppColors.textSecondary,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  // ── Monospace (IDs, URLs, tokens) ────────────────────────────
  static TextStyle mono({double size = 12.5, Color? color}) =>
      GoogleFonts.jetBrainsMono(
        fontSize: size,
        fontWeight: FontWeight.w500,
        color: color ?? AppColors.textSecondary,
        height: 1.4,
      );
}

/**
 * NEXT CALL PDF Design System
 *
 * Single source of truth for colors, spacing, and typography used
 * across every section of the generated digital presence audit.
 *
 * Direction: premium, professional, consulting-grade. White / light
 * neutral backgrounds, deep navy ink, muted slate secondary text, and
 * restrained brand accents (purple / blue / cyan).
 */

export const palette = {
  // Text
  ink: "#0F172A", // Deep navy / near-black — primary
  heading: "#1E293B", // Section headings
  body: "#334155", // Body text
  muted: "#64748B", // Secondary text
  subtle: "#94A3B8", // Metadata / captions

  // Surfaces & lines
  white: "#FFFFFF",
  surface: "#F8FAFC", // Card background
  line: "#E2E8F0", // Hairline borders
  lineStrong: "#CBD5E1",

  // Brand accents (used subtly)
  purple: "#7C3AED",
  purpleDeep: "#5B21B6",
  purpleSoft: "#F5F3FF",
  blue: "#2563EB",
  blueSoft: "#EFF6FF",
  cyan: "#0891B2",
  cyanSoft: "#ECFEFF",

  // Status colors
  green: "#15803D",
  greenSoft: "#F0FDF4",
  amber: "#B45309",
  amberSoft: "#FFFBEB",
  red: "#B91C1C",
  redSoft: "#FEF2F2",
  graySoft: "#F1F5F9",
} as const;

/** Consistent spacing scale — avoid ad-hoc values. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Shared page geometry for A4. */
export const page = {
  size: "A4" as const,
  marginH: 44,
  marginTop: 34,
  marginBottom: 66, // Leaves room for the fixed footer
  footerY: 26,
} as const;

/** Typography scale — one hierarchy for the entire report. */
export const type = {
  wordmark: 13,
  sectionTitle: 15,
  sectionSubtitle: 11,
  cardTitle: 10.5,
  label: 8.5,
  body: 10,
  small: 8.5,
  tiny: 7.5,
  coverName: 26,
  coverScore: 44,
} as const;

export const font = {
  family: "Helvetica",
  bold: "Helvetica-Bold",
  oblique: "Helvetica-Oblique",
} as const;
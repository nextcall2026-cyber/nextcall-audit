/**
 * PDF primitives — reusable presentational building blocks.
 * All styling comes from design.ts tokens; no ad-hoc values.
 */

import React from "react";
import { View, Text, Page, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { palette, spacing, page, type, font } from "./design";

// ---------------------------------------------------------------------------
// Base styles from tokens
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Typography
  body: {
    fontFamily: font.family,
    fontSize: type.body,
    lineHeight: 1.55,
    color: palette.body,
  },
  small: {
    fontFamily: font.family,
    fontSize: type.small,
    lineHeight: 1.5,
    color: palette.muted,
  },
  tiny: {
    fontFamily: font.family,
    fontSize: type.tiny,
    lineHeight: 1.45,
    color: palette.muted,
  },
  label: {
    fontFamily: font.bold,
    fontSize: type.label,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    color: palette.muted,
  },

  // Structure
  sectionTitle: {
    fontFamily: font.bold,
    fontSize: type.sectionTitle,
    color: palette.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    minPresenceAhead: 90,
  },
  sectionRule: {
    height: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: palette.purple,
    borderBottomStyle: "solid",
    width: 34,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  surfaceCard: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },

  // Score bar
  barBg: {
    height: 5,
    backgroundColor: palette.line,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: 5,
    borderRadius: 3,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: page.footerY,
    left: page.marginH,
    right: page.marginH,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: spacing.xs + 2,
  },
});

// ---------------------------------------------------------------------------
// Tokens -> helpers
// ---------------------------------------------------------------------------

export function scoreAccent(score: number): string {
  if (score >= 75) return palette.green;
  if (score >= 50) return palette.amber;
  if (score >= 35) return palette.amber;
  return palette.red;
}

export function statusColors(status: string): { bg: string; fg: string } {
  switch (status) {
    case "Strong":
    case "Good":
      return { bg: palette.greenSoft, fg: palette.green };
    case "Limited":
      return { bg: palette.amberSoft, fg: palette.amber };
    case "Needs Attention":
      return { bg: palette.redSoft, fg: palette.red };
    default:
      return { bg: palette.graySoft, fg: palette.muted };
  }
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{children}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

export function BodyText({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: Style;
}) {
  return <Text style={[styles.body, ...(style ? [style] : [])]}>{children}</Text>;
}

export function SmallText({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: Style;
}) {
  return <Text style={[styles.small, ...(style ? [style] : [])]}>{children}</Text>;
}

export function Label({ children, style }: { children: React.ReactNode; style?: Style }) {
  return <Text style={[styles.label, ...(style ? [style] : [])]}>{children}</Text>;
}

export function Card({ children, surface }: { children: React.ReactNode; surface?: boolean }) {
  return <View style={surface ? styles.surfaceCard : styles.card}>{children}</View>;
}

export function StatusBadge({
  status,
  score,
  style,
}: {
  status: string;
  score?: number;
  style?: Style;
}) {
  const colors = statusColors(status);
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          backgroundColor: colors.bg,
          borderRadius: 4,
          paddingHorizontal: spacing.sm,
          paddingVertical: 3,
          alignSelf: "flex-start",
          flexShrink: 0,
        },
        ...(style ? [style] : []),
      ]}
    >
      {score !== undefined && (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: scoreAccent(score),
          }}
        />
      )}
      <Text style={{ fontFamily: font.bold, fontSize: type.label - 1, color: colors.fg, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {status}
      </Text>
    </View>
  );
}

export function ScoreBar({ score, width }: { score: number; width?: string | number }) {
  return (
    <View style={[styles.barBg, ...(width !== undefined ? [{ width }] : [])]}>
      <View style={[styles.barFill, { width: `${Math.max(score, 0)}%`, backgroundColor: scoreAccent(score) }]} />
    </View>
  );
}

/** Small labeled info line:  LABEL / value */
export function InfoLine({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: spacing.xs }}>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: type.label - 0.5,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: accent ? palette.purple : palette.muted,
          width: 108,
        }}
      >
        {label}
      </Text>
      <Text style={[styles.small, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Footer — fixed on every page, numbered like a prepared document
// ---------------------------------------------------------------------------

export function ReportFooter({ businessName }: { businessName: string }) {
  const safeName = (businessName || "Business").slice(0, 48);
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.tiny}>NEXT CALL · Digital Presence Audit · {safeName}</Text>
      <Text
        style={[styles.tiny, { textAlign: "right" }]}
        render={({ pageNumber, totalPages }) =>
          `${String(pageNumber).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`
        }
      />
    </View>
  );
}

/** Page shell: A4, consistent margins, footer, shared background. */
export function ReportPage({
  children,
  businessName,
  breakNow,
}: {
  children: React.ReactNode;
  businessName: string;
  breakNow?: boolean;
}) {
  return (
    <Page
      size="A4"
      style={{
        backgroundColor: palette.white,
        paddingHorizontal: page.marginH,
        paddingTop: page.marginTop,
        paddingBottom: page.marginBottom,
        fontFamily: font.family,
      }}
      {...(breakNow ? { break: true } : {})}
    >
      {children}
      <ReportFooter businessName={businessName} />
    </Page>
  );
}
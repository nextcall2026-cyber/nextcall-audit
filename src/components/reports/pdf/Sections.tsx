/**
 * Report page sections.
 *
 * Each section is a self-contained block fed by the derived content
 * from builders.ts. Sections are composed into pages in
 * AuditReportDocument.tsx. No business data is hardcoded here.
 */

import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportViewModel } from "@/types";
import { palette, spacing, type, font } from "./design";
import {
  SectionTitle,
  BodyText,
  SmallText,
  Label,
  Card,
  StatusBadge,
  ScoreBar,
  InfoLine,
  scoreAccent,
} from "./primitives";
import {
  statusLabel,
  deriveCategoryStatus,
  deriveConfidenceLabel,
  buildAtAGlance,
  buildOverviewStatement,
  buildPriorityFindings,
  buildStrengths,
  buildJourney,
  buildNextCallPrimary,
  buildNextCallCapabilities,
  buildRoadmap,
} from "./builders";

const styles = StyleSheet.create({
  wordmarkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  wordmark: {
    flexDirection: "row",
    alignItems: "center",
  },
  wordmarkMark: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: palette.purple,
    marginRight: spacing.sm,
  },
  wordmarkText: {
    fontFamily: font.bold,
    fontSize: type.wordmark,
    letterSpacing: 1.4,
    color: palette.ink,
  },
  topRule: {
    borderBottomWidth: 1.5,
    borderBottomColor: palette.ink,
    borderBottomStyle: "solid",
    marginBottom: spacing.xl,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  coverLabel: {
    fontFamily: font.bold,
    fontSize: type.cardTitle,
    textTransform: "uppercase",
    letterSpacing: 2,
    color: palette.purple,
    marginBottom: spacing.sm,
  },
  coverName: {
    fontFamily: font.bold,
    fontSize: type.coverName,
    color: palette.ink,
    marginBottom: spacing.sm,
  },
  coverMeta: {
    fontFamily: font.family,
    fontSize: type.cardTitle,
    color: palette.muted,
    marginBottom: spacing.xl,
  },
  coverStatement: {
    fontFamily: font.family,
    fontSize: type.body,
    lineHeight: 1.6,
    color: palette.body,
    marginBottom: spacing.xl,
  },
  overallBlock: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: palette.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.lg,
  },
  scoreNumber: {
    fontFamily: font.bold,
    fontSize: type.coverScore,
    color: palette.ink,
  },
  scoreMaxPart: {
    fontFamily: font.family,
    fontSize: 14,
    color: palette.subtle,
  },
  overallRight: {
    flex: 1,
    alignItems: "flex-end",
  },
  glanceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  glanceCell: {
    width: "31%",
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    padding: spacing.sm,
  },
  journeyStep: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.line,
    marginBottom: spacing.xs,
    backgroundColor: palette.white,
  },
  journeyAccent: {
    width: 4,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  journeyBody: {
    flex: 1,
    padding: spacing.md,
  },
  journeyDivider: {
    width: 1,
    height: 10,
    backgroundColor: palette.line,
    alignSelf: "center",
    marginVertical: 2,
  },
  findingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  strengthRow: {
    flexDirection: "row",
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  strengthMark: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: palette.green,
    marginTop: 6,
  },
  roadmapRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  roadmapNumber: {
    fontFamily: font.bold,
    fontSize: 20,
    color: palette.purple,
    width: 34,
  },
  ctaBox: {
    backgroundColor: palette.purpleSoft,
    borderWidth: 1,
    borderColor: "#DDD6FE",
    borderRadius: 8,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  methodologyBox: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
});

// ---------------------------------------------------------------------------
// PAGE 1 — Business snapshot / premium cover
// ---------------------------------------------------------------------------

export function CoverSection({
  vm,
  statement,
}: {
  vm: ReportViewModel;
  statement: string;
}) {
  const dateObj = new Date(vm.auditDate);
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const overallStatus = statusLabel(deriveCategoryStatus(vm.overallScore));
  const glance = buildAtAGlance(vm);

  return (
    <View>
      {/* Brand row */}
      <View style={styles.wordmarkRow}>
        <View style={styles.wordmark}>
          <View style={styles.wordmarkMark} />
          <Text style={styles.wordmarkText}>NEXT CALL</Text>
        </View>
        <Text style={[styles.coverLabel, { marginBottom: 0, color: palette.muted }]}>
          Prepared {formattedDate}
        </Text>
      </View>
      <View style={styles.topRule}>
        <Text style={styles.coverLabel}>Digital Presence Audit</Text>
        <Text style={{ fontFamily: font.family, fontSize: type.small, color: palette.muted }}>
          {vm.auditVersion}
        </Text>
      </View>

      {/* Business identity */}
      <Text style={styles.coverName}>{vm.businessName}</Text>
      <Text style={styles.coverMeta}>
        {vm.category}
        {vm.location && vm.location !== "Unknown Location" ? `  ·  ${vm.location}` : ""}
      </Text>

      {/* Personalized statement */}
      <Text style={styles.coverStatement}>
        An assessment of the digital touchpoints customers may use to discover, contact, and
        engage with {vm.businessName}. {statement}
      </Text>

      {/* Overall assessment — restrained, not a grade wall */}
      <View style={styles.overallBlock}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={styles.scoreNumber}>{vm.overallScore}</Text>
            <Text style={styles.scoreMaxPart}> / 100</Text>
          </View>
          <Label style={{ marginTop: spacing.sm }}>Overall Digital Presence</Label>
          <View style={{ width: 220, marginTop: spacing.sm }}>
            <ScoreBar score={vm.overallScore} />
          </View>
        </View>
        <View style={styles.overallRight}>
          <StatusBadge status={overallStatus} score={vm.overallScore} />
          <View style={{ marginTop: spacing.sm, alignItems: "flex-end" }}>
            <Label>Audit Data Reliability</Label>
            <Text style={{ fontFamily: font.bold, fontSize: type.small, color: palette.body, marginTop: 2 }}>
              {deriveConfidenceLabel(vm.confidence)}
            </Text>
          </View>
        </View>
      </View>

      {/* At a glance */}
      <Label style={{ marginBottom: spacing.sm }}>At a Glance</Label>
      <View style={styles.glanceGrid}>
        {glance.map((item, i) => (
          <View key={i} style={styles.glanceCell}>
            <Text style={{ fontFamily: font.bold, fontSize: type.label - 1, textTransform: "uppercase", letterSpacing: 0.6, color: palette.muted, marginBottom: 3 }}>
              {item.label}
            </Text>
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: palette.ink }}>
              {item.score}
              <Text style={{ fontSize: 9, color: palette.subtle }}> /100</Text>
            </Text>
            <View style={{ marginTop: 3 }}>
              <StatusBadge status={item.status} score={item.score} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 2 — What we found
// ---------------------------------------------------------------------------

export function ExecutiveSummarySection({ vm }: { vm: ReportViewModel }) {
  const findings = buildPriorityFindings(vm);
  const strengths = buildStrengths(vm);

  return (
    <View>
      <SectionTitle>What We Found</SectionTitle>
      <BodyText>{buildOverviewStatement(vm)}</BodyText>
      <BodyText style={{ marginTop: spacing.sm }}>{vm.aiReport.executiveSummary}</BodyText>

      {strengths.length > 0 && (
        <View style={{ marginTop: spacing.lg }} wrap={false}>
          <SectionTitle>What You&apos;re Doing Well</SectionTitle>
          {strengths.map((s, i) => (
            <View key={i} style={styles.strengthRow}>
              <View style={styles.strengthMark} />
              <Text style={[styles.strengthRow, { flex: 1, marginBottom: spacing.xs }]}>
                <SmallText>{s}</SmallText>
              </Text>
            </View>
          ))}
        </View>
      )}

      {findings.length > 0 && (
        <View style={{ marginTop: spacing.lg }} wrap={false}>
          <SectionTitle>Priority Opportunities</SectionTitle>
          {findings.map((f, i) => (
<Card key={i}>
              <View style={styles.findingHeader}>
                <Text style={{ fontFamily: font.bold, fontSize: type.cardTitle, color: palette.ink }}>
                  {f.category}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Text style={{ fontFamily: font.bold, fontSize: type.small, color: palette.ink }}>
                    {f.score}
                    <Text style={{ color: palette.subtle }}>/100</Text>
                  </Text>
                  <StatusBadge status={statusLabel(deriveCategoryStatus(f.score))} score={f.score} />
                </View>
              </View>
              <BodyText style={{ marginTop: 2 }}>
                <Text style={{ fontFamily: font.bold, color: palette.ink }}>{f.title}. </Text>
                {f.finding}
              </BodyText>
              <InfoLine label="Why it matters">{f.whyItMatters}</InfoLine>
              <InfoLine label="Opportunity" accent>
                {f.opportunity}
              </InfoLine>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 3 — Digital presence breakdown
// ---------------------------------------------------------------------------

export function BreakdownSection({ vm }: { vm: ReportViewModel }) {
  return (
    <View>
      <SectionTitle>Digital Presence Breakdown</SectionTitle>
      <SmallText>
        Each category below reflects publicly detectable signals at the time of the assessment.
      </SmallText>

      {vm.categoryDetails.map((cat, i) => {
        const status = statusLabel(deriveCategoryStatus(cat.score));
        const weakness = cat.findings.find((f) => f.type === "WEAKNESS");
        const strength = cat.findings.find((f) => f.type === "STRENGTH");
        const statusIsStrong = status === "Strong" || status === "Good";
        const what = statusIsStrong
          ? strength?.evidence ||
            "A working, publicly detectable presence was identified in this category."
          : weakness?.evidence ||
            `Limited publicly detectable signals were identified for ${cat.name.toLowerCase()}.`;

        const why = statusIsStrong
          ? "This channel supports prospective customers during the research and contact phase."
          : cat.key === "WEBSITE"
            ? "Prospective customers may have fewer places to verify services and learn how to contact the business."
            : cat.key === "CONTACTABILITY"
              ? "Customers may need to rely more heavily on phone communication to reach the business."
              : cat.key === "BOOKING"
                ? "Customers who prefer to schedule online may need to call during business hours instead."
                : cat.key === "SOCIAL"
                  ? "Customers may have fewer channels to discover and follow the business."
                  : "Prospective customers may have limited public signals to inform their decision.";

        const opportunity = statusIsStrong
          ? "Continue to maintain and monitor this channel."
          : cat.key === "WEBSITE"
            ? "Establish a simple, service-focused web presence."
            : cat.key === "CONTACTABILITY"
              ? "Publish additional contact channels and clear business hours."
              : cat.key === "BOOKING"
                ? "Offer online scheduling so customers can move from inquiry to appointment more easily."
                : cat.key === "SOCIAL"
                  ? "Create profiles on the platforms customers use most to build familiarity."
                  : "Encourage satisfied customers to leave public reviews.";

        return (
          <Card key={i} surface>
            <View style={styles.findingHeader}>
              <Text style={{ fontFamily: font.bold, fontSize: type.cardTitle, color: palette.ink }}>
                {cat.name}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Text style={{ fontFamily: font.bold, fontSize: type.small, color: palette.ink }}>
                  {cat.score}
                  <Text style={{ color: palette.subtle }}>/100</Text>
                </Text>
                <StatusBadge status={status} score={cat.score} />
              </View>
            </View>
            <View style={{ width: "55%", marginTop: spacing.xs, marginBottom: spacing.sm }}>
              <ScoreBar score={cat.score} />
            </View>
            <InfoLine label="What we detected">{what}</InfoLine>
            <InfoLine label="Why it matters">{why}</InfoLine>
            <InfoLine label="Opportunity" accent>
              {opportunity}
            </InfoLine>
          </Card>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 4 — Customer journey + NEXT CALL solution
// ---------------------------------------------------------------------------

export function JourneySection({ vm }: { vm: ReportViewModel }) {
  const { steps, friction } = buildJourney(vm);

  return (
    <View>
      <SectionTitle>Customer Journey</SectionTitle>
      <SmallText>
        How a prospective customer may move from discovering the business to completing a service.
      </SmallText>

      {steps.map((step, i) => (
        <View key={i}>
          {i > 0 && <View style={styles.journeyDivider} />}
          <View style={styles.journeyStep}>
            <View style={[styles.journeyAccent, { backgroundColor: step.positive ? palette.green : palette.amber }]} />
            <View style={styles.journeyBody}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Label>{step.label}</Label>
                <Text style={{ fontFamily: font.bold, fontSize: type.small, color: step.positive ? palette.green : palette.amber }}>
                  {step.status}
                </Text>
              </View>
              <Text style={{ fontFamily: font.bold, fontSize: type.cardTitle, color: palette.ink, marginTop: 2 }}>
                {step.headline}
              </Text>
              <Text style={{ fontFamily: font.family, fontSize: type.small, lineHeight: 1.5, color: palette.muted, marginTop: 2 }}>
                {step.detail}
              </Text>
            </View>
          </View>
        </View>
      ))}

      <Card surface>
        <Label style={{ color: palette.amber, marginBottom: 2 }}>Friction Summary</Label>
        <BodyText>{friction}</BodyText>
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 5 (part 1) — One opportunity worth addressing (NEXT CALL)
// ---------------------------------------------------------------------------

export function NextCallSection({ vm }: { vm: ReportViewModel }) {
  const primary = buildNextCallPrimary(vm);
  const capabilities = buildNextCallCapabilities(vm);

  return (
    <View style={{ marginTop: spacing.lg }}>
      <SectionTitle>One Opportunity Worth Addressing</SectionTitle>

      <Card>
        <Label style={{ color: palette.purple, marginBottom: spacing.xs }}>
          Finding &amp; Impact
        </Label>
        <Text style={{ fontFamily: font.bold, fontSize: type.cardTitle, color: palette.ink, marginBottom: spacing.xs }}>
          {primary.problem}
        </Text>
        <BodyText>{primary.whyItMatters}</BodyText>
      </Card>

      <Label style={{ marginTop: spacing.lg, marginBottom: spacing.sm }} minPresenceAhead={140}>
        How NEXT CALL Can Help
      </Label>
      {capabilities.map((c, i) => (
        <Card key={i} surface>
          <InfoLine label="Capability" accent>
            {c.title}
          </InfoLine>
          <BodyText style={{ marginTop: spacing.xs }}>{c.detail}</BodyText>
        </Card>
      ))}

      <Card>
        <Label style={{ marginBottom: spacing.xs }}>Relevance to This Business</Label>
        <BodyText>{primary.relevance}</BodyText>
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 5 (part 2) — Prioritized roadmap + CTA + methodology
// ---------------------------------------------------------------------------

export function RoadmapSection({ vm }: { vm: ReportViewModel }) {
  const roadmap = buildRoadmap(vm);

  return (
    <View style={{ marginTop: spacing.lg }} wrap={false}>
      <SectionTitle>Recommended Priorities</SectionTitle>
      {roadmap.map((item, i) => (
        <View key={i} style={styles.roadmapRow}>
          <Text style={styles.roadmapNumber}>{item.number}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.bold, fontSize: type.cardTitle, color: palette.ink }}>
              {item.title}
            </Text>
            <SmallText>{item.detail}</SmallText>
          </View>
        </View>
      ))}
    </View>
  );
}

export function NextCallCtaSection({ vm }: { vm: ReportViewModel }) {
  return (
    <View style={styles.ctaBox}>
      <View style={styles.wordmark}>
        <View style={styles.wordmarkMark} />
        <Text style={styles.wordmarkText}>NEXT CALL</Text>
      </View>
      <BodyText style={{ marginTop: spacing.md }}>
        Want to explore this for {vm.businessName}?
      </BodyText>
      <SmallText>
        Book a quick 5-minute conversation with the NEXT CALL team to review the findings and
        discuss how an AI voice receptionist could support the way customers reach this business.
      </SmallText>
    </View>
  );
}

export function MethodologySection({ vm }: { vm: ReportViewModel }) {
  const dateObj = new Date(vm.auditDate);
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <View style={styles.methodologyBox} wrap={false}>
      <Label style={{ marginBottom: spacing.xs }}>About This Assessment</Label>
      <Text style={{ fontFamily: font.family, fontSize: type.small, lineHeight: 1.5, color: palette.muted }}>
        This assessment was generated using publicly available business information, provider data,
        website accessibility checks, deterministic audit rules, and AI-assisted interpretation based
        on verified findings. It evaluates publicly detectable digital-presence signals and should
        not be considered a complete evaluation of internal business operations.
      </Text>
      <Text style={{ fontFamily: font.family, fontSize: type.tiny, color: palette.subtle, marginTop: spacing.sm }}>
        {vm.businessName} · {vm.location} · Prepared {formattedDate} · Audit version {vm.auditVersion}
      </Text>
    </View>
  );
}
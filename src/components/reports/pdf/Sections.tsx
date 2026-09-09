/**
 * Report page sections.
 *
 * Each section is a self-contained block fed by the derived content
 * from builders.ts. Sections are composed into pages in
 * AuditReportDocument.tsx. No business data is hardcoded here.
 *
 * Structure (7 pages):
 *   P1 Business Snapshot   — score, confidence, key positive, biggest opportunity
 *   P2 Executive Summary   — what's working / opportunity / customer impact
 *   P3 Priority Opportunities — finding → why it matters → recommended action
 *   P4 Digital Presence Breakdown — per-category analysis + verified links
 *   P5 Customer Journey    — discover → learn → contact → schedule → convert
 *   P6 Where NextCall Can Help — personalized capabilities + soft CTA
 *   P7 Final conversion    — personalized CTA + 3-day trial + methodology
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
  Wordmark,
  TextLink,
  CtaButton,
} from "./primitives";
import {
  statusLabel,
  deriveCategoryStatus,
  deriveConfidenceLabel,
  deriveAuditSignals,
  buildAtAGlance,
  buildOverviewStatement,
  buildPriorityFindings,
  buildStrengths,
  buildJourney,
  buildNextCallCapabilities,
  buildNextCallCta,
  buildNextCallOpportunity,
  buildScoreMethodology,
  buildCoverSignals,
} from "./builders";
import {
  NEXTCALL_URL,
  NEXTCALL_TRIAL_URL,
  NEXTCALL_OFFERS_TRIAL,
} from "@/lib/nextCallConfig";

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
    marginBottom: spacing.lg,
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
  highlightCard: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    padding: spacing.md,
  },
  highlightMark: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs,
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
  opportunityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  opportunityMark: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: palette.amber,
    marginTop: 6,
  },
  findingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
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
  journeyNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginLeft: spacing.md,
  },
  journeyBody: {
    flex: 1,
    padding: spacing.md,
  },
  journeyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  journeyStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  frictionChip: {
    backgroundColor: palette.redSoft,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  journeyDivider: {
    width: 1,
    height: 10,
    backgroundColor: palette.line,
    alignSelf: "center",
    marginVertical: 2,
  },
  verifiedRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: spacing.xs,
  },
  verifiedLabel: {
    fontFamily: font.bold,
    fontSize: type.label - 0.5,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: palette.muted,
    width: 122,
  },
  softCtaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  finalHeadline: {
    fontFamily: font.bold,
    fontSize: 17,
    lineHeight: 1.35,
    color: palette.ink,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  personalWindow: {
    backgroundColor: palette.purpleSoft,
    borderWidth: 1,
    borderColor: "#DDD6FE",
    borderRadius: 8,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  benefitMark: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.green,
    marginTop: 5,
  },
  benefitText: {
    flex: 1,
    fontFamily: font.family,
    fontSize: type.small,
    lineHeight: 1.5,
    color: palette.body,
  },
  methodologyBox: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 6,
    padding: spacing.md,
    marginTop: spacing.xl,
  },
});

// ---------------------------------------------------------------------------
// PAGE 1 — Business snapshot / premium cover
// ---------------------------------------------------------------------------

export function CoverSection({ vm }: { vm: ReportViewModel }) {
  const dateObj = new Date(vm.auditDate);
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const overallStatus = statusLabel(deriveCategoryStatus(vm.overallScore));
  const glance = buildAtAGlance(vm);
  const statement = buildOverviewStatement(vm);
  const { positive, opportunity } = buildCoverSignals(vm);
  const methodology = buildScoreMethodology(vm);

  return (
    <View>
      {/* Brand row */}
      <View style={styles.wordmarkRow}>
        <Wordmark />
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

      {/* Overall assessment */}
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

      {/* Score composition — the real weights behind the number */}
      <Text
        style={{
          fontFamily: font.family,
          fontSize: type.tiny,
          color: palette.subtle,
          marginTop: -spacing.sm,
          marginBottom: spacing.lg,
        }}
      >
        Score composition:{" "}
        {methodology.items.map((i) => `${i.name} ${i.weightPercent}%`).join("  ·  ")}
      </Text>

      {/* Key positive signal + biggest opportunity */}
      <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.xl }}>
        <View style={[styles.highlightCard, { flex: 1 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
            <View style={[styles.highlightMark, { backgroundColor: palette.green }]} />
            <Label style={{ color: palette.green }}>Key Positive Signal</Label>
          </View>
          <SmallText>{positive}</SmallText>
        </View>
        <View style={[styles.highlightCard, { flex: 1 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
            <View style={[styles.highlightMark, { backgroundColor: palette.amber }]} />
            <Label style={{ color: palette.amber }}>Biggest Opportunity</Label>
          </View>
          <SmallText>{opportunity}</SmallText>
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
// PAGE 2 — Executive summary
// ---------------------------------------------------------------------------

export function ExecutiveSummarySection({ vm }: { vm: ReportViewModel }) {
  const findings = buildPriorityFindings(vm);
  const strengths = buildStrengths(vm);

  return (
    <View>
      <SectionTitle>Executive Summary</SectionTitle>
      <BodyText>{buildOverviewStatement(vm)}</BodyText>

      {strengths.length > 0 && (
        <View style={{ marginTop: spacing.lg }} wrap={false}>
          <Label style={{ color: palette.green, marginBottom: spacing.sm }}>
            What&apos;s Working
          </Label>
          {strengths.slice(0, 3).map((s, i) => (
            <View key={i} style={styles.strengthRow}>
              <View style={styles.strengthMark} />
              <SmallText style={{ flex: 1 }}>{s}</SmallText>
            </View>
          ))}
        </View>
      )}

      {findings.length > 0 && (
        <View style={{ marginTop: spacing.lg }} wrap={false}>
          <Label style={{ color: palette.amber, marginBottom: spacing.sm }}>
            What the Assessment Found
          </Label>
          {findings.slice(0, 4).map((f, i) => (
            <View key={i} style={styles.opportunityRow}>
              <View style={styles.opportunityMark} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.bold, fontSize: type.small, color: palette.ink }}>
                  {f.category}
                </Text>
                <SmallText>{f.finding}</SmallText>
              </View>
              <Text style={{ fontFamily: font.bold, fontSize: type.small, color: palette.muted }}>
                {f.score}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Card surface style={{ marginTop: spacing.lg }}>
        <Label style={{ marginBottom: spacing.xs }}>Customer Experience Impact</Label>
        <BodyText>{vm.aiReport.customerExperienceImpact}</BodyText>
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 3 — Priority opportunities
// ---------------------------------------------------------------------------

export function PriorityOpportunitiesSection({ vm }: { vm: ReportViewModel }) {
  const findings = buildPriorityFindings(vm);

  return (
    <View>
      <SectionTitle>Priority Opportunities</SectionTitle>
      <SmallText>
        The highest-value findings from this assessment, with the recommended action for each.
      </SmallText>

      {findings.map((f, i) => (
        <Card key={i} style={{ marginTop: spacing.sm }}>
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
          <InfoLine label="Why It Matters">{f.whyItMatters}</InfoLine>
          <InfoLine label="Recommended Action" accent>
            {f.opportunity}
          </InfoLine>
        </Card>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 4 — Digital presence breakdown
// ---------------------------------------------------------------------------

function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

export function BreakdownSection({ vm }: { vm: ReportViewModel }) {
  const s = deriveAuditSignals(vm);

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

        const verifiedUrl =
          cat.key === "WEBSITE" && s.websiteReachable && vm.signals.website
            ? { label: "Verified Website", url: vm.signals.website, visible: displayHost(vm.signals.website) }
            : cat.key === "BOOKING" && s.bookingDetected && vm.signals.bookingUrl
              ? { label: "Verified Booking", url: vm.signals.bookingUrl, visible: "Open Booking Page" }
              : cat.key === "SOCIAL" && s.socialDetected && vm.signals.socialProfiles.length > 0
                ? {
                    label: `Verified ${vm.signals.socialProfiles[0].platform}`,
                    url: vm.signals.socialProfiles[0].url,
                    visible: displayHost(vm.signals.socialProfiles[0].url),
                  }
                : cat.key === "CONTACTABILITY" && vm.signals.preferredEmail
                  ? {
                      label: "Verified Email",
                      url: `mailto:${vm.signals.preferredEmail}`,
                      visible: vm.signals.preferredEmail,
                    }
                  : null;

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
            <InfoLine label="What We Detected">{what}</InfoLine>
            <InfoLine label="Why It Matters">{why}</InfoLine>
            <InfoLine label="Opportunity" accent>
              {opportunity}
            </InfoLine>
            {verifiedUrl && (
              <View style={styles.verifiedRow}>
                <Text style={styles.verifiedLabel}>{verifiedUrl.label}</Text>
                <TextLink href={verifiedUrl.url} style={{ fontSize: type.small, flexShrink: 1 }}>
                  {verifiedUrl.visible}
                </TextLink>
              </View>
            )}
          </Card>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 5 — Customer journey
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
            <View
              style={[
                styles.journeyAccent,
                { backgroundColor: step.positive ? palette.green : palette.amber },
              ]}
            />
            <View
              style={[
                styles.journeyNumber,
                { backgroundColor: step.positive ? palette.greenSoft : palette.amberSoft },
              ]}
            >
              <Text
                style={{
                  fontFamily: font.bold,
                  fontSize: 8,
                  color: step.positive ? palette.green : palette.amber,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </Text>
            </View>
            <View style={styles.journeyBody}>
              <View style={styles.journeyHeader}>
                <Label>{step.label}</Label>
                <View style={styles.journeyStatusRow}>
                  {!step.positive && (
                    <View style={styles.frictionChip}>
                      <Text
                        style={{
                          fontFamily: font.bold,
                          fontSize: 6.5,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: palette.red,
                        }}
                      >
                        Friction
                      </Text>
                    </View>
                  )}
                  <Text
                    style={{
                      fontFamily: font.bold,
                      fontSize: type.small,
                      color: step.positive ? palette.green : palette.amber,
                    }}
                  >
                    {step.status}
                  </Text>
                </View>
              </View>
              <Text
                style={{
                  fontFamily: font.bold,
                  fontSize: type.cardTitle,
                  color: palette.ink,
                  marginTop: 2,
                }}
              >
                {step.headline}
              </Text>
              <Text
                style={{
                  fontFamily: font.family,
                  fontSize: type.small,
                  lineHeight: 1.5,
                  color: palette.muted,
                  marginTop: 2,
                }}
              >
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
// PAGE 6 — Where NextCall can help (personalized capabilities + soft CTA)
// ---------------------------------------------------------------------------

export function NextCallSolutionSection({ vm }: { vm: ReportViewModel }) {
  const capabilities = buildNextCallCapabilities(vm);
  const opportunity = buildNextCallOpportunity(vm);

  return (
    <View style={{ marginTop: spacing.lg }}>
      <SectionTitle>Where NextCall Can Help</SectionTitle>
      <BodyText>
        Tied to what this assessment found, the following NextCall capabilities
        are particularly relevant to your business.
      </BodyText>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          marginTop: spacing.md,
          marginBottom: 2,
        }}
      >
        <Text
          style={{
            fontFamily: font.bold,
            fontSize: type.label - 1,
            textTransform: "uppercase",
            letterSpacing: 0.8,
            color: palette.purple,
          }}
        >
          NextCall Opportunity
        </Text>
        <Text style={{ fontFamily: font.bold, fontSize: type.small, color: palette.ink }}>
          {opportunity.level}
        </Text>
      </View>
      <SmallText style={{ marginBottom: spacing.sm }}>{opportunity.summary}</SmallText>

      {capabilities.map((c, i) => (
        <Card key={i} surface style={{ marginTop: spacing.sm }}>
          <Text
            style={{
              fontFamily: font.bold,
              fontSize: type.cardTitle,
              color: palette.purpleDeep,
              marginBottom: spacing.xs,
            }}
          >
            {c.title}
          </Text>
          <InfoLine label="The Opportunity">{c.opportunity}</InfoLine>
          <InfoLine label="Why It Matters">{c.whyItMatters}</InfoLine>
          <InfoLine label="How NextCall Helps" accent>
            {c.howNextCallHelps}
          </InfoLine>
        </Card>
      ))}

      <View style={styles.softCtaRow}>
        <Wordmark compact />
        <View style={{ flex: 1 }} />
        <TextLink href={NEXTCALL_URL} style={{ letterSpacing: 0.4 }}>
          Explore NextCall »
        </TextLink>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PAGE 7 — Final conversion CTA (personalized) + methodology
// ---------------------------------------------------------------------------

export function NextCallFinalCtaSection({ vm }: { vm: ReportViewModel }) {
  const cta = buildNextCallCta(vm);

  return (
    <View wrap={false}>
      <Wordmark />
      <Text style={styles.finalHeadline}>
        READY TO TURN MORE CUSTOMER INQUIRIES INTO JOBS?
      </Text>
      <BodyText>{cta.overview}</BodyText>
      <BodyText style={{ marginTop: spacing.sm }}>{cta.productLine}</BodyText>

      <View style={styles.personalWindow}>
        <Label style={{ color: palette.purple, marginBottom: spacing.xs }}>
          Personalized for {vm.businessName}
        </Label>
        <BodyText>
          <Text style={{ fontFamily: font.bold, color: palette.ink }}>{cta.personalized} </Text>
          {cta.howNextCallHelps}
        </BodyText>
      </View>

      {cta.benefits.length > 0 && (
        <View style={{ marginTop: spacing.lg }}>
          {cta.benefits.map((b, i) => (
            <View key={i} style={styles.benefitRow}>
              <View style={styles.benefitMark} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>
      )}

      {NEXTCALL_OFFERS_TRIAL && (
        <View style={{ marginTop: spacing.xl }}>
          <CtaButton href={NEXTCALL_TRIAL_URL} label="Try NextCall Free for 3 Days" block />
          <View style={{ alignItems: "center", marginTop: spacing.md }}>
            <TextLink href={NEXTCALL_URL}>Explore NextCall</TextLink>
          </View>
        </View>
      )}
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
  const methodology = buildScoreMethodology(vm);

  return (
    <View style={styles.methodologyBox} wrap={false}>
      <Label style={{ marginBottom: spacing.xs }}>About This Assessment</Label>
      <Text style={{ fontFamily: font.family, fontSize: type.small, lineHeight: 1.5, color: palette.muted }}>
        This assessment was generated using publicly available business information, provider data,
        website accessibility checks, deterministic audit rules, and AI-assisted interpretation based
        on verified findings. The overall score is a weighted combination:{" "}
        {methodology.items.map((i) => `${i.name} ${i.weightPercent}%`).join(", ")}.
        It evaluates publicly detectable digital-presence signals and should
        not be considered a complete evaluation of internal business operations.
      </Text>
      <Text style={{ fontFamily: font.family, fontSize: type.small, lineHeight: 1.5, color: palette.muted, marginTop: spacing.sm }}>
        Because the assessment relies on publicly detectable signals, an absence of evidence is
        reported as &ldquo;not detected&rdquo; — not as proof that a capability does not exist.
      </Text>
      <Text style={{ fontFamily: font.family, fontSize: type.tiny, color: palette.subtle, marginTop: spacing.sm }}>
        {vm.businessName} · {vm.location} · Prepared {formattedDate} · Audit version {vm.auditVersion}
      </Text>
    </View>
  );
}
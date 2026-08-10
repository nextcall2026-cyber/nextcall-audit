/**
 * NEXT CALL · Digital Presence Audit
 *
 * Premium, personalized, information-first report document.
 *
 * Architecture: six narrative pages composed from reusable sections.
 * All content is derived dynamically from the audit ReportViewModel —
 * no business data is hardcoded. Page composition is explicit so each
 * section keeps page-internal integrity: keep-together blocks
 * (wrap={false}) and never-open-page breaks guarantee that no section
 * strands alone on a page and priorities/roadmaps are never split.
 * The fixed footer always numbers correctly ("01 / 06" style).
 */

import React from "react";
import { Document } from "@react-pdf/renderer";
import { ReportViewModel } from "@/types";
import { page } from "./pdf/design";
import { ReportPage } from "./pdf/primitives";
import {
  CoverSection,
  ExecutiveSummarySection,
  BreakdownSection,
  JourneySection,
  NextCallSection,
  RoadmapSection,
  NextCallCtaSection,
  MethodologySection,
} from "./pdf/Sections";
import { buildOverviewStatement } from "./pdf/builders";

interface AuditReportDocumentProps {
  vm: ReportViewModel;
}

export const AuditReportDocument = ({ vm }: AuditReportDocumentProps) => {
  const statement = buildOverviewStatement(vm);

  return (
    <Document
      author="NEXT CALL"
      subject={`Digital Presence Audit — ${vm.businessName}`}
      title={`Digital Presence Audit — ${vm.businessName}`}
    >
      {/* PAGE 1 — Business snapshot / premium cover */}
      <ReportPage businessName={vm.businessName}>
        <CoverSection vm={vm} statement={statement} />
      </ReportPage>

      {/* PAGE 2 — What we found + strengths + priority opportunities */}
      <ReportPage businessName={vm.businessName} breakNow>
        <ExecutiveSummarySection vm={vm} />
      </ReportPage>

      {/* PAGE 3 — Digital presence breakdown */}
      <ReportPage businessName={vm.businessName} breakNow>
        <BreakdownSection vm={vm} />
      </ReportPage>

      {/* PAGE 4 — Customer journey */}
      <ReportPage businessName={vm.businessName} breakNow>
        <JourneySection vm={vm} />
      </ReportPage>

      {/* PAGE 5 — One opportunity worth addressing (NEXT CALL) */}
      <ReportPage businessName={vm.businessName} breakNow>
        <NextCallSection vm={vm} />
      </ReportPage>

      {/* PAGE 6 — Prioritized roadmap + CTA + methodology */}
      <ReportPage businessName={vm.businessName} breakNow>
        <RoadmapSection vm={vm} />
        <NextCallCtaSection vm={vm} />
        <MethodologySection vm={vm} />
      </ReportPage>
    </Document>
  );
};

export { page }; // expose token for tests / consistency checks
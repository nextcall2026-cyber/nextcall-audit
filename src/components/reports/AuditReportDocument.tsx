/**
 * NEXT CALL · Digital Presence Audit
 *
 * Premium, personalized, information-first report document.
 *
 * Architecture: seven narrative pages composed from reusable sections.
 * All content is derived dynamically from the audit ReportViewModel —
 * no business data is hardcoded. Page composition is explicit so each
 * section keeps page-internal integrity: keep-together blocks
 * (wrap={false}) and never-open-page breaks guarantee that no section
 * strands alone on a page.
 *
 * Journey: AUDIT (P1–P5) → TRUST → PERSONALIZED NEXTCALL SOLUTION (P6)
 * → TRIAL CONVERSION (P7). The fixed footer always numbers correctly
 * ("01 / 07" style) and every link side uses the verified NextCall URLs
 * from src/lib/nextCallConfig.ts.
 */

import React from "react";
import { Document } from "@react-pdf/renderer";
import { ReportViewModel } from "@/types";
import { page } from "./pdf/design";
import { ReportPage } from "./pdf/primitives";
import {
  CoverSection,
  ExecutiveSummarySection,
  PriorityOpportunitiesSection,
  BreakdownSection,
  JourneySection,
  NextCallSolutionSection,
  NextCallFinalCtaSection,
  MethodologySection,
} from "./pdf/Sections";

interface AuditReportDocumentProps {
  vm: ReportViewModel;
}

export const AuditReportDocument = ({ vm }: AuditReportDocumentProps) => {
  return (
    <Document
      author="NEXT CALL"
      creator="NEXT CALL"
      subject={`Digital Presence Audit — ${vm.businessName}`}
      title={`Digital Presence Audit — ${vm.businessName}`}
      keywords={`Digital Presence Audit, NextCall, ${vm.businessName}`}
    >
      {/* PAGE 1 — Business snapshot / premium cover */}
      <ReportPage businessName={vm.businessName}>
        <CoverSection vm={vm} />
      </ReportPage>

      {/* PAGE 2 — Executive summary: what's working / opportunity / impact */}
      <ReportPage businessName={vm.businessName} breakNow>
        <ExecutiveSummarySection vm={vm} />
      </ReportPage>

      {/* PAGE 3 — Priority opportunities with recommended actions */}
      <ReportPage businessName={vm.businessName} breakNow>
        <PriorityOpportunitiesSection vm={vm} />
      </ReportPage>

      {/* PAGE 4 — Digital presence breakdown */}
      <ReportPage businessName={vm.businessName} breakNow>
        <BreakdownSection vm={vm} />
      </ReportPage>

      {/* PAGE 5 — Customer journey */}
      <ReportPage businessName={vm.businessName} breakNow>
        <JourneySection vm={vm} />
      </ReportPage>

      {/* PAGE 6 — Personalized NextCall solution + soft CTA */}
      <ReportPage businessName={vm.businessName} breakNow>
        <NextCallSolutionSection vm={vm} />
      </ReportPage>

      {/* PAGE 7 — Personalized final CTA + trial + methodology */}
      <ReportPage businessName={vm.businessName} breakNow>
        <NextCallFinalCtaSection vm={vm} />
        <MethodologySection vm={vm} />
      </ReportPage>
    </Document>
  );
};

export { page }; // expose token for tests / consistency checks
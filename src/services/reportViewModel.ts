/**
 * Report view-model assembly.
 *
 * Pure mapping from (Business, AuditResult, AuditReport) to the
 * ReportViewModel consumed by every PDF section. Kept free of
 * "server-only" and I/O so it can be unit-tested directly.
 *
 * NOTE ON CONSISTENCY (single source of truth):
 * The audit engine derives category scores and findings from business
 * data (business.phone, enrichment.website, ...). The report narrative
 * must never contradict those findings, so when a signal has no
 * enrichment source we fall back to the exact same fields the audit
 * engine checks — never to a different field.
 */

import {
  ReportViewModel,
  ReportCategoryDetail,
  ReportCategoryScore,
  AuditCategoryName,
  Business,
  AuditResult,
  AuditReport,
} from "@/types";

export function buildReportViewModel(
  business: Business,
  audit: AuditResult,
  aiReport: AuditReport
): ReportViewModel {
  // Format location string safely
  const locationParts = [
    business.location?.city,
    business.location?.state,
    business.location?.country,
  ].filter(Boolean);
  const locationStr = locationParts.join(", ");

  // Map category scores to the VM format
  const categoryScores: ReportCategoryScore[] = Object.entries(
    audit.categoryScores
  ).map(([name, data]) => ({
    name: name.charAt(0) + name.slice(1).toLowerCase(), // Format "WEBSITE" -> "Website"
    score: data.score,
    weight: data.weight,
  }));

  // Group findings by category for the narrative sections
  const categoryDetails: ReportCategoryDetail[] = categoryScores.map((c) => {
    const key = c.name.toUpperCase() as AuditCategoryName;
    return {
      key,
      name: c.name,
      score: c.score,
      weight: c.weight,
      findings: audit.findings.filter((f) => f.category === key),
    };
  });

  const enrichment = business.enrichment;
  const phones = enrichment?.phones ?? [];
  const websiteData = enrichment?.website;

  return {
    businessName: business.name || "Unknown Business",
    category: business.categories?.[0] || "General",
    location: locationStr || "Unknown Location",
    auditDate: audit.calculatedAt,
    auditVersion: audit.auditVersion,
    overallScore: audit.overallScore,
    confidence: audit.confidence,
    categoryScores,
    categoryDetails,
    signals: {
      // Match the audit engine's contactability rule: it accepts either
      // the discovery-level phone (business.phone) OR enrichment phones.
      // Using only enrichment phones contradicted findings for businesses
      // whose enrichment ran before/without a phone crawl.
      phone: phones[0]?.normalized ?? business.phone ?? null,
      // A website is only "detected" for narrative purposes when the audit
      // engine confirmed it via enrichment (it scores WEBSITE purely from
      // enrichment.website.isReachable). The discovery-level URL is NOT a
      // website detection — using it here caused "has a detectable website"
      // next to a 0/100 "No Website Found" score.
      website: websiteData?.url ?? null,
      preferredEmail: enrichment?.preferredEmail ?? null,
      rating: business.rating ?? null,
      reviewCount: business.reviewCount ?? null,
      bookingDetected: enrichment?.booking?.detected ?? false,
      bookingSystem: enrichment?.booking?.systemName ?? null,
      bookingUrl: enrichment?.booking?.url ?? null,
      socialProfiles: (enrichment?.socialProfiles ?? []).map((p) => ({
        platform: p.platform,
        url: p.url,
      })),
    },
    aiReport,
    nextCallOpportunities: audit.opportunities,
  };
}
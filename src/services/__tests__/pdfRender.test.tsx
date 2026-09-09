import { describe, it, expect } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";
import { AuditReportDocument } from "../../components/reports/AuditReportDocument";
import { ReportViewModel } from "@/types";

function sampleVm(): ReportViewModel {
  const categoryDetails = [
    {
      key: "WEBSITE" as const,
      name: "Website",
      score: 8,
      weight: 0.25,
      findings: [
        { category: "WEBSITE" as const, type: "WEAKNESS" as const, title: "No Website Found", evidence: "Business does not have a detectable website." },
        { category: "WEBSITE" as const, type: "WEAKNESS" as const, title: "Missing SSL Certificate", evidence: "Website does not use secure HTTPS." },
      ],
    },
    {
      key: "CONTACTABILITY" as const,
      name: "Contactability",
      score: 92,
      weight: 0.25,
      findings: [
        { category: "CONTACTABILITY" as const, type: "STRENGTH" as const, title: "Phone Available", evidence: "Business has a public phone number." },
      ],
    },
    {
      key: "BOOKING" as const,
      name: "Booking",
      score: 0,
      weight: 0.2,
      findings: [
        { category: "BOOKING" as const, type: "WEAKNESS" as const, title: "No Online Booking", evidence: "No publicly detectable booking system was found." },
      ],
    },
    {
      key: "SOCIAL" as const,
      name: "Social",
      score: 0,
      weight: 0.15,
      findings: [
        { category: "SOCIAL" as const, type: "WEAKNESS" as const, title: "No Social Presence", evidence: "No public social media profiles detected." },
      ],
    },
    {
      key: "REPUTATION" as const,
      name: "Reputation",
      score: 88,
      weight: 0.15,
      findings: [
        { category: "REPUTATION" as const, type: "STRENGTH" as const, title: "Excellent Reputation", evidence: "High rating of 4.7 stars." },
      ],
    },
  ];

  return {
    businessName: "JL Plumbing & Drains",
    category: "Plumber",
    location: "Austin, TX",
    auditDate: "2026-08-01T09:30:00.000Z",
    auditVersion: "1.0",
    overallScore: 38,
    confidence: "HIGH",
    categoryScores: categoryDetails.map(({ name, score, weight }) => ({ name, score, weight })),
    categoryDetails,
    signals: {
      phone: "+15125550123",
      website: null,
      preferredEmail: "service@jlplumbing.com",
      rating: 4.7,
      reviewCount: 182,
      bookingDetected: false,
      bookingSystem: null,
      bookingUrl: null,
      socialProfiles: [],
    },
    aiReport: {
      executiveSummary:
        "JL Plumbing & Drains has a strong local reputation but a minimal digital presence that relies almost entirely on phone communication.",
      overallAssessment:
        "The business is well-regarded locally, with a strong reputation signal and a working phone channel. Its digital footprint, however, is nearly absent — no website and no online booking path were detected — which leaves discovery and scheduling to word of mouth and phone calls.",
      strengths: ["High rating of 4.7 stars."],
      opportunities: ["Establish a simple service-focused website."],
      customerExperienceImpact: "Customers who prefer to research or book online have no path to do so.",
      nextCallRelevance:
        "Because phone communication is the primary and effectively the only scheduling route, an AI voice receptionist could help capture and schedule calls the business currently cannot answer.",
      recommendedNextSteps: ["Create a basic website", "Add an online booking path", "Publish business hours"],
    },
    nextCallOpportunities: [
      {
        type: "AI_AFTER_HOURS",
        title: "After-Hours Call Capture",
        evidence: "NextCall can answer calls after business hours so customer inquiries are captured and returned.",
      },
      {
        type: "AI_MISSED_CALL_RECOVERY",
        title: "Missed Call Recovery",
        evidence: "NextCall can identify missed calls and re-engage callers, reducing lost inbound opportunities.",
      },
      {
        type: "AI_LEAD_CAPTURE",
        title: "Lead Qualification",
        evidence: "NextCall can qualify inbound callers and route the business only the appointments that are ready to book.",
      },
    ],
  };
}

describe("AuditReportDocument render smoke test", () => {
  it("renders a valid multi-page PDF from realistic data", async () => {
    const buffer = await renderToBuffer(<AuditReportDocument vm={sampleVm()} />);

    expect(buffer.length).toBeGreaterThan(2000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");

    // Exactly 7 pages: snapshot, exec summary, priorities, breakdown,
    // journey, NextCall solution, final CTA.
    const pdfLatin1 = buffer.toString("latin1");
    const pageCount = pdfLatin1.match(/\/Count\s+(\d+)/);
    expect(pageCount ? Number(pageCount[1]) : 0).toBe(7);

    // Real clickable hyperlinks: NextCall CTAs + verified contact link.
    const uris = [...pdfLatin1.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1]);
    expect(uris.filter((u) => u.includes("getnextcall.com")).length).toBeGreaterThanOrEqual(2);
    expect(uris).toContain("mailto:service@jlplumbing.com");

    const outDir = process.env.TEMP_PDF_DIR || "C:/Users/WALTON/AppData/Local/Temp/opencode";
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "NextCall_Audit_JLPlumbing_sample.pdf");
    fs.writeFileSync(outPath, buffer);
    console.log(`PDF written to ${outPath} (${buffer.length} bytes)`);
  });

  it("renders for a fully detected business without error", async () => {
    const vm = sampleVm();
    const strongVm: ReportViewModel = {
      ...vm,
      businessName: "Summit Dental Care",
      overallScore: 84,
      signals: {
        ...vm.signals,
        website: "https://summitdental.example",
        bookingDetected: true,
        bookingSystem: "PracticeSuite",
      },
      categoryDetails: vm.categoryDetails.map((c) => {
        if (c.key === "WEBSITE" || c.key === "BOOKING") {
          return {
            ...c,
            score: 82,
            findings: [
              {
                category: c.key,
                type: "STRENGTH" as const,
                title: c.key === "WEBSITE" ? "Active Website" : "Online Booking Active",
                evidence: "Detected during this assessment.",
              },
            ],
          };
        }
        return c.key === "SOCIAL" ? { ...c, score: 82 } : c;
      }),
      categoryScores: vm.categoryDetails.map(({ name, score, weight }) => ({
        name,
        score: name === "Website" || name === "Booking" || name === "Social" ? 82 : score,
        weight,
      })),
      aiReport: { ...vm.aiReport, nextCallRelevance: "" },
      nextCallOpportunities: [],
    };
    const buffer = await renderToBuffer(<AuditReportDocument vm={strongVm} />);
    expect(buffer.length).toBeGreaterThan(2000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");

    // Seven pages again, with the verified website link embedded.
    const pdfLatin1 = buffer.toString("latin1");
    const pageCount = pdfLatin1.match(/\/Count\s+(\d+)/);
    expect(pageCount ? Number(pageCount[1]) : 0).toBe(7);
    const uris = [...pdfLatin1.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1]);
    expect(uris).toContain("https://summitdental.example");
    expect(uris.filter((u) => u.includes("getnextcall.com")).length).toBeGreaterThanOrEqual(2);
  });

  it("renders cleanly when the business itself is named 'NextCall'", async () => {
    // P1 regression: the product and a same-named business must not collide.
    const vm = sampleVm();
    const nextCallVm: ReportViewModel = {
      ...vm,
      businessName: "NextCall",
      category: "AI Software",
      signals: {
        ...vm.signals,
        website: "https://getnextcall.com",
        preferredEmail: "hello@getnextcall.com",
      },
      categoryDetails: vm.categoryDetails.map((c) =>
        c.key === "WEBSITE"
          ? {
              ...c,
              score: 80,
              findings: [
                {
                  category: "WEBSITE" as const,
                  type: "STRENGTH" as const,
                  title: "Active Website",
                  evidence: "The business website was live and reachable.",
                },
              ],
            }
          : c
      ),
    };
    const buffer = await renderToBuffer(<AuditReportDocument vm={nextCallVm} />);
    expect(buffer.length).toBeGreaterThan(2000);
    const pdfLatin1 = buffer.toString("latin1");
    const pageCount = pdfLatin1.match(/\/Count\s+(\d+)/);
    expect(pageCount ? Number(pageCount[1]) : 0).toBe(7);
    const uris = [...pdfLatin1.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => m[1]);
    expect(uris).toContain("https://getnextcall.com");
    expect(uris).toContain("mailto:hello@getnextcall.com");
  });
});
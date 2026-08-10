import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { persistenceService } from "@/services/persistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { AuditReportDocument } from "@/components/reports/AuditReportDocument";
import { ReportViewModel, ReportCategoryScore, AuditCategoryName, Business, AuditResult, AuditReport } from "@/types";
import { logger } from "@/lib/logger";
import { ValidationError } from "@/lib/errors";

export class ReportService {
    async generatePdfBuffer(businessId: string): Promise<Buffer> {
        logger.info(`[ReportService] Starting PDF generation for business: ${businessId}`);

        // 1. Fetch Business Data
        const business = await persistenceService.getBusinessById(businessId);
        if (!business) {
            throw new ValidationError("Business not found.");
        }

        // 2. Fetch Latest Audit
        const storedAudit = await auditPersistenceService.getLatestAudit(businessId);
        if (!storedAudit) {
            throw new ValidationError("No audit found for this business. Please run an audit first.");
        }

        // 3. Verify AI Report exists
        if (!storedAudit.aiReport) {
            throw new ValidationError("No AI report found for this business. Please ensure the AI report generation is complete.");
        }

        // 4. Assemble the Report View Model
        const vm = this.buildViewModel(business, storedAudit.audit, storedAudit.aiReport);

        // 5. Render PDF to Buffer
        try {
            logger.info(`[ReportService] Rendering PDF document for ${business.name}...`);
            const pdfBuffer = await renderToBuffer(<AuditReportDocument vm={vm} />);
            logger.info(`[ReportService] PDF successfully rendered for ${businessId}. Size: ${pdfBuffer.length} bytes.`);

            return pdfBuffer;
        } catch (error: any) {
            logger.error(`[ReportService] Failed to render PDF: ${error.message}`);
            throw new Error("Failed to generate PDF document.");
        }
    }

    private buildViewModel(business: Business, audit: AuditResult, aiReport: AuditReport): ReportViewModel {
        // Format location string safely
        const locationParts = [
            business.location?.city,
            business.location?.state,
            business.location?.country
        ].filter(Boolean);
        const locationStr = locationParts.join(", ");

        // Map category scores to the VM format
        const categoryScores: ReportCategoryScore[] = Object.entries(audit.categoryScores).map(([name, data]) => ({
            name: name.charAt(0) + name.slice(1).toLowerCase(), // Format "WEBSITE" -> "Website"
            score: data.score
        }));

        // Group findings by category for the narrative sections
        const categoryDetails = categoryScores.map((c) => ({
            key: c.name.toUpperCase() as AuditCategoryName,
            name: c.name,
            score: c.score,
            findings: audit.findings.filter((f) => f.category === c.name.toUpperCase())
        }));

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
                phone: phones[0]?.normalized ?? null,
                website: websiteData?.url ?? business.website ?? null,
                preferredEmail: enrichment?.preferredEmail ?? null,
                rating: business.rating ?? null,
                reviewCount: business.reviewCount ?? null,
                bookingDetected: enrichment?.booking?.detected ?? false,
                bookingSystem: enrichment?.booking?.systemName ?? null
            },
            aiReport,
            nextCallOpportunities: audit.opportunities
        };
    }
}

export const reportService = new ReportService();
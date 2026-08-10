import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { persistenceService } from "@/services/persistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { AuditReportDocument } from "@/components/reports/AuditReportDocument";
import { buildReportViewModel } from "@/services/reportViewModel";
import { auditConsistencyIssues } from "@/components/reports/pdf/builders";
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
        const vm = buildReportViewModel(business, storedAudit.audit, storedAudit.aiReport);

        // 4b. Validation layer: never render a report whose narrative signals
        // contradict the audit result (Issue 17). Log so data bugs surface.
        const issues = auditConsistencyIssues(vm);
        if (issues.length > 0) {
            for (const issue of issues) {
                logger.warn(`[ReportService] Consistency guard (${issue.section}): ${issue.message}`);
            }
        }

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
}

export const reportService = new ReportService();
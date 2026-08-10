import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { ReportViewModel } from "@/types";

// Create professional styles for the PDF
const styles = StyleSheet.create({
    page: {
        flexDirection: "column",
        backgroundColor: "#FFFFFF",
        padding: 40,
        fontFamily: "Helvetica",
        fontSize: 11,
        color: "#334155", // Slate 700
    },
    headerContainer: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        borderBottom: "2px solid #3B82F6",
        paddingBottom: 10,
        marginBottom: 20,
    },
    branding: {
        fontSize: 14,
        fontWeight: "bold",
        color: "#3B82F6",
        textTransform: "uppercase",
        letterSpacing: 1,
    },
    auditTitle: {
        fontSize: 20,
        fontWeight: "bold",
        color: "#0F172A",
        marginTop: 10,
    },
    metaInfo: {
        textAlign: "right",
        fontSize: 9,
        color: "#64748B",
    },
    businessInfoContainer: {
        marginBottom: 20,
    },
    businessName: {
        fontSize: 24,
        fontWeight: "bold",
        color: "#0F172A",
        marginBottom: 4,
    },
    businessDetails: {
        fontSize: 12,
        color: "#64748B",
    },
    scoreSection: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "#F8FAFC",
        borderRadius: 8,
        padding: 20,
        marginBottom: 20,
    },
    scoreBlock: {
        flexDirection: "column",
        alignItems: "center",
    },
    scoreValue: {
        fontSize: 48,
        fontWeight: "bold",
        color: "#3B82F6",
    },
    scoreMax: {
        fontSize: 16,
        color: "#94A3B8",
    },
    scoreLabel: {
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 1,
        color: "#64748B",
        marginTop: 5,
    },
    confidenceBadge: {
        padding: 6,
        borderRadius: 4,
        fontSize: 10,
        fontWeight: "bold",
        textTransform: "uppercase",
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "bold",
        color: "#0F172A",
        marginBottom: 8,
        marginTop: 15,
        borderBottom: "1px solid #E2E8F0",
        paddingBottom: 4,
    },
    paragraph: {
        fontSize: 11,
        lineHeight: 1.5,
        marginBottom: 10,
        textAlign: "justify",
    },
    // --- NEW STYLES FOR PHASE 3 ---
    categoryGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 10,
    },
    categoryCard: {
        width: "48%",
        backgroundColor: "#F8FAFC",
        padding: 10,
        borderRadius: 6,
        border: "1px solid #E2E8F0",
    },
    categoryHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 5,
    },
    categoryName: {
        fontSize: 10,
        fontWeight: "bold",
        textTransform: "uppercase",
        color: "#64748B",
    },
    categoryScore: {
        fontSize: 10,
        fontWeight: "bold",
        color: "#0F172A",
    },
    progressBarBg: {
        height: 4,
        backgroundColor: "#E2E8F0",
        borderRadius: 2,
    },
    progressBarFill: {
        height: 4,
        borderRadius: 2,
    },
    listItem: {
        flexDirection: "row",
        marginBottom: 5,
        paddingRight: 10,
    },
    bullet: {
        width: 10,
        fontSize: 11,
        lineHeight: 1.5,
    },
    itemText: {
        flex: 1,
        fontSize: 11,
        lineHeight: 1.5,
        textAlign: "justify",
    },
    nextCallBox: {
        backgroundColor: "#F5F3FF", // Purple 50
        border: "1px solid #DDD6FE", // Purple 200
        borderRadius: 8,
        padding: 15,
        marginTop: 5,
    },
    nextCallText: {
        fontSize: 11,
        lineHeight: 1.5,
        color: "#4C1D95", // Purple 900
        textAlign: "justify",
    },
    methodologyBox: {
        marginTop: 20,
        backgroundColor: "#F1F5F9",
        borderRadius: 6,
        padding: 10,
    },
    methodologyText: {
        fontSize: 8,
        color: "#64748B",
        lineHeight: 1.4,
        textAlign: "justify",
    },
    footer: {
        position: "absolute",
        bottom: 30,
        left: 40,
        right: 40,
        flexDirection: "row",
        justifyContent: "space-between",
        borderTop: "1px solid #E2E8F0",
        paddingTop: 10,
        fontSize: 8,
        color: "#94A3B8",
    },
});

interface AuditReportDocumentProps {
    vm: ReportViewModel;
}

export const AuditReportDocument = ({ vm }: AuditReportDocumentProps) => {
    const dateObj = new Date(vm.auditDate);
    const formattedDate = dateObj.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    // Helper to get color based on score
    const getScoreColor = (score: number) => {
        if (score >= 75) return "#16A34A"; // Green
        if (score >= 50) return "#CA8A04"; // Yellow
        return "#DC2626"; // Red
    };

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Header / Cover */}
                <View style={styles.headerContainer}>
                    <View>
                        <Text style={styles.branding}>NextCall Prospector</Text>
                        <Text style={styles.auditTitle}>Digital Presence Audit</Text>
                    </View>
                    <View style={styles.metaInfo}>
                        <Text>Prepared: {formattedDate}</Text>
                        <Text>Version: {vm.auditVersion}</Text>
                    </View>
                </View>

                {/* Business Information */}
                <View style={styles.businessInfoContainer}>
                    <Text style={styles.businessName}>{vm.businessName}</Text>
                    <Text style={styles.businessDetails}>
                        {vm.category} | {vm.location}
                    </Text>
                </View>

                {/* Overall Score & Confidence */}
                <View style={styles.scoreSection}>
                    <View style={styles.scoreBlock}>
                        <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                            <Text style={styles.scoreValue}>{vm.overallScore}</Text>
                            <Text style={styles.scoreMax}> / 100</Text>
                        </View>
                        <Text style={styles.scoreLabel}>Overall Digital Presence Score</Text>
                    </View>

                    <View style={styles.scoreBlock}>
                        <Text style={[
                            styles.confidenceBadge,
                            {
                                backgroundColor: vm.confidence === 'HIGH' ? "#DCFCE7" : vm.confidence === 'MEDIUM' ? "#FEF9C3" : "#FEE2E2",
                                color: vm.confidence === 'HIGH' ? "#166534" : vm.confidence === 'MEDIUM' ? "#854D0E" : "#991B1B",
                            }
                        ]}>
                            {vm.confidence} Confidence
                        </Text>
                        <Text style={[styles.scoreLabel, { marginTop: 10 }]}>Audit Data Reliability</Text>
                    </View>
                </View>

                {/* Category Score Breakdown */}
                <Text style={styles.sectionTitle}>Category Breakdown</Text>
                <View style={styles.categoryGrid}>
                    {vm.categoryScores.map((cat, i) => (
                        <View key={i} style={styles.categoryCard}>
                            <View style={styles.categoryHeader}>
                                <Text style={styles.categoryName}>{cat.name}</Text>
                                <Text style={styles.categoryScore}>{cat.score}/100</Text>
                            </View>
                            <View style={styles.progressBarBg}>
                                <View style={[styles.progressBarFill, { width: `${cat.score}%`, backgroundColor: getScoreColor(cat.score) }]} />
                            </View>
                        </View>
                    ))}
                </View>

                {/* Executive Summary */}
                <Text style={styles.sectionTitle}>Executive Summary</Text>
                <Text style={styles.paragraph}>{vm.aiReport.executiveSummary}</Text>

                {/* Strengths */}
                <Text style={styles.sectionTitle}>What You're Doing Well</Text>
                {vm.aiReport.strengths.map((strength, i) => (
                    <View key={i} style={styles.listItem}>
                        <Text style={[styles.bullet, { color: "#16A34A" }]}>✓</Text>
                        <Text style={styles.itemText}>{strength}</Text>
                    </View>
                ))}

                {/* Opportunities */}
                <Text style={styles.sectionTitle}>Opportunities for Improvement</Text>
                {vm.aiReport.opportunities.map((opp, i) => (
                    <View key={i} style={styles.listItem}>
                        <Text style={[styles.bullet, { color: "#CA8A04" }]}>!</Text>
                        <Text style={styles.itemText}>{opp}</Text>
                    </View>
                ))}

                {/* Customer Journey Analysis */}
                <Text style={styles.sectionTitle}>Customer Journey Analysis</Text>
                <Text style={styles.paragraph}>{vm.aiReport.customerExperienceImpact}</Text>

                {/* NextCall Relevance */}
                <Text style={styles.sectionTitle}>NextCall Relevance</Text>
                <View style={styles.nextCallBox}>
                    <Text style={styles.nextCallText}>{vm.aiReport.nextCallRelevance}</Text>
                </View>

                {/* Recommended Next Steps */}
                <Text style={styles.sectionTitle}>Recommended Next Steps</Text>
                {vm.aiReport.recommendedNextSteps.map((step, i) => (
                    <View key={i} style={styles.listItem}>
                        <Text style={[styles.bullet, { fontWeight: "bold", color: "#3B82F6" }]}>{i + 1}.</Text>
                        <Text style={styles.itemText}>{step}</Text>
                    </View>
                ))}

                {/* Methodology */}
                <View style={styles.methodologyBox} break>
                    <Text style={{ fontSize: 9, fontWeight: "bold", color: "#475569", marginBottom: 4 }}>Audit Methodology & Transparency</Text>
                    <Text style={styles.methodologyText}>
                        This assessment was generated by the NextCall Prospector using publicly available business information, provider data, website accessibility checks, and deterministic audit rules. AI-assisted interpretation was used to generate the narrative sections based strictly on verified factual findings. This audit evaluates publicly detectable digital presence signals and should be considered an informational assessment rather than a complete evaluation of internal business operations.
                    </Text>
                </View>

                {/* Footer */}
                <View style={styles.footer} fixed>
                    <Text>NextCall Prospector - Confidential Internal Audit</Text>
                    <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
                </View>
            </Page>
        </Document>
    );
};
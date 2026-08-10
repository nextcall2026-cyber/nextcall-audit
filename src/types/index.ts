// ==========================================
// SHARED APPLICATION TYPES
// ==========================================

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface BusinessLocation {
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface BusinessDiscoveryParams {
  query: string; 
  boundingBox: BoundingBox; 
  center?: { lat: number; lng: number };
  radiusMeters?: number;
}

// --- ENRICHMENT TYPES ---

export type EnrichmentStatus = 
  | 'NOT_STARTED' 
  | 'IN_PROGRESS' 
  | 'COMPLETED' 
  | 'FAILED';

export interface WebsiteData {
  url: string;
  title?: string;
  description?: string;
  isReachable: boolean;
  requiresJsRendering?: boolean; 
}

export interface EmailData {
  address: string;
  type: "BUSINESS" | "GENERAL" | "PERSONAL" | "UNKNOWN";
  sourceUrl: string;
  sourceType: "MAILTO" | "VISIBLE_TEXT" | "OBFUSCATED" | "JSON_LD" | "ATTRIBUTE" | "EMBEDDED_DATA";
  confidence: number; // 0-100
}

export interface PhoneData {
  number: string; // Original extracted string
  normalized: string; // E.164 format (e.g., +15551234567)
  sourceUrl: string;
  sourceType: "TEL_LINK" | "JSON_LD" | "VISIBLE_TEXT";
  confidence: number; // 0-100
}

export interface SocialProfile {
  platform: 'facebook' | 'instagram' | 'linkedin' | 'tiktok' | 'youtube' | 'twitter' | 'other';
  url: string;
  sourceUrl: string;
  confidence: number;
}

export interface BookingData {
  detected: boolean;
  systemName?: string;
  url?: string;
  sourceUrl?: string;
  confidence?: number;
}

export type TriState = boolean | 'UNKNOWN';

export interface WebsiteFeatures {
  hasContactForm: TriState;
  hasLiveChat: TriState;
  hasClickToCall: TriState;
  hasSecureSSL: TriState;
}

export interface CrawlMetadata {
  pagesAttempted: number;
  pagesSuccessful: number;
  pagesFailed: number;
  pagesVisited: string[];
  crawlQuality: "STATIC_COMPLETE" | "STATIC_PARTIAL" | "JS_RENDERING_LIKELY" | "FAILED";
  renderingRequired: boolean;
  crawlDurationMs: number;
}

export interface EnrichmentData {
  status: EnrichmentStatus;
  lastAttemptedAt?: string;
  completedAt?: string;
  error?: string;
  website?: WebsiteData;
  emails?: EmailData[];
  preferredEmail?: string | null;
  phones?: PhoneData[];
  socialProfiles?: SocialProfile[];
  booking?: BookingData;
  features?: WebsiteFeatures;
  crawlMetadata?: CrawlMetadata;
}

// --- MAIN BUSINESS TYPE ---

export interface Business {
  id: string;
  name: string;
  phone?: string;
  website?: string; 
  location?: BusinessLocation;
  rating?: number;
  reviewCount?: number;
  categories?: string[];
  
  providerIds: Record<string, string>;
  providerUrl?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  
  enrichment?: EnrichmentData;
  
  sources: string[];

  // --- NEW: MODULE 13 FIELDS ---
  sourceProviders?: DiscoveryProviderName[];
  discoverySignals?: DiscoveryQualitySignals;
}

// --- AUDIT ENGINE TYPES (MODULE 4) ---

export type AuditCategoryName = 
  | 'WEBSITE' 
  | 'CONTACTABILITY' 
  | 'BOOKING' 
  | 'SOCIAL' 
  | 'REPUTATION';

export type FindingType = 
  | 'STRENGTH' 
  | 'WEAKNESS' 
  | 'OPPORTUNITY';

export interface AuditFinding {
  category: AuditCategoryName;
  type: FindingType;
  title: string;
  evidence: string;
}

export type NextCallOpportunityType = 
  | 'AI_BOOKING_ASSISTANT' 
  | 'AI_AFTER_HOURS' 
  | 'AI_LEAD_CAPTURE' 
  | 'AI_MISSED_CALL_RECOVERY';

export interface NextCallOpportunity {
  type: NextCallOpportunityType;
  title: string;
  evidence: string;
}

export interface ScoreBreakdownItem {
  rule: string;
  pointsAwarded: number;
  maxPoints: number;
  reason: string;
}

export interface CategoryScore {
  score: number; // 0-100
  maxScore: number; // Usually 100
  weight: number; // Contribution to overall score
  breakdown: ScoreBreakdownItem[];
}

export type AuditConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AuditResult {
  auditVersion: string; // e.g., "1.0"
  overallScore: number; // 0-100
  confidence: AuditConfidence;
  calculatedAt: string; // ISO Date string
  categoryScores: Record<AuditCategoryName, CategoryScore>;
  findings: AuditFinding[];
  opportunities: NextCallOpportunity[];
}

// --- AUDIT PERSISTENCE TYPES ---

export interface StoredAudit {
  id: string; // UUID for the audit record itself
  businessId: string; // Reference to the Business
  audit: AuditResult;
  aiReport?: AuditReport; 
  createdAt: string; // ISO Date string
}

// --- AI REPORT TYPES (MODULE 4) ---

export interface AuditReport {
  executiveSummary: string;
  overallAssessment: string;
  strengths: string[];
  opportunities: string[]; // Renamed from weaknesses
  customerExperienceImpact: string;
  nextCallRelevance: string;
  recommendedNextSteps: string[];
}

// --- REPORT VIEW MODEL TYPES (MODULE 5) ---

export interface ReportCategoryScore {
  name: string;
  score: number;
}

export interface ReportViewModel {
  businessName: string;
  category: string;
  location: string;
  auditDate: string;
  auditVersion: string;
  overallScore: number;
  confidence: string;
  categoryScores: ReportCategoryScore[];
  aiReport: AuditReport;
  nextCallOpportunities: NextCallOpportunity[];
}

// --- PROSPECT & PIPELINE TYPES (MODULE 6, 7, 8, 9 & 10) ---

export type PipelineStatus = 
  | 'NEW' 
  | 'READY_TO_CONTACT' 
  | 'CONTACTED' 
  | 'FOLLOW_UP' 
  | 'QUALIFIED' 
  | 'CONVERTED' 
  | 'UNQUALIFIED' 
  | 'CLOSED_LOST';

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

export type OutreachSequenceState = 
  | 'UNCONTACTED' 
  | 'INITIAL_SENT' 
  | 'FOLLOW_UP_1_SENT' 
  | 'FOLLOW_UP_2_SENT' 
  | 'FOLLOW_UP_3_SENT' 
  | 'CLOSE_LOOP_SENT' 
  | 'COMPLETED' 
  | 'REPLIED' 
  | 'BOUNCED' 
  | 'UNSUBSCRIBED' 
  | 'STOPPED';

// --- NEW: MODULE 10 PRIORITY INTELLIGENCE TYPES ---
export type PriorityLevel = 'HOT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface PriorityBreakdown {
  contactability: number; // 0-100
  nextCallFit: number; // 0-100
  businessMaturity: number; // 0-100
  outreachReadiness: number; // 0-100
  reasons: string[]; // e.g., ["No online booking detected", "Valid business email found"]
}

export interface OpportunityBreakdownItem {
  category: string;
  signal: string;
  points: number;
  maxPoints: number;
  status: 'DETECTED' | 'NOT_DETECTED' | 'UNVERIFIED';
}

export interface OpportunityScore {
  score: number; // 0-100
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  reasons: string[]; // Top reasons for sales pitch
  evidence: string[]; // Specific verified facts found
  unknownFactors: string[]; // Things we couldn't verify
  scoreBreakdown: OpportunityBreakdownItem[]; // Full transparent breakdown
}

export interface BusinessSnapshot {
  name: string;
  phone?: string | null;
  website?: string | null;
  location?: BusinessLocation | null;
  rating?: number | null;
  reviewCount?: number | null;
  categories?: string[] | null;
  enrichmentStatus?: EnrichmentStatus | null;
  enrichmentCompletedAt?: string | null;
  preferredEmail?: string | null;
  emails?: string[];
  bookingDetected?: boolean;
  bookingUrl?: string | null;
  socialPlatforms?: string[];
  sourceProviders?: DiscoveryProviderName[];
  sources: string[];
  crawlQuality?: string | null;
}

export interface Prospect {
  id: string; 
  businessId: string; 
  pipelineStatus: PipelineStatus;
  outreachState: OutreachSequenceState;
  
  // Module 10: Automated Priority Intelligence
  priorityScore: number | null; // 0-100
  priorityLevel: PriorityLevel | null;
  priorityBreakdown: PriorityBreakdown | null;
  
  businessSnapshot?: BusinessSnapshot | null; // Durable snapshot of business data at add time
  viewAddedAt?: string | null; // When the prospect detail was first viewed
  viewedAt?: string | null; // Last viewed at
  viewedCount?: number; // Number of times viewed
  opportunityScore?: OpportunityScore | null; // Lead Opportunity Score at add time
  
  contactEmail: string | null; 
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  notes: Note[]; 
  isSuppressed: boolean; 
  suppressionReason: string | null; 
  createdAt: string;
  updatedAt: string;
}

// --- OUTREACH TYPES ---

export type OutreachStatus = 'PENDING' | 'SENT' | 'FAILED';
export type OutreachType = 'INITIAL' | 'FOLLOW_UP';
export type OutreachStage = 0 | 1 | 2 | 3 | 4; // 0=Initial, 1-3=Followups, 4=CloseLoop

export type CTAType = 
  | 'ASK_INTEREST' 
  | 'ASK_PERMISSION' 
  | 'OFFER_AUDIT' 
  | 'OFFER_DEMO' 
  | 'ASK_QUICK_QUESTION' 
  | 'OPEN_ENDED_REPLY' 
  | 'CLOSE_LOOP';

export type DeliveryStatus = 'ACCEPTED' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED';

export interface OutreachRecord {
  id: string; 
  prospectId: string; 
  businessId: string; 
  recipient: string;
  subject: string;
  body: string; 
  type: OutreachType; 
  sequenceStage: OutreachStage; 
  ctaType: CTAType | null; 
  angle: string | null; 
  resendMessageId: string | null;
  status: OutreachStatus;
  deliveryStatus: DeliveryStatus | null; 
  bounceReason: string | null; 
  error: string | null;
  sentAt: string;
  deliveredAt: string | null; 
}

export interface FollowUpDraft {
  subject: string;
  body: string;
  stage: OutreachStage; 
  ctaType: CTAType; 
  angle: string; 
}

// ==========================================
// MODULE 13: MULTI-PROVIDER DISCOVERY TYPES
// ==========================================

export type DiscoveryProviderName = 'SERPAPI' | 'APIFY' | 'TOMTOM' | 'GEOAPIFY';

export type UsageUnit = 'REQUEST' | 'RESULT' | 'CREDIT' | 'ACTOR_RUN';

export type ProviderQuotaStatus =
  | 'AVAILABLE'
  | 'UNCONFIGURED'
  | 'DISABLED'
  | 'DAILY_LIMIT_REACHED'
  | 'MONTHLY_LIMIT_REACHED'
  | 'RATE_LIMITED'
  | 'TEMPORARILY_UNAVAILABLE';

export interface ProviderConfig {
  name: DiscoveryProviderName;
  enabled: boolean;
  priority: number; // 1 is highest
  dailyLimit?: number;
  monthlyLimit?: number;
  maxResultsPerRequest?: number;
  usageUnit: UsageUnit;
}

export interface ProviderDiscoveryResult {
  businesses: Business[];
  usageAmount: number; // How many units were consumed by this call
  usageUnit: UsageUnit;
}

export type DiscoveryResultStrategy = 'FIRST_SUCCESS' | 'FILL_UNTIL_TARGET' | 'MERGE_ALL';

export interface DiscoveryQualitySignals {
  sourceCount: number;
  dataCompleteness: number; // 0-100 percentage
  hasWebsite: boolean | 'UNKNOWN';
  hasPhone: boolean | 'UNKNOWN';
  hasRating: boolean | 'UNKNOWN';
  hasReviewCount: boolean | 'UNKNOWN';
}
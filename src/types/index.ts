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
  lat?: number;
  lng?: number;
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
  notes?: string;
  
  sources: string[];

  // --- NEW: MODULE 13 FIELDS ---
  sourceProviders?: DiscoveryProviderName[];
  discoverySignals?: DiscoveryQualitySignals;

  /**
   * Cheap duplicate-detection key: "d:<domain>" when the business has a
   * website, otherwise "n:<squashed name>". Lets the ingest step check for an
   * existing record with one lookup instead of scanning the collection.
   */
  dedupeKey?: string;
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
  /** Weight used in the overall score, 0–1 (e.g. 0.25). Exposed so the report can show its methodology. */
  weight: number;
}

export interface ReportCategoryDetail {
  key: AuditCategoryName;
  name: string;
  score: number;
  /** Weight used in the overall score, 0–1 (e.g. 0.25). */
  weight: number;
  findings: AuditFinding[];
}

export interface ReportSignals {
  phone: string | null;
  website: string | null;
  preferredEmail: string | null;
  rating: number | null;
  reviewCount: number | null;
  bookingDetected: boolean;
  bookingSystem: string | null;
  bookingUrl: string | null;
  socialProfiles: { platform: string; url: string }[];
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
  categoryDetails: ReportCategoryDetail[];
  signals: ReportSignals;
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
  /**
   * True when the pipeline row was marked read by the automation itself —
   * the AI already wrote and sent the audit email, so there is nothing left
   * for the operator to review. Distinguishes "read by you" from
   * "read because the robot handled it".
   */
  readByAutomation?: boolean;
  /** When the automation last sent an email for this prospect. */
  autoSentAt?: string | null;
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

/**
 * The providers the app can send through. Mailgun goes first (100/day on the
 * free tier), Mailtop — Mailtrap.io — is the second free tier (150/day), and
 * Resend is the overflow (50/day), so one day's capacity is the sum of all
 * three. Keep this list in send order.
 *
 * Records stored during the retired Brevo era may still carry
 * provider: "brevo" in the database; the quota counter ignores those.
 */
export type EmailProviderName = 'mailgun' | 'mailtop' | 'resend';
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
  /** Which provider actually carried this email. Legacy records: undefined = Resend. */
  provider?: EmailProviderName | null;
  /** Provider-side message id (Mailgun id, Mailtrap message id, Resend id). */
  providerMessageId?: string | null;
  resendMessageId: string | null;
  status: OutreachStatus;
  deliveryStatus: DeliveryStatus | null; 
  bounceReason: string | null; 
  error: string | null;
  sentAt: string;
  deliveredAt: string | null; 
  openedAt: string | null;
}

export interface FollowUpDraft {
  subject: string;
  body: string;
  stage: OutreachStage; 
  ctaType: CTAType; 
  angle: string; 
}

// ==========================================
// JOB QUEUE (background workers)
// ==========================================

/** What a queued job has to do. AUDIT builds the audit; REPORT writes its AI report. */
export type AuditJobStage = 'AUDIT' | 'REPORT';

export type AuditJobStatus =
  /** Waiting for a worker. */
  | 'QUEUED'
  /** A worker holds the lease right now. */
  | 'RUNNING'
  /** Finished successfully. */
  | 'DONE'
  /** Failed but will be retried after a backoff. */
  | 'FAILED'
  /** Out of retries — stays visible so the operator can re-queue it. */
  | 'DEAD';

export interface AuditJob {
  id: string;
  /**
   * Set once the screenshots have been read and the business saved. A
   * screenshot-stage job starts without one; legacy and pipeline jobs always
   * carry it.
   */
  businessId: string;
  /** Shown in the queue panel without a second database read. */
  businessName: string;
  /**
   * Screenshot-stage job: the ingest stored these uploads and the worker
   * still has to read them with AI — nothing runs at queue time. null after.
   */
  screenshots?: { googleId: string; facebookId: string | null } | null;
  stage: AuditJobStage;
  status: AuditJobStatus;
  attempts: number;
  maxAttempts: number;
  /** Worker instance holding the lease (e.g. "audit-1730000000"). */
  workerId: string | null;
  /** Heartbeat timestamp; a stale lease is reclaimed by another worker. */
  lockedAt: string | null;
  /** Earliest time a worker may pick this up (retry backoff). */
  nextAttemptAt: string;
  /** Plain-English reason the last attempt failed — shown in the UI. */
  lastError: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** One pasted screenshot stored at queue time; deleted after its vision read. */
export interface ScreenshotUpload {
  id: string;
  kind: 'google' | 'facebook';
  mimeType: string;
  /** Base64 of the image — kept only until the vision read completes. */
  dataBase64: string;
  bytes: number;
  createdAt: string;
}

// ==========================================
// IN-APP NOTIFICATION FEED
// ==========================================

/** Every event the dashboard bell can surface. */
export type NotificationType =
  | 'PROSPECT_ADDED'
  | 'REPORT_READY'
  | 'REPORT_FAILED'
  | 'EMAIL_SENT'
  | 'EMAIL_FIRST_OPEN'
  | 'TRIAL_LINK_CLICKED'
  | 'REPLY_RECEIVED'
  | 'HOT_PROSPECT'
  | 'EMAIL_BOUNCED'
  | 'EMAIL_COMPLAINED'
  | 'UNSUBSCRIBED'
  | 'AI_PROVIDER_ISSUE'
  | 'AUTOMATION_ISSUE'
  | 'DAILY_DIGEST';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** Deep link inside the dashboard, e.g. /dashboard/pipeline/<id>. */
  href: string | null;
  prospectId: string | null;
  businessId: string | null;
  /** Suppresses repeats of the same event within 12 hours. */
  dedupeKey: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationSettings {
  enabled: Record<NotificationType, boolean>;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  timezone: string;
  updatedAt: string;
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
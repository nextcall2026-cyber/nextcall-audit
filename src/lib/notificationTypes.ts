import { NotificationType } from "@/types";

/**
 * Single source of truth for the notification catalogue — shared by the
 * server-side service (defaults, critical set) and the dashboard UI (labels,
 * icons, settings switches). Kept free of server-only and React imports so
 * both sides can use it.
 */

export const NOTIFICATION_TYPES: NotificationType[] = [
  "PROSPECT_ADDED",
  "REPORT_READY",
  "REPORT_FAILED",
  "EMAIL_SENT",
  "EMAIL_FIRST_OPEN",
  "TRIAL_LINK_CLICKED",
  "REPLY_RECEIVED",
  "HOT_PROSPECT",
  "EMAIL_BOUNCED",
  "EMAIL_COMPLAINED",
  "UNSUBSCRIBED",
  "AI_PROVIDER_ISSUE",
  "AUTOMATION_ISSUE",
  "DAILY_DIGEST",
];

/**
 * Types that are always delivered, even during quiet hours — losing these
 * would cost real money or reputation (a reply, a bounce, a broken provider).
 */
export const CRITICAL_NOTIFICATION_TYPES: NotificationType[] = [
  "REPLY_RECEIVED",
  "EMAIL_BOUNCED",
  "EMAIL_COMPLAINED",
  "UNSUBSCRIBED",
  "AI_PROVIDER_ISSUE",
  "AUTOMATION_ISSUE",
  "REPORT_FAILED",
];

/** Short human label per notification type (used in filters and settings). */
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  PROSPECT_ADDED: "New prospect",
  REPORT_READY: "Audit report ready",
  REPORT_FAILED: "Audit report failed",
  EMAIL_SENT: "Email sent",
  EMAIL_FIRST_OPEN: "Email opened",
  TRIAL_LINK_CLICKED: "Trial link clicked",
  REPLY_RECEIVED: "Reply received",
  HOT_PROSPECT: "Hot prospect",
  EMAIL_BOUNCED: "Email bounced",
  EMAIL_COMPLAINED: "Spam complaint",
  UNSUBSCRIBED: "Unsubscribed",
  AI_PROVIDER_ISSUE: "AI provider issue",
  AUTOMATION_ISSUE: "Automation issue",
  DAILY_DIGEST: "Daily digest",
};

/** Emoji per type — keeps the feed scannable without an icon font. */
export const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  PROSPECT_ADDED: "🆕",
  REPORT_READY: "✅",
  REPORT_FAILED: "❌",
  EMAIL_SENT: "📤",
  EMAIL_FIRST_OPEN: "👀",
  TRIAL_LINK_CLICKED: "🎯",
  REPLY_RECEIVED: "💬",
  HOT_PROSPECT: "🔥",
  EMAIL_BOUNCED: "⛔",
  EMAIL_COMPLAINED: "🚫",
  UNSUBSCRIBED: "↩️",
  AI_PROVIDER_ISSUE: "🔋",
  AUTOMATION_ISSUE: "⚙️",
  DAILY_DIGEST: "📊",
};

export function iconFor(type: NotificationType): string {
  return NOTIFICATION_ICONS[type] ?? "🔔";
}

export function labelFor(type: NotificationType): string {
  return NOTIFICATION_LABELS[type] ?? type;
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { CheckCircle2, XCircle, Info, Shield, Mail, Brain, Search, Gauge } from "lucide-react";
import AutoSendSettingsCard from "@/components/notifications/AutoSendSettingsCard";
import { emailQuotaService } from "@/services/emailQuotaService";
import { dbUsageService } from "@/services/dbUsageService";
import { EMAIL_PROVIDER_LABELS, ProviderCapacity, totalRemaining } from "@/lib/emailRouting";
import { formatBytes, formatCount } from "@/lib/formatBytes";

// Today's send counts come from the database, so this page must not be
// pre-rendered at build time.
export const dynamic = "force-dynamic";

function StatusBadge({ configured }: { configured: boolean }) {
    return configured
        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" /> Configured</span>
        : <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full"><XCircle className="h-3 w-3" /> Not Configured</span>;
}

function ConfigRow({ label, configured, description }: { label: string; configured: boolean; description: string }) {
    return (
        <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
            <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
            </div>
            <StatusBadge configured={configured} />
        </div>
    );
}

export default async function SettingsPage() {
    const hasOpenAI = !!env.OPENAI_API_KEY;
    const hasBrevo = !!env.BREVO_API_KEY;
    const hasResend = !!env.RESEND_API_KEY;
    const hasSerpApi = !!env.SERPAPI_API_KEY;
    const hasApify = !!env.APIFY_API_TOKEN && !!env.APIFY_ACTOR_ID;
    const hasTomTom = !!env.TOMTOM_API_KEY;
    const hasGeoapify = !!env.GEOAPIFY_API_KEY;
    const hasAstra = !!env.ASTRA_DB_APPLICATION_TOKEN && !!env.ASTRA_DB_API_ENDPOINT;
    const hasAppPassword = !!env.APP_PASSWORD;

    // Never let a database hiccup take the settings page down — the capacity
    // panel simply stays hidden when today's counts cannot be read.
    const capacity: ProviderCapacity[] | null = await emailQuotaService
        .getCapacities()
        .catch(() => null);

    // Storage estimate: document counts plus a sample of each collection.
    const dbUsage = await dbUsageService.getUsage().catch(() => null);

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">View application configuration and service status.</p>
            </div>

            {/* Outreach automation lives here rather than under Notifications:
                it is a sending rule, not an alert. */}
            <section className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold text-foreground">Outreach automation</h2>
                    <p className="text-sm text-muted-foreground">
                        Whether the app emails new audits by itself, how many a day, and when.
                    </p>
                </div>
                <AutoSendSettingsCard />
            </section>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                        <Info className="h-4 w-4 text-primary" />
                        <CardTitle className="text-sm font-semibold">Application</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-center justify-between py-2 border-b border-border">
                            <span className="text-sm text-muted-foreground">Version</span>
                            <span className="text-sm font-medium text-foreground">0.1.0</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-border">
                            <span className="text-sm text-muted-foreground">Framework</span>
                            <span className="text-sm font-medium text-foreground">Next.js 16</span>
                        </div>
                        <div className="flex items-center justify-between py-2">
                            <span className="text-sm text-muted-foreground">Environment</span>
                            <span className="text-sm font-medium text-foreground capitalize">{env.NODE_ENV}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        <CardTitle className="text-sm font-semibold">Authentication</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ConfigRow
                            label="Access Password"
                            configured={hasAppPassword}
                            description="Protects the dashboard from unauthorized access"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                        <Brain className="h-4 w-4 text-primary" />
                        <CardTitle className="text-sm font-semibold">AI Provider</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ConfigRow
                            label="OpenAI API"
                            configured={hasOpenAI}
                            description="Powers AI audit reports and outreach drafting"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                        <Mail className="h-4 w-4 text-primary" />
                        <CardTitle className="text-sm font-semibold">Email & Outreach</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                        <ConfigRow
                            label="Brevo API"
                            configured={hasBrevo}
                            description="Primary sender — carries the first 300 emails of the day"
                        />
                        <ConfigRow
                            label="Resend API"
                            configured={hasResend}
                            description="Overflow sender — takes the next 50 once Brevo is spent"
                        />
                    </CardContent>
                </Card>

                {capacity && (
                    <Card>
                        <CardHeader className="flex flex-row items-center gap-2">
                            <Gauge className="h-4 w-4 text-primary" />
                            <CardTitle className="text-sm font-semibold">Send capacity today</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-baseline justify-between">
                                <span className="text-sm text-muted-foreground">Emails left today</span>
                                <span className="text-2xl font-bold text-foreground">{totalRemaining(capacity)}</span>
                            </div>

                            {capacity.map((provider) => {
                                const percent = provider.limit > 0
                                    ? Math.min(100, Math.round((provider.used / provider.limit) * 100))
                                    : 0;

                                return (
                                    <div key={provider.name} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-medium text-foreground">{EMAIL_PROVIDER_LABELS[provider.name]}</span>
                                            <span className="text-muted-foreground">
                                                {provider.configured ? `${provider.used} / ${provider.limit}` : "Not configured"}
                                            </span>
                                        </div>
                                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                                        </div>
                                    </div>
                                );
                            })}

                            <p className="text-xs text-muted-foreground">
                                Brevo sends first, Resend takes over when Brevo&apos;s daily quota is spent. Both reset at 00:00 UTC.
                            </p>
                        </CardContent>
                    </Card>
                )}

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                        <Search className="h-4 w-4 text-primary" />
                        <CardTitle className="text-sm font-semibold">Business Discovery</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                        <ConfigRow
                            label="SerpApi"
                            configured={hasSerpApi}
                            description="Primary Google Maps/local discovery"
                        />
                        <ConfigRow
                            label="Apify"
                            configured={hasApify}
                            description="Secondary Google Maps scraping actor"
                        />
                        <ConfigRow
                            label="TomTom Search API"
                            configured={hasTomTom}
                            description="Geographic POI search fallback"
                        />
                        <ConfigRow
                            label="Geoapify API"
                            configured={hasGeoapify}
                            description="Final fallback place discovery"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2">
                        <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <ellipse cx="12" cy="5" rx="9" ry="3" />
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                        </svg>
                        <CardTitle className="text-sm font-semibold">Database</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ConfigRow
                            label="Astra DB"
                            configured={hasAstra}
                            description="Stores prospects, audits, and outreach records"
                        />

                        {dbUsage && (
                            <div className="mt-3 space-y-3 border-t border-border pt-3">
                                <div className="flex items-baseline justify-between">
                                    <span className="text-sm text-muted-foreground">Storage used</span>
                                    <span className="text-lg font-bold text-foreground">
                                        {formatBytes(dbUsage.estimatedBytes)}
                                    </span>
                                </div>

                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                    <div
                                        className="h-full rounded-full bg-primary"
                                        style={{ width: `${dbUsage.percentUsed === 0 ? 0 : Math.max(2, dbUsage.percentUsed)}%` }}
                                    />
                                </div>

                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>{dbUsage.percentUsed}% of {formatBytes(dbUsage.limitBytes)}</span>
                                    <span>{formatCount(dbUsage.totalDocuments)} documents</span>
                                </div>

                                <div className="space-y-1">
                                    {dbUsage.collections.map((collection) => (
                                        <div key={collection.name} className="flex items-center justify-between text-xs">
                                            <span className="font-medium text-foreground">{collection.name}</span>
                                            <span className="text-muted-foreground">
                                                {formatCount(collection.documents)} docs · {formatBytes(collection.estimatedBytes)}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <p className="text-xs text-muted-foreground">
                                    Estimated from document counts and an average document size — biggest collection first.
                                    Audits and outreach bodies grow fastest, so prune those to bring the number down.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { CheckCircle2, XCircle, Info, Shield, Mail, Brain, Search } from "lucide-react";

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

export default function SettingsPage() {
    const hasOpenAI = !!env.OPENAI_API_KEY;
    const hasResend = !!env.RESEND_API_KEY;
    const hasSerpApi = !!env.SERPAPI_API_KEY;
    const hasApify = !!env.APIFY_API_TOKEN && !!env.APIFY_ACTOR_ID;
    const hasTomTom = !!env.TOMTOM_API_KEY;
    const hasGeoapify = !!env.GEOAPIFY_API_KEY;
    const hasAstra = !!env.ASTRA_DB_APPLICATION_TOKEN && !!env.ASTRA_DB_API_ENDPOINT;
    const hasAppPassword = !!env.APP_PASSWORD;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">View application configuration and service status.</p>
            </div>

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
                            label="Resend API"
                            configured={hasResend}
                            description="Sends audit emails and follow-up sequences"
                        />
                    </CardContent>
                </Card>

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
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

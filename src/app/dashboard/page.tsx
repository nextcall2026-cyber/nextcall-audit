import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Users, TrendingUp, FileText, Send } from "lucide-react";
import { getProspectsCollection, getAuditsCollection, getOutreachCollection } from "@/lib/db";
import { Prospect } from "@/types";

export const dynamic = "force-dynamic";

async function loadStats() {
    // Personal-scale dataset: counting via find() is fine. Each query is
    // wrapped so one failing collection doesn't blank the whole dashboard.
    const safeCount = async (fn: () => Promise<unknown[]>): Promise<number> => {
        try {
            return (await fn()).length;
        } catch {
            return 0;
        }
    };

    let highOpportunity = 0;
    try {
        const prospects = (await getProspectsCollection().then(c => c.find({}).toArray())) as unknown as Prospect[];
        highOpportunity = prospects.filter(
            (p) => p.priorityLevel === "HOT" || p.priorityLevel === "HIGH" || (p.opportunityScore?.score ?? 0) >= 55
        ).length;
    } catch {
        highOpportunity = 0;
    }

    const [totalProspects, auditsGenerated, outreachSent] = await Promise.all([
        safeCount(() => getProspectsCollection().then(c => c.find({}).toArray())),
        safeCount(() => getAuditsCollection().then(c => c.find({}).toArray())),
        safeCount(() => getOutreachCollection().then(c => c.find({ status: "SENT" }).toArray())),
    ]);

    return { totalProspects, highOpportunity, auditsGenerated, outreachSent };
}

export default async function DashboardPage() {
    const { totalProspects, highOpportunity, auditsGenerated, outreachSent } = await loadStats();

    const stats = [
        {
            title: "Total Prospects",
            value: totalProspects,
            description: totalProspects > 0 ? "Tracked in your pipeline" : "No prospects tracked yet",
            icon: Users,
            iconBg: "bg-primary/10",
            iconColor: "text-primary",
        },
        {
            title: "High Opportunity",
            value: highOpportunity,
            description: highOpportunity > 0 ? "HOT or HIGH priority, or score 55+" : "Awaiting discovery",
            icon: TrendingUp,
            iconBg: "bg-emerald-50 dark:bg-emerald-950/30",
            iconColor: "text-emerald-600 dark:text-emerald-400",
        },
        {
            title: "Audits Generated",
            value: auditsGenerated,
            description: auditsGenerated > 0 ? "Audit reports stored" : "Start discovering to generate audits",
            icon: FileText,
            iconBg: "bg-violet-50 dark:bg-violet-950/30",
            iconColor: "text-violet-600 dark:text-violet-400",
        },
        {
            title: "Outreach Sent",
            value: outreachSent,
            description: outreachSent > 0 ? "Emails delivered via Resend" : "Manual outreach tracking",
            icon: Send,
            iconBg: "bg-orange-50 dark:bg-orange-950/30",
            iconColor: "text-orange-600 dark:text-orange-400",
        },
    ];

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                    <Card key={stat.title}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {stat.title}
                            </CardTitle>
                            <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", stat.iconBg)}>
                                <Icon className={cn("h-4 w-4", stat.iconColor)} />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold tracking-tight text-foreground">{stat.value}</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {stat.description}
                            </p>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}

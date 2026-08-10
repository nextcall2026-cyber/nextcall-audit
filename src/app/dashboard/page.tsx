import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Users, TrendingUp, FileText, Send } from "lucide-react";

const stats = [
    {
        title: "Total Prospects",
        value: "0",
        description: "No prospects tracked yet",
        icon: Users,
        iconBg: "bg-primary/10",
        iconColor: "text-primary",
    },
    {
        title: "High Opportunity",
        value: "0",
        description: "Awaiting discovery",
        icon: TrendingUp,
        iconBg: "bg-emerald-50 dark:bg-emerald-950/30",
        iconColor: "text-emerald-600 dark:text-emerald-400",
    },
    {
        title: "Audits Generated",
        value: "0",
        description: "Start discovering to generate audits",
        icon: FileText,
        iconBg: "bg-violet-50 dark:bg-violet-950/30",
        iconColor: "text-violet-600 dark:text-violet-400",
    },
    {
        title: "Outreach Sent",
        value: "0",
        description: "Manual outreach tracking",
        icon: Send,
        iconBg: "bg-orange-50 dark:bg-orange-950/30",
        iconColor: "text-orange-600 dark:text-orange-400",
    },
];

export default function DashboardPage() {
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
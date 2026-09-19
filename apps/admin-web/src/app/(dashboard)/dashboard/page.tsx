"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Building2, ShieldCheck, Users, Activity } from "lucide-react";
import { adminApi } from "@/lib/api-client";
import { Card, CardHeader, CardTitle, CardContent, Skeleton } from "@/components/ui/primitives";

const VERDICT_LABELS: Record<string, string> = {
  authentic: "Authentiques",
  suspicious: "Suspectes",
  rejected: "Rejetées",
  manual_review_required: "Revue manuelle",
};

function KpiCard({ icon: Icon, label, value, loading }: { icon: typeof Building2; label: string; value: number | string; loading: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          {loading ? <Skeleton className="mt-1 h-6 w-16" /> : <div className="text-2xl font-semibold">{value}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-dashboard-stats"], queryFn: adminApi.dashboardStats });

  const chartData = Object.entries(data?.verificationsByVerdict ?? {}).map(([verdict, count]) => ({
    verdict: VERDICT_LABELS[verdict] ?? verdict,
    count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de la plateforme, tous tenants confondus.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Building2} label="Tenants actifs" value={`${data?.activeTenants ?? 0} / ${data?.totalTenants ?? 0}`} loading={isLoading} />
        <KpiCard icon={ShieldCheck} label="Vérifications (total)" value={data?.verificationsTotal ?? 0} loading={isLoading} />
        <KpiCard icon={Activity} label="Vérifications (24h)" value={data?.verificationsLast24h ?? 0} loading={isLoading} />
        <KpiCard icon={Users} label="Administrateurs" value={data?.totalAdmins ?? 0} loading={isLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Répartition des verdicts</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="verdict" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

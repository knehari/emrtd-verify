"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CheckCircle2, XCircle, Clock, Eye } from "lucide-react";
import { tenantApi } from "@/lib/api-client";
import { Card, CardHeader, CardTitle, CardContent, Skeleton } from "@/components/ui/primitives";

const STATUS_META = {
  VERIFIED: { label: "Vérifiés", icon: CheckCircle2, color: "#059669" },
  UNVERIFIED: { label: "Non vérifiés", icon: XCircle, color: "#dc2626" },
  PENDING_REVIEW: { label: "En attente", icon: Clock, color: "#d97706" },
  WATCHLIST: { label: "À surveiller", icon: Eye, color: "#9333ea" },
} as const;

function StatCard({ statusKey, value, loading }: { statusKey: keyof typeof STATUS_META; value: number; loading: boolean }) {
  const meta = STATUS_META[statusKey];
  const Icon = meta.icon;
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{meta.label}</div>
          {loading ? <Skeleton className="mt-1 h-6 w-12" /> : <div className="text-2xl font-semibold">{value}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function TenantDashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ["tenant-stats"], queryFn: tenantApi.verifiedPersonStats });

  const chartData = (Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>).map((key) => ({
    status: STATUS_META[key].label,
    count: data?.[key] ?? 0,
    color: STATUS_META[key].color,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de vos clients vérifiés.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard statusKey="VERIFIED" value={data?.VERIFIED ?? 0} loading={isLoading} />
        <StatCard statusKey="UNVERIFIED" value={data?.UNVERIFIED ?? 0} loading={isLoading} />
        <StatCard statusKey="PENDING_REVIEW" value={data?.PENDING_REVIEW ?? 0} loading={isLoading} />
        <StatCard statusKey="WATCHLIST" value={data?.WATCHLIST ?? 0} loading={isLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Répartition par statut</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.status} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

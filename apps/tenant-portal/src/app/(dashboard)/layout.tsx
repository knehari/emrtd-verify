"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTenantAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/primitives";

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  const { tenantUser, loading } = useTenantAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !tenantUser) router.replace("/login");
  }, [tenantUser, loading, router]);

  if (loading || !tenantUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}

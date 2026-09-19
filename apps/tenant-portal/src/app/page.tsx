"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTenantAuth } from "@/lib/auth-context";

export default function RootPage() {
  const { tenantUser, loading } = useTenantAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(tenantUser ? "/dashboard" : "/login");
  }, [tenantUser, loading, router]);

  return null;
}

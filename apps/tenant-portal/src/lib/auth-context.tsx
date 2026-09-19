"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { tenantApi, ApiError } from "./api-client";

interface TenantSession {
  sub: string;
  email: string;
  kycClientId: string;
  role: "OWNER" | "MEMBER";
}

interface AuthContextValue {
  tenantUser: TenantSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function TenantAuthProvider({ children }: { children: ReactNode }) {
  const [tenantUser, setTenantUser] = useState<TenantSession | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    tenantApi
      .me()
      .then((res) => setTenantUser(res.tenantUser))
      .catch(() => setTenantUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await tenantApi.login(email, password);
    setTenantUser({ sub: res.tenantUser.id, email: res.tenantUser.email, kycClientId: res.tenantUser.kycClientId, role: res.tenantUser.role as "OWNER" | "MEMBER" });
  }

  async function logout() {
    await tenantApi.logout().catch(() => undefined);
    setTenantUser(null);
    router.push("/login");
  }

  return <AuthContext.Provider value={{ tenantUser, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useTenantAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useTenantAuth doit être utilisé sous TenantAuthProvider");
  return ctx;
}

export { ApiError };

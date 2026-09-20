"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { tenantApi, ApiError, type TenantLoginResponse } from "./api-client";

interface TenantSession {
  sub: string;
  email: string;
  kycClientId: string;
  role: "OWNER" | "MEMBER";
  totpEnabled: boolean;
}

interface AuthContextValue {
  tenantUser: TenantSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<TenantLoginResponse>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function TenantAuthProvider({ children }: { children: ReactNode }) {
  const [tenantUser, setTenantUser] = useState<TenantSession | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function refresh() {
    try {
      const res = await tenantApi.me();
      setTenantUser(
        res.tenantUser
          ? { sub: res.tenantUser.id, email: res.tenantUser.email, kycClientId: res.tenantUser.kycClientId, role: res.tenantUser.role, totpEnabled: res.tenantUser.totpEnabled }
          : null,
      );
    } catch {
      setTenantUser(null);
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string): Promise<TenantLoginResponse> {
    const res = await tenantApi.login(email, password);
    if (!res.requiresTwoFactor) {
      // totpEnabled est nécessairement false ici — voir la même note dans apps/admin-web.
      setTenantUser({ sub: res.tenantUser.id, email: res.tenantUser.email, kycClientId: res.tenantUser.kycClientId, role: res.tenantUser.role as "OWNER" | "MEMBER", totpEnabled: false });
    }
    return res;
  }

  async function verifyTwoFactor(challengeToken: string, code: string) {
    const res = await tenantApi.verifyTwoFactor(challengeToken, code);
    setTenantUser({ sub: res.tenantUser.id, email: res.tenantUser.email, kycClientId: res.tenantUser.kycClientId, role: res.tenantUser.role as "OWNER" | "MEMBER", totpEnabled: true });
  }

  async function logout() {
    await tenantApi.logout().catch(() => undefined);
    setTenantUser(null);
    router.push("/login");
  }

  return <AuthContext.Provider value={{ tenantUser, loading, login, verifyTwoFactor, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useTenantAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useTenantAuth doit être utilisé sous TenantAuthProvider");
  return ctx;
}

export { ApiError };

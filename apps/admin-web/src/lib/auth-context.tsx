"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { adminApi, ApiError, type AdminLoginResponse } from "./api-client";

interface AdminSession {
  sub: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPPORT";
  totpEnabled: boolean;
}

interface AuthContextValue {
  admin: AdminSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AdminLoginResponse>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function refresh() {
    try {
      const res = await adminApi.me();
      setAdmin(res.admin ? { sub: res.admin.id, email: res.admin.email, role: res.admin.role, totpEnabled: res.admin.totpEnabled } : null);
    } catch {
      setAdmin(null);
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string): Promise<AdminLoginResponse> {
    const res = await adminApi.login(email, password);
    if (!res.requiresTwoFactor) {
      // totpEnabled est nécessairement false ici : un compte avec 2FA actif reçoit toujours
      // requiresTwoFactor=true (voir AdminAuthService.login) — c'est verifyTwoFactor qui pose la
      // session dans le cas contraire.
      setAdmin({ sub: res.admin.id, email: res.admin.email, role: res.admin.role as "SUPER_ADMIN" | "SUPPORT", totpEnabled: false });
    }
    return res;
  }

  async function verifyTwoFactor(challengeToken: string, code: string) {
    const res = await adminApi.verifyTwoFactor(challengeToken, code);
    setAdmin({ sub: res.admin.id, email: res.admin.email, role: res.admin.role as "SUPER_ADMIN" | "SUPPORT", totpEnabled: true });
  }

  async function logout() {
    await adminApi.logout().catch(() => undefined);
    setAdmin(null);
    router.push("/login");
  }

  return <AuthContext.Provider value={{ admin, loading, login, verifyTwoFactor, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAdminAuth doit être utilisé sous AdminAuthProvider");
  return ctx;
}

export { ApiError };

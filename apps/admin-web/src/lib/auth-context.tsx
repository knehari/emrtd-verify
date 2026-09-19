"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { adminApi, ApiError } from "./api-client";

interface AdminSession {
  sub: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPPORT";
}

interface AuthContextValue {
  admin: AdminSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    adminApi
      .me()
      .then((res) => setAdmin(res.admin))
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await adminApi.login(email, password);
    setAdmin({ sub: res.admin.id, email: res.admin.email, role: res.admin.role as "SUPER_ADMIN" | "SUPPORT" });
  }

  async function logout() {
    await adminApi.logout().catch(() => undefined);
    setAdmin(null);
    router.push("/login");
  }

  return <AuthContext.Provider value={{ admin, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAdminAuth doit être utilisé sous AdminAuthProvider");
  return ctx;
}

export { ApiError };

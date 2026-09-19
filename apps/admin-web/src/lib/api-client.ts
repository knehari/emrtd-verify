const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message = (body as { message?: string | string[] } | undefined)?.message;
    throw new ApiError(response.status, Array.isArray(message) ? message.join(", ") : (message ?? `Erreur ${response.status}`));
  }

  return body as T;
}

export interface AdminUser {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPPORT";
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface KycClient {
  id: string;
  clientId: string;
  acceptedTrustLevels: string[];
  allowedFields: string[];
  active: boolean;
  createdAt: string;
}

export interface DashboardStats {
  totalTenants: number;
  activeTenants: number;
  totalAdmins: number;
  verificationsLast24h: number;
  verificationsByVerdict: Record<"authentic" | "suspicious" | "rejected" | "manual_review_required", number>;
  verificationsTotal: number;
}

export interface VerificationListItem {
  verificationId: string;
  clientId: string;
  documentType: string;
  issuingCountry: string;
  verdict: string;
  trustChainSource: string;
  trustChainLevel: string;
  createdAt: string;
}

export interface PaginatedResult<T> {
  page: number;
  pageSize: number;
  total: number;
  records: T[];
}

export const adminApi = {
  login: (email: string, password: string) => request<{ admin: { id: string; email: string; role: string } }>("/admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/admin/auth/logout", { method: "POST" }),
  me: () => request<{ admin: { sub: string; email: string; role: "SUPER_ADMIN" | "SUPPORT" } }>("/admin/auth/me"),

  dashboardStats: () => request<DashboardStats>("/admin/dashboard/stats"),

  listKycClients: () => request<KycClient[]>("/admin/kyc-clients"),
  getKycClient: (clientId: string) => request<KycClient>(`/admin/kyc-clients/${encodeURIComponent(clientId)}`),
  createKycClient: (data: { clientId: string; acceptedTrustLevels: string[]; allowedFields: string[] }) =>
    request<KycClient & { apiKey: string }>("/admin/kyc-clients", { method: "POST", body: JSON.stringify(data) }),
  updateKycClient: (clientId: string, data: Partial<{ acceptedTrustLevels: string[]; allowedFields: string[]; active: boolean }>) =>
    request<KycClient>(`/admin/kyc-clients/${encodeURIComponent(clientId)}`, { method: "PATCH", body: JSON.stringify(data) }),
  rotateKycClientKey: (clientId: string) =>
    request<KycClient & { apiKey: string }>(`/admin/kyc-clients/${encodeURIComponent(clientId)}/rotate-key`, { method: "POST" }),

  listAdminUsers: () => request<AdminUser[]>("/admin/admin-users"),
  createAdminUser: (data: { email: string; role: "SUPER_ADMIN" | "SUPPORT" }) =>
    request<AdminUser & { temporaryPassword: string }>("/admin/admin-users", { method: "POST", body: JSON.stringify(data) }),
  updateAdminUser: (id: string, data: Partial<{ role: "SUPER_ADMIN" | "SUPPORT"; active: boolean }>) =>
    request<AdminUser>(`/admin/admin-users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }),

  listVerifications: (params: { page?: number; pageSize?: number; verdict?: string; clientId?: string; issuingCountry?: string }) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, String(value));
    }
    return request<PaginatedResult<VerificationListItem>>(`/admin/verifications?${query.toString()}`);
  },
  getVerification: (verificationId: string) => request<Record<string, unknown>>(`/admin/verifications/${encodeURIComponent(verificationId)}`),
};

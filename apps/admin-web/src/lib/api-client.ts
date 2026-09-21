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
  // Content-Type: application/json n'est posé que si un corps est réellement envoyé — sinon
  // Fastify (parseur JSON par défaut) rejette la requête avec "Body cannot be empty when
  // content-type is set to 'application/json'" dès qu'un fetch() sans body (POST /logout,
  // /2fa/setup, etc.) envoie tout de même ce header avec Content-Length: 0. Bug réel trouvé en
  // navigateur lors de la vérification du 2FA (voir docs/admin-web.md "Vérification").
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
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
  /** true si une VerificationReview existe déjà pour ce cas (voir AdminVerificationsService). */
  reviewed: boolean;
}

export type VerificationReviewOutcome = "CONFIRMED_AUTHENTIC" | "CONFIRMED_REJECTED" | "ESCALATED";

export interface VerificationReview {
  outcome: VerificationReviewOutcome;
  reason: string;
  reviewedAt: string;
  reviewer: { id: string; email: string };
}

export interface PaginatedResult<T> {
  page: number;
  pageSize: number;
  total: number;
  records: T[];
}

export type AdminLoginResponse =
  | { requiresTwoFactor: true; challengeToken: string }
  | { requiresTwoFactor: false; admin: { id: string; email: string; role: string } };

export const adminApi = {
  login: (email: string, password: string) => request<AdminLoginResponse>("/admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  verifyTwoFactor: (challengeToken: string, code: string) =>
    request<{ admin: { id: string; email: string; role: string } }>("/admin/auth/2fa/verify", { method: "POST", body: JSON.stringify({ challengeToken, code }) }),
  logout: () => request<void>("/admin/auth/logout", { method: "POST" }),
  me: () => request<{ admin: { id: string; email: string; role: "SUPER_ADMIN" | "SUPPORT"; totpEnabled: boolean } | null }>("/admin/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/admin/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  setupTwoFactor: () => request<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }>("/admin/auth/2fa/setup", { method: "POST" }),
  enableTwoFactor: (code: string) => request<void>("/admin/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) }),
  disableTwoFactor: (password: string) => request<void>("/admin/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password }) }),

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
  getVerification: (verificationId: string) =>
    request<Record<string, unknown> & { review: VerificationReview | null }>(`/admin/verifications/${encodeURIComponent(verificationId)}`),
  reviewVerification: (verificationId: string, data: { outcome: VerificationReviewOutcome; reason: string }) =>
    request<VerificationReview>(`/admin/verifications/${encodeURIComponent(verificationId)}/review`, { method: "POST", body: JSON.stringify(data) }),
};

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
  // /2fa/setup, etc.) envoie tout de même ce header avec Content-Length: 0. Même bug réel que
  // celui trouvé et corrigé côté apps/admin-web (voir docs/admin-web.md "Vérification").
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

export type VerifiedPersonStatus = "VERIFIED" | "UNVERIFIED" | "PENDING_REVIEW" | "WATCHLIST";

export interface VerifiedPersonListItem {
  id: string;
  status: VerifiedPersonStatus;
  documentType: string;
  issuingCountry: string;
  displayFields: Record<string, { value: string; valid: boolean; checks: string[] }>;
  watchlistReason: string | null;
  firstVerifiedAt: string;
  lastVerifiedAt: string;
  verificationCount: number;
}

export interface VerifiedPersonStats {
  VERIFIED: number;
  UNVERIFIED: number;
  PENDING_REVIEW: number;
  WATCHLIST: number;
}

export interface TenantVerificationListItem {
  verificationId: string;
  documentType: string;
  issuingCountry: string;
  verdict: string;
  createdAt: string;
}

export interface PaginatedResult<T> {
  page: number;
  pageSize: number;
  total: number;
}

export type TenantLoginResponse =
  | { requiresTwoFactor: true; challengeToken: string }
  | { requiresTwoFactor: false; tenantUser: { id: string; email: string; kycClientId: string; role: string } };

export const tenantApi = {
  login: (email: string, password: string) =>
    request<TenantLoginResponse>("/portal/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  verifyTwoFactor: (challengeToken: string, code: string) =>
    request<{ tenantUser: { id: string; email: string; kycClientId: string; role: string } }>("/portal/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code }),
    }),
  logout: () => request<void>("/portal/auth/logout", { method: "POST" }),
  me: () =>
    request<{ tenantUser: { id: string; email: string; kycClientId: string; role: "OWNER" | "MEMBER"; totpEnabled: boolean } | null }>(
      "/portal/auth/me",
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/portal/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  setupTwoFactor: () => request<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }>("/portal/auth/2fa/setup", { method: "POST" }),
  enableTwoFactor: (code: string) => request<void>("/portal/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) }),
  disableTwoFactor: (password: string) => request<void>("/portal/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password }) }),

  verifiedPersonStats: () => request<VerifiedPersonStats>("/portal/verified-persons/stats"),

  listVerifiedPersons: (params: { page?: number; pageSize?: number; status?: string }) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, String(value));
    }
    return request<PaginatedResult<VerifiedPersonListItem> & { persons: VerifiedPersonListItem[] }>(`/portal/verified-persons?${query.toString()}`);
  },
  getVerifiedPerson: (id: string) => request<VerifiedPersonListItem>(`/portal/verified-persons/${encodeURIComponent(id)}`),
  updateVerifiedPersonStatus: (id: string, data: { status: VerifiedPersonStatus; watchlistReason?: string }) =>
    request<VerifiedPersonListItem>(`/portal/verified-persons/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }),

  listVerifications: (params: { page?: number; pageSize?: number; verdict?: string }) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, String(value));
    }
    return request<PaginatedResult<TenantVerificationListItem> & { records: TenantVerificationListItem[] }>(`/portal/verifications?${query.toString()}`);
  },
  getVerification: (verificationId: string) => request<Record<string, unknown>>(`/portal/verifications/${encodeURIComponent(verificationId)}`),
};

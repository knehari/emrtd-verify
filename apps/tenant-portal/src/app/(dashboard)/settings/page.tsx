"use client";

import { useTenantAuth } from "@/lib/auth-context";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/primitives";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Propriétaire",
  MEMBER: "Membre",
};

export default function SettingsPage() {
  const { tenantUser } = useTenantAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Informations de votre compte tenant.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Profil</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="text-sm font-medium">{tenantUser?.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Rôle</dt>
              <dd>
                <Badge variant="secondary">{tenantUser ? (ROLE_LABEL[tenantUser.role] ?? tenantUser.role) : ""}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Identifiant tenant (clientId)</dt>
              <dd className="font-mono text-sm">{tenantUser?.kycClientId}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

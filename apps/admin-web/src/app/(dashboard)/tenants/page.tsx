"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, KeyRound, Pencil, Copy, Check } from "lucide-react";
import { adminApi, ApiError, type KycClient } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input, Label, Badge, Skeleton, Card, CardContent } from "@/components/ui/primitives";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const TRUST_LEVELS = ["high", "medium", "low"] as const;
const IDENTITY_FIELDS = ["documentNumber", "dateOfBirth", "dateOfExpiry", "nationality", "sex", "primaryIdentifier", "secondaryIdentifier"] as const;

function CheckboxGroup({
  options,
  values,
  onChange,
}: {
  options: readonly string[];
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((option) => (
        <label key={option} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={values.includes(option)}
            onChange={(e) => onChange(e.target.checked ? [...values, option] : values.filter((v) => v !== option))}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

/** Affiche une clé API générée une seule fois — jamais réaffichée après fermeture. */
function ApiKeyRevealDialog({ apiKey, onClose }: { apiKey: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={apiKey !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clé API générée</DialogTitle>
          <DialogDescription>
            Cette clé ne sera plus jamais affichée — copiez-la et transmettez-la au tenant par un canal sécurisé.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 font-mono text-xs">
          <span className="flex-1 break-all">{apiKey}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (apiKey) navigator.clipboard.writeText(apiKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>J&apos;ai copié la clé</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateTenantDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (apiKey: string) => void }) {
  const [clientId, setClientId] = useState("");
  const [trustLevels, setTrustLevels] = useState<string[]>(["high"]);
  const [allowedFields, setAllowedFields] = useState<string[]>([]);
  const [lostStolenCheckRequired, setLostStolenCheckRequired] = useState(true);
  const [activeLivenessRequired, setActiveLivenessRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => adminApi.createKycClient({ clientId, acceptedTrustLevels: trustLevels, allowedFields, lostStolenCheckRequired, activeLivenessRequired }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-kyc-clients"] });
      onOpenChange(false);
      setClientId("");
      setTrustLevels(["high"]);
      setAllowedFields([]);
      setLostStolenCheckRequired(true);
      setActiveLivenessRequired(true);
      onCreated(result.apiKey);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Échec de la création"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau tenant</DialogTitle>
          <DialogDescription>Crée un client KYC autorisé à consommer l&apos;API de vérification.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="clientId">Identifiant (clientId)</Label>
            <Input id="clientId" placeholder="acme-bank" value={clientId} onChange={(e) => setClientId(e.target.value)} required pattern="[a-z0-9-]{3,64}" />
            <p className="text-xs text-muted-foreground">Minuscules, chiffres, tirets — 3 à 64 caractères.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Niveaux de confiance PKI acceptés</Label>
            <CheckboxGroup options={TRUST_LEVELS} values={trustLevels} onChange={setTrustLevels} />
          </div>
          <div className="space-y-1.5">
            <Label>Champs d&apos;identité autorisés</Label>
            <CheckboxGroup options={IDENTITY_FIELDS} values={allowedFields} onChange={setAllowedFields} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-input" checked={lostStolenCheckRequired} onChange={(e) => setLostStolenCheckRequired(e.target.checked)} />
            Registre des documents perdus/volés exigé (décoché = un registre non interrogé n&apos;est qu&apos;une information)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-input" checked={activeLivenessRequired} onChange={(e) => setActiveLivenessRequired(e.target.checked)} />
            Vivacité active exigée (décoché = une vivacité seulement passive n&apos;est qu&apos;une information)
          </label>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !clientId}>
              {mutation.isPending ? "Création…" : "Créer le tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTenantDialog({ tenant, onOpenChange }: { tenant: KycClient | null; onOpenChange: (open: boolean) => void }) {
  const [trustLevels, setTrustLevels] = useState<string[]>(tenant?.acceptedTrustLevels ?? []);
  const [allowedFields, setAllowedFields] = useState<string[]>(tenant?.allowedFields ?? []);
  const [lostStolenCheckRequired, setLostStolenCheckRequired] = useState(tenant?.lostStolenCheckRequired ?? true);
  const [activeLivenessRequired, setActiveLivenessRequired] = useState(tenant?.activeLivenessRequired ?? true);
  const [active, setActive] = useState(tenant?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => adminApi.updateKycClient(tenant!.clientId, { acceptedTrustLevels: trustLevels, allowedFields, lostStolenCheckRequired, activeLivenessRequired, active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-kyc-clients"] });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Échec de la mise à jour"),
  });

  if (!tenant) return null;

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (open) {
          setTrustLevels(tenant.acceptedTrustLevels);
          setAllowedFields(tenant.allowedFields);
          setLostStolenCheckRequired(tenant.lostStolenCheckRequired);
          setActiveLivenessRequired(tenant.activeLivenessRequired);
          setActive(tenant.active);
        }
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier {tenant.clientId}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label>Niveaux de confiance PKI acceptés</Label>
            <CheckboxGroup options={TRUST_LEVELS} values={trustLevels} onChange={setTrustLevels} />
          </div>
          <div className="space-y-1.5">
            <Label>Champs d&apos;identité autorisés</Label>
            <CheckboxGroup options={IDENTITY_FIELDS} values={allowedFields} onChange={setAllowedFields} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-input" checked={lostStolenCheckRequired} onChange={(e) => setLostStolenCheckRequired(e.target.checked)} />
            Registre des documents perdus/volés exigé (décoché = un registre non interrogé n&apos;est qu&apos;une information)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-input" checked={activeLivenessRequired} onChange={(e) => setActiveLivenessRequired(e.target.checked)} />
            Vivacité active exigée (décoché = une vivacité seulement passive n&apos;est qu&apos;une information)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-input" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Tenant actif (décoché = suspendu, API refusée)
          </label>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TenantsPage() {
  const { admin } = useAdminAuth();
  const canWrite = admin?.role === "SUPER_ADMIN";
  const queryClient = useQueryClient();
  const { data: tenants, isLoading } = useQuery({ queryKey: ["admin-kyc-clients"], queryFn: adminApi.listKycClients });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<KycClient | null>(null);
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);

  const rotateMutation = useMutation({
    mutationFn: (clientId: string) => adminApi.rotateKycClientKey(clientId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-kyc-clients"] });
      setRevealedApiKey(result.apiKey);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">Clients KYC autorisés à consommer l&apos;API de vérification.</p>
        </div>
        {canWrite && (
          <Button className="shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nouveau tenant
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !tenants || tenants.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">Aucun tenant pour l&apos;instant.</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Identifiant</TableHead>
              <TableHead>Confiance</TableHead>
              <TableHead>Champs autorisés</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Créé le</TableHead>
              {canWrite && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-medium">{tenant.clientId}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{tenant.acceptedTrustLevels.join(", ") || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{tenant.allowedFields.join(", ") || "aucun"}</TableCell>
                <TableCell>
                  <Badge variant={tenant.active ? "success" : "destructive"}>{tenant.active ? "Actif" : "Suspendu"}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(tenant.createdAt).toLocaleDateString("fr-FR")}</TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(tenant)} title="Modifier">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm(`Faire tourner la clé API de ${tenant.clientId} ? L'ancienne cessera immédiatement de fonctionner.`)) {
                          rotateMutation.mutate(tenant.clientId);
                        }
                      }}
                      title="Régénérer la clé API"
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setRevealedApiKey} />
      <EditTenantDialog tenant={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <ApiKeyRevealDialog apiKey={revealedApiKey} onClose={() => setRevealedApiKey(null)} />
    </div>
  );
}

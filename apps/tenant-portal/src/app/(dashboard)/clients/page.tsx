"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { tenantApi, ApiError, type VerifiedPersonListItem, type VerifiedPersonStatus } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Label, Badge, Skeleton, Card, CardContent, Textarea } from "@/components/ui/primitives";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "VERIFIED", label: "Vérifiés" },
  { value: "UNVERIFIED", label: "Non vérifiés" },
  { value: "PENDING_REVIEW", label: "En attente" },
  { value: "WATCHLIST", label: "À surveiller" },
];

const STATUS_BADGE: Record<VerifiedPersonStatus, "success" | "destructive" | "warning" | "watchlist"> = {
  VERIFIED: "success",
  UNVERIFIED: "destructive",
  PENDING_REVIEW: "warning",
  WATCHLIST: "watchlist",
};

const STATUS_LABEL: Record<VerifiedPersonStatus, string> = {
  VERIFIED: "Vérifié",
  UNVERIFIED: "Non vérifié",
  PENDING_REVIEW: "En attente",
  WATCHLIST: "À surveiller",
};

function displayFieldsSummary(fields: VerifiedPersonListItem["displayFields"]): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return "(aucun champ autorisé)";
  return entries.map(([key, field]) => `${key}: ${field.value}`).join(", ");
}

function ClientDetailDialog({ person, onOpenChange }: { person: VerifiedPersonListItem | null; onOpenChange: (open: boolean) => void }) {
  const [status, setStatus] = useState<VerifiedPersonStatus>(person?.status ?? "PENDING_REVIEW");
  const [reason, setReason] = useState(person?.watchlistReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => tenantApi.updateVerifiedPersonStatus(person!.id, { status, watchlistReason: status === "WATCHLIST" ? reason : undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-verified-persons"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-stats"] });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Échec de la mise à jour"),
  });

  if (!person) return null;

  return (
    <Dialog
      open={person !== null}
      onOpenChange={(open) => {
        if (open) {
          setStatus(person.status);
          setReason(person.watchlistReason ?? "");
        }
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Détail du client</DialogTitle>
          <DialogDescription>{displayFieldsSummary(person.displayFields)}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Document</dt>
          <dd>{person.documentType}</dd>
          <dt className="text-muted-foreground">Pays émetteur</dt>
          <dd>{person.issuingCountry}</dd>
          <dt className="text-muted-foreground">Vérifications</dt>
          <dd>{person.verificationCount}</dd>
          <dt className="text-muted-foreground">Première vérification</dt>
          <dd>{new Date(person.firstVerifiedAt).toLocaleDateString("fr-FR")}</dd>
          <dt className="text-muted-foreground">Dernière vérification</dt>
          <dd>{new Date(person.lastVerifiedAt).toLocaleDateString("fr-FR")}</dd>
        </dl>

        <form
          className="space-y-4 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="status-select">Statut</Label>
            <select
              id="status-select"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as VerifiedPersonStatus)}
            >
              {(Object.keys(STATUS_LABEL) as VerifiedPersonStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          {status === "WATCHLIST" && (
            <div className="space-y-1.5">
              <Label htmlFor="reason">Motif de la mise sous surveillance</Label>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="Expliquez pourquoi ce client doit être surveillé…" />
            </div>
          )}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || (status === "WATCHLIST" && !reason)}>
              {mutation.isPending ? "Enregistrement…" : "Enregistrer le statut"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientsPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<VerifiedPersonListItem | null>(null);
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-verified-persons", page, status],
    queryFn: () => tenantApi.listVerifiedPersons({ page, pageSize, status: status || undefined }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Clients</h1>
        <p className="text-sm text-muted-foreground">Vue consolidée de vos clients à travers leurs tentatives de vérification.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="status-filter">Statut</Label>
            <select
              id="status-filter"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !data || data.persons.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">Aucun client pour ces critères.</CardContent>
        </Card>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Vérifications</TableHead>
                <TableHead>Dernière vérification</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.persons.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="max-w-xs truncate text-sm">{displayFieldsSummary(person.displayFields)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {person.documentType} / {person.issuingCountry}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[person.status]}>{STATUS_LABEL[person.status]}</Badge>
                  </TableCell>
                  <TableCell>{person.verificationCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(person.lastVerifiedAt).toLocaleDateString("fr-FR")}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => setSelected(person)} title="Voir le détail">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {data.total} client{data.total > 1 ? "s" : ""} — page {page}/{totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Précédent
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Suivant
              </Button>
            </div>
          </div>
        </>
      )}

      <ClientDetailDialog key={selected?.id ?? "none"} person={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}

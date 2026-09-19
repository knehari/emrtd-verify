"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { adminApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label, Badge, Skeleton, Card, CardContent } from "@/components/ui/primitives";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const VERDICT_OPTIONS = [
  { value: "", label: "Tous les verdicts" },
  { value: "authentic", label: "Authentique" },
  { value: "suspicious", label: "Suspecte" },
  { value: "rejected", label: "Rejetée" },
  { value: "manual_review_required", label: "Revue manuelle" },
];

const VERDICT_BADGE: Record<string, "success" | "warning" | "destructive"> = {
  authentic: "success",
  suspicious: "warning",
  rejected: "destructive",
  manual_review_required: "warning",
};

export default function AdminVerificationsPage() {
  const [page, setPage] = useState(1);
  const [verdict, setVerdict] = useState("");
  const [clientId, setClientId] = useState("");
  const [issuingCountry, setIssuingCountry] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-verifications", page, verdict, clientId, issuingCountry],
    queryFn: () => adminApi.listVerifications({ page, pageSize, verdict: verdict || undefined, clientId: clientId || undefined, issuingCountry: issuingCountry || undefined }),
  });

  const { data: detail } = useQuery({
    queryKey: ["admin-verification-detail", detailId],
    queryFn: () => adminApi.getVerification(detailId!),
    enabled: detailId !== null,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vérifications</h1>
        <p className="text-sm text-muted-foreground">Revue globale, tous tenants confondus.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="verdict-filter">Verdict</Label>
            <select
              id="verdict-filter"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={verdict}
              onChange={(e) => {
                setVerdict(e.target.value);
                setPage(1);
              }}
            >
              {VERDICT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-filter">Tenant (clientId)</Label>
            <Input id="client-filter" placeholder="acme-bank" value={clientId} onChange={(e) => { setClientId(e.target.value); setPage(1); }} className="w-48" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country-filter">Pays émetteur</Label>
            <Input id="country-filter" placeholder="FRA" value={issuingCountry} onChange={(e) => { setIssuingCountry(e.target.value); setPage(1); }} className="w-32" />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !data || data.records.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">Aucune vérification pour ces critères.</CardContent>
        </Card>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identifiant</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Pays</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>Confiance</TableHead>
                <TableHead>Date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.records.map((record) => (
                <TableRow key={record.verificationId}>
                  <TableCell className="font-mono text-xs">{record.verificationId.slice(0, 8)}…</TableCell>
                  <TableCell>{record.clientId}</TableCell>
                  <TableCell>{record.documentType}</TableCell>
                  <TableCell>{record.issuingCountry}</TableCell>
                  <TableCell>
                    <Badge variant={VERDICT_BADGE[record.verdict] ?? "secondary"}>{record.verdict}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {record.trustChainSource} / {record.trustChainLevel}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(record.createdAt).toLocaleString("fr-FR")}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => setDetailId(record.verificationId)} title="Voir le détail">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {data.total} résultat{data.total > 1 ? "s" : ""} — page {page}/{totalPages}
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

      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Détail de la vérification</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 text-xs">{detail ? JSON.stringify(detail, null, 2) : "Chargement…"}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

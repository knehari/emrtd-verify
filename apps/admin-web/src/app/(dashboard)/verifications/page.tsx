"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { adminApi, ApiError, type VerificationReviewOutcome } from "@/lib/api-client";
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

const OUTCOME_LABEL: Record<VerificationReviewOutcome, string> = {
  CONFIRMED_AUTHENTIC: "Confirmée authentique",
  CONFIRMED_REJECTED: "Confirmée rejetée",
  ESCALATED: "Escaladée",
};

const OUTCOME_BADGE: Record<VerificationReviewOutcome, "success" | "destructive" | "warning"> = {
  CONFIRMED_AUTHENTIC: "success",
  CONFIRMED_REJECTED: "destructive",
  ESCALATED: "warning",
};

const reviewSchema = z.object({
  outcome: z.enum(["CONFIRMED_AUTHENTIC", "CONFIRMED_REJECTED", "ESCALATED"]),
  reason: z.string().min(1, "Motif requis").max(2000),
});
type ReviewForm = z.infer<typeof reviewSchema>;

/**
 * Trace formelle de la revue humaine — voir docs/pvid-compliance.md et
 * AdminVerificationsService.review. Affichée dans le détail d'une vérification :
 * en lecture seule si déjà revue, sinon comme formulaire pour les cas manual_review_required.
 */
function ReviewSection({ verificationId, verdict, review }: { verificationId: string; verdict: string; review: { outcome: VerificationReviewOutcome; reason: string; reviewedAt: string; reviewer: { id: string; email: string } } | null }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReviewForm>({ resolver: zodResolver(reviewSchema), defaultValues: { outcome: "CONFIRMED_AUTHENTIC", reason: "" } });

  if (review) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">Revue manuelle</span>
            <Badge variant={OUTCOME_BADGE[review.outcome]}>{OUTCOME_LABEL[review.outcome]}</Badge>
          </div>
          <p className="text-muted-foreground">{review.reason}</p>
          <p className="text-xs text-muted-foreground">
            Par {review.reviewer.email} — {new Date(review.reviewedAt).toLocaleString("fr-FR")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (verdict !== "manual_review_required") {
    return null;
  }

  async function onSubmit(data: ReviewForm) {
    setError(null);
    try {
      await adminApi.reviewVerification(verificationId, data);
      await queryClient.invalidateQueries({ queryKey: ["admin-verification-detail", verificationId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-verifications"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'enregistrement de la revue");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <p className="text-sm font-medium">Revue manuelle requise — enregistrer la décision</p>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="review-outcome">Décision</Label>
            <select id="review-outcome" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" {...register("outcome")}>
              <option value="CONFIRMED_AUTHENTIC">{OUTCOME_LABEL.CONFIRMED_AUTHENTIC}</option>
              <option value="CONFIRMED_REJECTED">{OUTCOME_LABEL.CONFIRMED_REJECTED}</option>
              <option value="ESCALATED">{OUTCOME_LABEL.ESCALATED}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-reason">Motif</Label>
            <textarea
              id="review-reason"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
              placeholder="Explication de la décision (obligatoire, tracée pour audit)"
              {...register("reason")}
            />
            {errors.reason && <p className="text-xs text-destructive">{errors.reason.message}</p>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isSubmitting} size="sm">
            {isSubmitting ? "Enregistrement…" : "Enregistrer la revue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

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
                <TableHead>Revue</TableHead>
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
                  <TableCell>
                    {record.reviewed ? (
                      <Badge variant="success">Revue</Badge>
                    ) : record.verdict === "manual_review_required" ? (
                      <Badge variant="warning">À revoir</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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
          {detail && detailId ? (
            <div className="space-y-4">
              <ReviewSection verificationId={detailId} verdict={String(detail.verdict)} review={detail.review} />
              <pre className="max-h-[40vh] overflow-auto rounded-md bg-muted p-4 text-xs">{JSON.stringify(detail, null, 2)}</pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

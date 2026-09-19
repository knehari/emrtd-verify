"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Copy, Check } from "lucide-react";
import { adminApi, ApiError } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input, Label, Badge, Skeleton, Card, CardContent } from "@/components/ui/primitives";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

function CreateAdminDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (password: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"SUPER_ADMIN" | "SUPPORT">("SUPPORT");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => adminApi.createAdminUser({ email, role }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onOpenChange(false);
      setEmail("");
      setRole("SUPPORT");
      onCreated(result.temporaryPassword);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Échec de la création"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel administrateur</DialogTitle>
          <DialogDescription>Un mot de passe temporaire sera généré et affiché une seule fois.</DialogDescription>
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
            <Label htmlFor="admin-email">Email</Label>
            <Input id="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-role">Rôle</Label>
            <select
              id="admin-role"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as "SUPER_ADMIN" | "SUPPORT")}
            >
              <option value="SUPPORT">SUPPORT (lecture seule, revue)</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN (accès complet)</option>
            </select>
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !email}>
              {mutation.isPending ? "Création…" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordRevealDialog({ password, onClose }: { password: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={password !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mot de passe temporaire</DialogTitle>
          <DialogDescription>Transmettez-le à l&apos;administrateur par un canal sécurisé — il ne sera plus jamais affiché.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 font-mono text-xs">
          <span className="flex-1 break-all">{password}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (password) navigator.clipboard.writeText(password);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>J&apos;ai copié le mot de passe</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminsPage() {
  const { admin } = useAdminAuth();
  const queryClient = useQueryClient();
  const { data: admins, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: adminApi.listAdminUsers, enabled: admin?.role === "SUPER_ADMIN" });
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => adminApi.updateAdminUser(id, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  if (admin?.role !== "SUPER_ADMIN") {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Réservé aux administrateurs SUPER_ADMIN.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Administrateurs</h1>
          <p className="text-sm text-muted-foreground">Comptes internes SaaS ayant accès à cette interface.</p>
        </div>
        <Button className="shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nouvel administrateur
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Dernière connexion</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.email}</TableCell>
                <TableCell>
                  <Badge variant={a.role === "SUPER_ADMIN" ? "default" : "secondary"}>{a.role}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={a.active ? "success" : "destructive"}>{a.active ? "Actif" : "Désactivé"}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString("fr-FR") : "Jamais"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={a.id === admin.sub}
                    onClick={() => toggleActiveMutation.mutate({ id: a.id, active: !a.active })}
                  >
                    {a.active ? "Désactiver" : "Réactiver"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateAdminDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setRevealedPassword} />
      <PasswordRevealDialog password={revealedPassword} onClose={() => setRevealedPassword(null)} />
    </div>
  );
}

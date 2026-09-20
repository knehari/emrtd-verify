"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { useAdminAuth } from "@/lib/auth-context";
import { adminApi, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis"),
    newPassword: z.string().min(12, "Au moins 12 caractères"),
    confirmPassword: z.string().min(1, "Confirmation requise"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, { message: "Les mots de passe ne correspondent pas", path: ["confirmPassword"] });
type PasswordForm = z.infer<typeof passwordSchema>;

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Le code doit comporter 6 chiffres") });
type CodeForm = z.infer<typeof codeSchema>;

const disableSchema = z.object({ password: z.string().min(1, "Mot de passe requis") });
type DisableForm = z.infer<typeof disableSchema>;

function PasswordCard() {
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  async function onSubmit(data: PasswordForm) {
    setError(null);
    setSuccess(false);
    try {
      await adminApi.changePassword(data.currentPassword, data.newPassword);
      setSuccess(true);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec du changement de mot de passe");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">Mot de passe</CardTitle>
        <CardDescription>Changez votre mot de passe. Vous resterez connecté sur cet appareil.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-sm space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Mot de passe actuel</Label>
            <Input id="currentPassword" type="password" autoComplete="current-password" {...register("currentPassword")} />
            {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">Nouveau mot de passe</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" {...register("newPassword")} />
            {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirmer le nouveau mot de passe</Label>
            <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
            {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {success && <p role="status" className="rounded-md bg-emerald-100 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Mot de passe mis à jour.</p>}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Enregistrement…" : "Changer le mot de passe"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SetupTwoFactorDialog({ open, onOpenChange, onEnabled }: { open: boolean; onOpenChange: (open: boolean) => void; onEnabled: () => void }) {
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CodeForm>({ resolver: zodResolver(codeSchema) });

  // useEffect plutôt qu'un chargement dans Dialog.onOpenChange : ce callback Radix ne se
  // déclenche pas pour un changement programmatique de la prop `open` piloté par le parent
  // (setSetupOpen(true) dans TwoFactorCard) — seulement pour les interactions internes
  // (Échap, clic extérieur). Même bug que celui trouvé et corrigé dans
  // apps/tenant-portal/src/app/(dashboard)/clients/page.tsx (voir docs/tenant-portal.md
  // "Vérification").
  useEffect(() => {
    if (!open) {
      setSetupData(null);
      setError(null);
      reset();
      return;
    }
    let cancelled = false;
    setError(null);
    adminApi
      .setupTwoFactor()
      .then((result) => {
        if (!cancelled) setSetupData({ secret: result.secret, qrCodeDataUrl: result.qrCodeDataUrl });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Échec du démarrage de la configuration 2FA");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset est stable (react-hook-form), pas nécessaire dans les deps
  }, [open]);

  async function onSubmit(data: CodeForm) {
    setError(null);
    try {
      await adminApi.enableTwoFactor(data.code);
      reset();
      setSetupData(null);
      onEnabled();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Code invalide");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activer l&apos;authentification à deux facteurs</DialogTitle>
          <DialogDescription>Scannez ce QR code avec votre application d&apos;authentification (Google Authenticator, 1Password, etc.), puis entrez le code affiché.</DialogDescription>
        </DialogHeader>
        {setupData ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL générée côté serveur, pas un asset Next Image */}
              <img src={setupData.qrCodeDataUrl} alt="QR code d'activation 2FA" width={200} height={200} className="rounded-md border" />
            </div>
            <div className="space-y-1.5">
              <Label>Clé manuelle (si le QR code ne peut pas être scanné)</Label>
              <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">{setupData.secret}</code>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code">Code de vérification</Label>
              <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" {...register("code")} />
              {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
            </div>
            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Activation…" : "Activer"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableTwoFactorDialog({ open, onOpenChange, onDisabled }: { open: boolean; onOpenChange: (open: boolean) => void; onDisabled: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DisableForm>({ resolver: zodResolver(disableSchema) });

  async function onSubmit(data: DisableForm) {
    setError(null);
    try {
      await adminApi.disableTwoFactor(data.password);
      reset();
      onDisabled();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mot de passe incorrect");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setError(null); reset(); } onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Désactiver l&apos;authentification à deux facteurs</DialogTitle>
          <DialogDescription>Confirmez votre mot de passe pour désactiver le 2FA sur ce compte.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="disable-password">Mot de passe</Label>
            <Input id="disable-password" type="password" autoComplete="current-password" {...register("password")} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "Désactivation…" : "Désactiver le 2FA"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TwoFactorCard() {
  const { admin, refresh } = useAdminAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">Authentification à deux facteurs</CardTitle>
        <CardDescription>Ajoute une étape de vérification (code à usage unique) à la connexion.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          {admin?.totpEnabled ? (
            <Badge variant="success" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Activée
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <ShieldOff className="h-3 w-3" /> Désactivée
            </Badge>
          )}
        </div>
        {admin?.totpEnabled ? (
          <Button variant="outline" onClick={() => setDisableOpen(true)}>
            Désactiver le 2FA
          </Button>
        ) : (
          <Button onClick={() => setSetupOpen(true)}>Activer le 2FA</Button>
        )}
      </CardContent>
      <SetupTwoFactorDialog open={setupOpen} onOpenChange={setSetupOpen} onEnabled={() => refresh()} />
      <DisableTwoFactorDialog open={disableOpen} onOpenChange={setDisableOpen} onDisabled={() => refresh()} />
    </Card>
  );
}

export default function SettingsPage() {
  const { admin } = useAdminAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Sécurité de votre compte administrateur.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Profil</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="text-sm font-medium">{admin?.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Rôle</dt>
              <dd>
                <Badge variant="secondary">{admin?.role === "SUPER_ADMIN" ? "Super administrateur" : "Support"}</Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <PasswordCard />
      <TwoFactorCard />
    </div>
  );
}

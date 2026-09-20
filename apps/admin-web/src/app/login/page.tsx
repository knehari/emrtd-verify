"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { useAdminAuth, ApiError } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/primitives";

const loginSchema = z.object({
  email: z.string().email("Adresse email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});
type LoginForm = z.infer<typeof loginSchema>;

const twoFactorSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Le code doit comporter 6 chiffres"),
});
type TwoFactorForm = z.infer<typeof twoFactorSchema>;

export default function LoginPage() {
  const { admin, loading, login, verifyTwoFactor } = useAdminAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const credentialsForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const twoFactorForm = useForm<TwoFactorForm>({ resolver: zodResolver(twoFactorSchema) });

  useEffect(() => {
    if (!loading && admin) router.replace("/dashboard");
  }, [admin, loading, router]);

  async function onSubmitCredentials(data: LoginForm) {
    setError(null);
    try {
      const result = await login(data.email, data.password);
      if (result.requiresTwoFactor) {
        setChallengeToken(result.challengeToken);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue");
    }
  }

  async function onSubmitTwoFactor(data: TwoFactorForm) {
    setError(null);
    try {
      await verifyTwoFactor(challengeToken!, data.code);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <CardTitle className="text-lg font-semibold text-foreground">Administration emrtd-verify</CardTitle>
          <CardDescription>
            {challengeToken ? "Entrez le code de votre application d'authentification" : "Connectez-vous avec votre compte administrateur interne"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {challengeToken ? (
            <form key="two-factor" onSubmit={twoFactorForm.handleSubmit(onSubmitTwoFactor)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="code">Code de vérification</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  {...twoFactorForm.register("code")}
                />
                {twoFactorForm.formState.errors.code && <p className="text-xs text-destructive">{twoFactorForm.formState.errors.code.message}</p>}
              </div>
              {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={twoFactorForm.formState.isSubmitting}>
                {twoFactorForm.formState.isSubmitting ? "Vérification…" : "Vérifier"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setChallengeToken(null)}>
                Retour
              </Button>
            </form>
          ) : (
            <form key="credentials" onSubmit={credentialsForm.handleSubmit(onSubmitCredentials)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" {...credentialsForm.register("email")} />
                {credentialsForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{credentialsForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Mot de passe</Label>
                <Input id="password" type="password" autoComplete="current-password" {...credentialsForm.register("password")} />
                {credentialsForm.formState.errors.password && (
                  <p className="text-xs text-destructive">{credentialsForm.formState.errors.password.message}</p>
                )}
              </div>
              {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={credentialsForm.formState.isSubmitting}>
                {credentialsForm.formState.isSubmitting ? "Connexion…" : "Se connecter"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

# Intégration KYC (application tierce)

## Principe

Un client KYC appelle l'API de vérification (ou reçoit un webhook asynchrone) et récupère un `VerificationResult` structuré — jamais une simple image ou un blob de données brutes de puce. Le contrat est conçu pour qu'un système KYC puisse prendre une décision automatisée tout en gardant la possibilité d'un contrôle humain sur les cas ambigus.

## Authentification

**Implémenté** : authentification par clé API (`Authorization: Bearer <clé>`), voir `apps/api/src/modules/kyc/`. Chaque client KYC est provisionné hors API (`pnpm --filter @emrtd-verify/api create-kyc-client -- --client-id=... --trust-levels=... --fields=...` — jamais par auto-inscription, voir `scripts/create-kyc-client.ts`) avec :

- Un identifiant public (`clientId`) et une clé API à haute entropie générée une seule fois (seul son hachage SHA-256 est stocké, jamais la clé en clair).
- Une politique de risque (`acceptedTrustLevels`) : niveaux de confiance PKI acceptés (`high`/`medium`/`low` — voir [pki-trust-model.md](pki-trust-model.md)). Un document validé à un niveau non accepté produit `manual_review_required` plutôt qu'un faux `authentic`.
- Une liste de champs autorisés (`allowedFields`) : défense en profondeur pour la minimisation RGPD, en plus de `requestedFields` par requête (l'intersection des deux est appliquée).
- `GET /v1/verifications/{id}` vérifie que le client authentifié est bien celui qui a soumis cette vérification (toujours `404`, jamais `403`, pour ne pas révéler l'existence d'un enregistrement appartenant à un autre client).

**Non implémenté** : OAuth2 client credentials / mTLS pour les intégrations à plus fort niveau d'exigence — une clé API statique est une base raisonnable pour un premier client pilote, mais un IdP dédié (rotation de jetons, scopes fins) reste une évolution pour des intégrations à plus grande échelle (voir docs/roadmap.md Phase 5).

## Endpoints (voir [api/openapi.yaml](api/openapi.yaml) pour le détail)

- `POST /v1/verifications` — soumet une session de vérification (données de puce + capture live), retourne un `verificationId` (traitement asynchrone recommandé dès que la reconnaissance faciale est impliquée).
- `GET /v1/verifications/{verificationId}` — récupère le `VerificationResult`.
- `POST /v1/webhooks` (côté client) — l'API notifie le client à la complétion, signée (HMAC, `KYC_WEBHOOK_SIGNING_SECRET`) pour garantir l'authenticité de la notification.

## Forme du résultat restitué

```ts
interface VerificationResult {
  verificationId: string;
  verdict: "authentic" | "suspicious" | "rejected" | "manual_review_required";
  document: {
    type: "eID" | "ePassport" | "eResidenceCard";
    issuingCountry: string; // ISO 3166-1 alpha-3
    fields: Record<string, FieldCheck>; // un FieldCheck par champ demandé par le client
  };
  trustChain: {
    source: "icao-pkd" | "national-pkd" | "extended-trust-store";
    level: "high" | "medium" | "low";
    sufficientForClientPolicy: boolean;
  };
  faceMatch?: {
    similarityScore: number;
    matchDecision: "match" | "no_match" | "inconclusive";
    livenessPassed: boolean;
  };
  anomalies: AnomalyFinding[];
  verifiedAt: string; // ISO 8601
  signature: string; // signature du résultat par la plateforme, vérifiable par le client
}
```

Type complet dans `packages/shared-types/src/verificationResult.ts`.

## Minimisation côté contrat

À l'enregistrement d'un client KYC, on déclare la liste des champs réellement nécessaires (ex. seulement `dateOfBirth` pour un contrôle d'âge, sans exposer le numéro de document complet) — `VerificationResult.document.fields` ne contient que les champs déclarés, jamais tout le document par défaut (voir [gdpr-compliance.md](gdpr-compliance.md)).

## Cas `manual_review_required`

Le contrat encourage explicitement le client à prévoir un chemin de revue humaine : tout document d'un pays sans source de confiance PKI disponible, ou avec des anomalies `warning` non tranchables automatiquement, produit ce verdict plutôt qu'un faux `authentic`/`rejected` forcé.

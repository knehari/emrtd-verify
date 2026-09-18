# Intégration KYC (application tierce)

## Principe

Un client KYC appelle l'API de vérification (ou reçoit un webhook asynchrone) et récupère un `VerificationResult` structuré — jamais une simple image ou un blob de données brutes de puce. Le contrat est conçu pour qu'un système KYC puisse prendre une décision automatisée tout en gardant la possibilité d'un contrôle humain sur les cas ambigus.

## Authentification

- OAuth2 client credentials (ou mTLS pour les intégrations à plus fort niveau d'exigence) par client KYC.
- Chaque client a une politique de risque configurée côté `apps/api` : seuils de score facial acceptés, niveaux de confiance PKI acceptés (ex. un client peut choisir de n'accepter que `icao-pkd`/`national-pkd` et de traiter tout résultat `extended-trust-store` comme `manual_review_required`).

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

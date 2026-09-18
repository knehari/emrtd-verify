# Checklist de vérification

Vue d'ensemble de tout ce que `VerificationModule` évalue pour produire un `VerificationResult`. Chaque item est un `FieldCheck` ou un `AnomalyFinding` individuel (voir `packages/shared-types`), pas un simple booléen global — un consommateur KYC doit pouvoir savoir *quoi* a échoué, pas seulement *que* quelque chose a échoué.

## 1. Intégrité cryptographique (Passive Authentication — Doc 9303 Part 11 §4)

- [ ] Hash de chaque DG lu == hash déclaré dans le SOD (algorithme annoncé dans le `LDSSecurityObject`)
- [ ] Signature du SOD valide avec la clé publique du DSC
- [ ] DSC signé par un CSCA de la chaîne de confiance (voir [pki-trust-model.md](pki-trust-model.md))
- [ ] CSCA non révoqué (CRL/Master List de déviation, quand disponible)
- [ ] Périodes de validité (CSCA, DSC, document) toutes valides à la date de vérification

## 2. Authenticité de la puce (anti-clonage)

- [ ] **Active Authentication (AA)** présente et valide si supportée par le document (challenge/réponse avec la clé privée de la puce, Doc 9303 Part 11 §6) — son absence n'est pas rédhibitoire mais est un signal d'anomalie
- [ ] **Chip Authentication (CA)**, quand EAC/PACE avec CA est supporté (Doc 9303 Part 11 §5) — remplace/renforce AA, établit aussi un canal sécurisé post-authentification
- [ ] Cohérence entre le mécanisme d'accès effectivement utilisé (BAC vs PACE) et ce qui est annoncé par le document

## 3. Cohérence des champs

- [ ] Chiffres de contrôle MRZ (numéro de document, date de naissance, date d'expiration, chiffre de contrôle composite) — Doc 9303 Part 3 §4.9
- [ ] MRZ (DG1) cohérente avec la zone visuelle si fournie (VIZ, capture optique du document)
- [ ] Pays émetteur cohérent avec le code pays du CSCA utilisé pour la validation
- [ ] Nationalité vs pays émetteur (cohérence attendue selon le type de document)
- [ ] Sexe, date de naissance, dates de validité au format attendu et cohérentes entre elles (date de naissance < date d'émission < date d'expiration)
- [ ] Format et longueur du numéro de document conformes au type (TD1/TD2/TD3)

## 4. Validité temporelle

- [ ] Document non expiré à la date de vérification
- [ ] Document non utilisé avant sa date de début de validité, si présente

## 5. Détection d'anomalies (`AnomalyDetectionModule`)

Chaque anomalie détectée est ajoutée à `VerificationResult.anomalies[]` avec une sévérité (`info` / `warning` / `critical`) — le système ne bloque pas systématiquement, il **explique** :

- Hash DG ≠ SOD → `critical` (donnée potentiellement altérée après émission)
- Signature SOD invalide → `critical`
- CSCA hors chaîne de confiance connue → `critical` si aucune source de confiance ne le couvre, `warning` si couvert uniquement par le magasin étendu à confiance `low`
- CSCA révoqué → `critical`
- Absence d'AA/CA sur un document qui devrait le supporter (selon la version LDS annoncée) → `warning` (indice possible de clonage — le SOD peut être copié même sans clé privée de puce)
- Incohérence structurelle LDS (DG manquant annoncé présent dans le SOD, DG surnuméraire non signé) → `critical`
- Incohérence MRZ ↔ DG1 ↔ VIZ → `warning` ou `critical` selon le champ
- CSCA proche de son expiration (< 90 jours) → `info`

## 6. Reconnaissance faciale

- [ ] Extraction de la photo DG2
- [ ] Détection de vivacité sur la capture live (anti-spoofing — photo d'une photo, vidéo rejouée, masque)
- [ ] Score de similarité DG2 ↔ capture live, comparé au seuil configuré (voir [facial-recognition.md](facial-recognition.md))

## Verdict global

`VerificationResult.verdict` ∈ `{ authentic, suspicious, rejected, manual_review_required }` — dérivé de l'ensemble des `FieldCheck`, du niveau de confiance PKI, des anomalies et du score facial, **jamais d'un seul signal isolé**. La logique de synthèse (pondération) est isolée dans `apps/api/src/modules/verification/verdict.policy.ts` pour rester auditable et ajustable sans toucher aux vérifications elles-mêmes.

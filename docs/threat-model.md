# Modèle de menace

Approche par catégories (inspirée STRIDE), centrée sur ce qui est spécifique à un vérificateur eMRTD/KYC.

| # | Menace | Impact | Contre-mesure |
|---|---|---|---|
| 1 | Puce clonée (données copiées sur un support tiers, sans clé privée d'origine) | Document accepté à tort | Vérifier Active/Chip Authentication ; absence d'AA/CA levée comme anomalie `warning` minimum (voir [verification-checklist.md](verification-checklist.md)) |
| 2 | SOD ou DG modifiés après émission | Champs falsifiés acceptés | Passive Authentication : hash DG vs SOD, signature DSC/CSCA systématique |
| 3 | CSCA frauduleux inséré dans le magasin de confiance | Chaîne de confiance corrompue à la racine | Magasin étendu : provenance tracée, confiance jamais `high` par défaut, revue à deux personnes, réévaluation périodique (voir [pki-trust-model.md](pki-trust-model.md)) |
| 4 | CSCA/DSC révoqué mais non détecté (CRL absente/obsolète) | Document révoqué accepté | Synchronisation régulière PKD, horodatage de fraîcheur des CRL exposé dans le résultat, dégradation du niveau de confiance si la fraîcheur dépasse un seuil |
| 5 | Interception/MITM sur le canal NFC | Lecture de données par un tiers, ou données altérées en transit | BAC/PACE établissent un canal chiffré dès l'authentification réussie ; PACE préféré à BAC quand disponible (résiste au eavesdropping passif, contrairement à BAC) |
| 6 | Spoofing de la reconnaissance faciale (photo, vidéo, masque) | Usurpation d'identité validée | Détection de vivacité obligatoire avant tout score de similarité (voir [facial-recognition.md](facial-recognition.md)) |
| 7 | Rejeu d'un `VerificationResult` valide pour un autre parcours/utilisateur | Contournement du contrôle KYC en aval | Résultat signé et lié à un identifiant de session unique, horodaté, vérifiable par le consommateur (voir [kyc-integration.md](kyc-integration.md)) |
| 8 | Exfiltration de données d'identité/biométriques stockées | Violation de données à fort impact (article 9 RGPD) | Chiffrement au repos, minimisation stricte, pas de persistance d'image faciale par défaut, rétention courte configurée (voir [gdpr-compliance.md](gdpr-compliance.md)) |
| 9 | Faux document d'un pays hors PKD sans aucune vérification possible | Acceptation d'un document non vérifiable comme s'il l'était | Le pays sans aucune source de confiance disponible produit un verdict `manual_review_required`, jamais `authentic` |
| 10 | Compromission de la clé de signature interne du `VerificationResult` | Falsification de verdicts a posteriori | Clé de signature en HSM/KMS géré, rotation documentée, hors du périmètre applicatif |
| 11 | Abus de l'API KYC par un client tiers mal authentifié | Vérifications non autorisées, fuite de résultats | Authentification forte par client (mTLS ou OAuth2 client credentials), quotas, journal d'audit par client |
| 12 | Dérive/biais du modèle de reconnaissance faciale sur certains sous-groupes | Rejets ou acceptations erronés disproportionnés | Audit indépendant obligatoire avant production (voir [facial-recognition.md](facial-recognition.md)), seuils ajustables, `matchDecision: inconclusive` plutôt que force-choice |

## Hors périmètre applicatif (mais à couvrir organisationnellement)

- Sécurité physique du terminal de capture (mobile compromis, root/jailbreak)
- Vérification de l'authenticité *physique* du support (hologrammes, kinegrammes) — cette plateforme couvre l'authenticité *électronique* (puce), pas l'inspection visuelle du document physique
- Formation des opérateurs pour la revue manuelle (`manual_review_required`)

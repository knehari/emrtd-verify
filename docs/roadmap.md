# Roadmap

Ce dépôt contient l'architecture et le squelette (interfaces, types, stubs documentés). Voici les phases restantes pour atteindre une implémentation de production — chaque ligne correspond à une issue GitHub créée à l'initialisation du dépôt.

## Phase 1 — Fondations cryptographiques

- Implémenter le parsing complet BER/DER du SOD (`EF.SOD`) et l'extraction du `LDSSecurityObject` (CMS `SignedData`)
- Implémenter la vérification de signature DSC/CSCA (RSA-PSS et ECDSA selon Doc 9303 Part 11 Annexe)
- Implémenter la synchronisation avec l'ICAO PKD (LDAP) : CSCA Master Lists, DSC, CRL
- Implémenter Active Authentication et Chip Authentication (Doc 9303 Part 11 §5/§6)

## Phase 2 — Magasin de confiance étendu

- Définir et documenter le processus opérationnel de revue à deux personnes pour l'ajout d'un CSCA hors PKD
- Constituer un premier jeu de CSCA vérifiés pour un ensemble initial de pays hors ICAO PKD
- Implémenter la dégradation automatique de confiance à l'échéance de `reviewBeforeDate`

## Phase 3 — Reconnaissance faciale

- Évaluer et sélectionner un modèle de matching facial (précision, biais démographique, licence)
- Implémenter la détection de vivacité (liveness) passive puis active
- Auditer les taux de faux positifs/négatifs par sous-groupe avant tout usage en production

## Phase 4 — Mobile

- Implémenter la lecture NFC BAC complète (dérivation de clé depuis MRZ, Doc 9303 Part 11 §4)
- Implémenter PACE (Doc 9303 Part 11 §9) comme mécanisme préféré quand supporté
- UX de capture de la photo vivante avec guide de cadrage

## Phase 5 — KYC & conformité

- Finaliser le contrat API/webhook avec un premier client KYC pilote
- Réaliser l'AIPD/DPIA complète (voir [gdpr-compliance.md](gdpr-compliance.md))
- Mettre en place la signature cryptographique des `VerificationResult` (HSM/KMS)

## Phase 6 — Durcissement production

- Audit de sécurité externe (chaîne de confiance PKI + pipeline biométrique)
- Tests de charge et politique de rétention/purge automatisée
- Observabilité (métriques de taux de rejet/anomalie par pays, alerting sur dérive)

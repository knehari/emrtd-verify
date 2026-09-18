# Politique de sécurité

## Nature sensible du projet

`emrtd-verify` traite des données d'identité et des données biométriques (catégories spéciales au sens de l'article 9 du RGPD). Toute vulnérabilité peut avoir un impact direct sur la sécurité de tiers (fraude documentaire non détectée, fuite de données d'identité).

## Signaler une vulnérabilité

**Ne créez pas d'issue publique pour une vulnérabilité de sécurité.** Envoyez un rapport détaillé (étapes de reproduction, impact, version concernée) à l'adresse de sécurité indiquée dans le profil du mainteneur du dépôt. Un accusé de réception est visé sous 72h.

## Périmètre particulièrement sensible

- Validation de la chaîne de confiance PKI (CSCA → Document Signer → SOD) : `packages/pki-trust`
- Authentification passive / active / chip (`packages/emrtd-core`)
- Pipeline de reconnaissance faciale et liveness (`services/face-match`)
- Tout code manipulant des clés privées, certificats ou données biométriques brutes

## Avant un déploiement en production

Ce dépôt fournit une architecture et des squelettes de code. Avant tout usage en production :

- Faire auditer l'implémentation de la Passive/Active/Chip Authentication par un tiers spécialisé PKI/ICAO Doc 9303.
- Faire auditer le pipeline de reconnaissance faciale (biais, taux de faux positifs/négatifs, résistance au spoofing).
- Réaliser une analyse d'impact relative à la protection des données (AIPD/DPIA) complète — voir [docs/gdpr-compliance.md](docs/gdpr-compliance.md) comme point de départ, pas comme document final.
- Valider le magasin de confiance étendu (pays hors ICAO PKD) avec une procédure de vérification manuelle documentée et tracée.

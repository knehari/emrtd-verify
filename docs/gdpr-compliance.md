# Conformité RGPD

Ce document est un point de départ pour l'analyse d'impact relative à la protection des données (AIPD/DPIA) — **pas un DPIA final**. Une AIPD complète (article 35 RGPD) est obligatoire avant tout traitement en production : ce traitement porte sur des données biométriques (article 9) à large échelle, ce qui déclenche systématiquement l'obligation d'AIPD.

## Base légale

- Vis-à-vis de la personne vérifiée : selon le contexte d'usage du client KYC (exécution d'un contrat, obligation légale — ex. LCB-FT/AML —, ou consentement explicite pour le traitement biométrique, article 9.2.a). **La base légale doit être déterminée et documentée par le déployeur** (le responsable de traitement), pas supposée par cette plateforme.
- Le traitement de données biométriques à des fins d'authentification unique (matching 1:1 DG2 ↔ capture live, pas d'identification 1:N dans une base) réduit le risque comparé à une identification biométrique de masse — à documenter explicitement dans l'AIPD comme facteur atténuant.

## Minimisation des données (article 5.1.c)

- `services/face-match` ne retourne jamais d'image ni d'embedding — seulement un score et des indicateurs (voir [facial-recognition.md](facial-recognition.md)).
- `apps/api` ne persiste par défaut que le `VerificationResult` (verdict, scores, anomalies) — pas les DG bruts, pas la photo, pas la MRZ complète au-delà de ce que le client KYC a explicitement besoin de recevoir.
- Le contrat API KYC (voir [kyc-integration.md](kyc-integration.md)) est conçu champ par champ : un client KYC ne reçoit que les attributs qu'il a déclaré nécessiter, jamais l'intégralité du document par défaut.

## Rétention

- Durée de rétention configurable (`DATA_RETENTION_DAYS`, défaut 30 jours) avec purge automatique programmée — implémentée (`RetentionSchedulerService`, job quotidien à 3h) : supprime `VerificationRecord` et les entrées `AuditLogEntry` correspondantes au-delà de la rétention configurée, testée (`apps/api/test/audit/`).
- Le journal d'audit (`AuditModule`) conserve la trace *qu'une vérification a eu lieu et son verdict*, sans les données biométriques brutes, pour une durée distincte et plus longue si justifiée par une obligation légale (ex. obligations AML) — à documenter séparément.
- **Nouvelle finalité de traitement — `VerifiedPerson` (portail tenant, voir [tenant-portal.md](tenant-portal.md))** : pour offrir à un tenant une vue consolidée de ses "clients" (statuts vérifié/non vérifié/en attente/à surveiller) au travers de plusieurs tentatives de vérification, la plateforme conserve désormais une fiche par personne qui **survit intentionnellement** à la purge de rétention des `VerificationRecord` individuels sous-jacents (relation `onDelete: SetNull`, jamais de suppression en cascade). Le rapprochement entre tentatives utilise une clé hachée (jamais le numéro de document en clair), mais les champs affichés au tenant (`displayFields`, déjà filtrés par `allowedFields`) restent identifiants.
- **Mécanisme technique d'anonymisation `VerifiedPerson`** : implémenté (`VerifiedPersonRetentionScheduler`, job quotidien à 3h dans le processus API — voir `apps/api/src/modules/verified-person/verified-person-retention.scheduler.ts` — délégant à `VerifiedPersonService.anonymizeExpired`, testé). Au-delà de `VERIFIED_PERSON_RETENTION_DAYS` jours d'inactivité (`lastVerifiedAt`), une fiche est **anonymisée** (`displayFields` vidé, `anonymizedAt` renseigné) et non supprimée, afin que `status`/`matchKey`/compteurs restent exploitables pour des statistiques agrégées. Un statut `WATCHLIST` n'est **jamais** anonymisé automatiquement (décision humaine sticky, cohérent avec `VerifiedPersonService.linkVerification` qui ne l'écrase jamais non plus). **Non traité en v1** : `VERIFIED_PERSON_RETENTION_DAYS` n'a **aucune valeur par défaut** — le mécanisme reste inactif tant qu'elle n'est pas renseignée — car le choix de la durée elle-même est une décision de politique qui doit être déterminée par une AIPD/DPIA complète avant un déploiement réel (voir [roadmap.md](roadmap.md), qui ne reste qu'un point de départ) ; le mécanisme technique n'implémente qu'un moyen de faire appliquer une durée, pas la durée elle-même.

## Droits des personnes

- **Droit d'accès / rectification** : la personne vérifiée s'adresse au responsable de traitement (le client KYC), qui peut interroger `apps/api` via l'identifiant de session de vérification.
- **Droit à l'effacement** : endpoint d'effacement anticipé prévu dans `AuditModule` (purge avant l'échéance de rétention par défaut), sous réserve des obligations légales de conservation applicables au client KYC.
- **Droit d'opposition au traitement biométrique** : à gérer en amont par le client KYC (recueil du consentement ou information préalable) — hors périmètre technique de cette plateforme, qui ne fait que fournir le résultat du traitement demandé.

## Sécurité (article 32)

- Chiffrement en transit (TLS) entre tous les composants, y compris en interne (`apps/api` ↔ `services/face-match`).
- Chiffrement au repos pour toute donnée persistée en base.
- Isolation réseau de `services/face-match` (jamais exposé directement).
- Journalisation d'audit append-only, sans donnée biométrique brute, avec contrôle d'accès strict.
- Voir [threat-model.md](threat-model.md) pour l'analyse de risque associée.

## Transferts hors UE

L'ICAO PKD est un annuaire international ; la consultation d'un CSCA public n'est pas un transfert de données personnelles. En revanche, si `services/face-match` ou l'hébergement de `apps/api` sont situés hors UE/EEE, un mécanisme de transfert (clauses contractuelles types, décision d'adéquation) doit être mis en place et documenté — **décision d'hébergement hors du périmètre de ce dépôt**, à trancher par le déployeur.

## Registre des traitements (ROPA — article 30)

Ce dépôt fournit la matière technique (quelles données, quels flux, quelle durée) pour alimenter le registre que le responsable de traitement doit tenir — voir la table des flux dans [architecture.md](architecture.md). Le registre lui-même (finalité métier, responsable, sous-traitants) reste à établir par le déployeur.

## Sous-traitance

Si `services/face-match` s'appuie sur un fournisseur tiers de reconnaissance faciale plutôt qu'un modèle auto-hébergé, ce fournisseur est un sous-traitant au sens de l'article 28 et nécessite un DPA (Data Processing Agreement) — à formaliser avant intégration.

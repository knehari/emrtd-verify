# Conformité eIDAS2 / ETSI / LoA / ENISA / PVID

Évaluation de la conformité de cette plateforme aux référentiels suivants, demandée
explicitement : règlement eIDAS 910/2014 modifié par eIDAS2 (art. 24), règlement
d'exécution (UE) 2025/1566, ETSI TS 119 461 V2.1.1, règlement d'exécution (UE)
2015/1502 (niveaux de garantie), lignes directrices ENISA "Remote ID Proofing",
référentiel PVID de l'ANSSI.

## Avertissement méthodologique — à lire avant toute décision

Cette évaluation a été produite dans un environnement dont la politique réseau
bloque l'accès direct à EUR-Lex, etsi.org, cyber.gouv.fr et à la quasi-totalité
des sites tiers (confirmé sur plusieurs domaines neutres). **Aucun texte source
primaire n'a donc pu être lu intégralement** : les exigences ci-dessous
proviennent de recherches web (résultats/extraits), recoupées sur plusieurs
sources indépendantes quand c'est possible, mais **non vérifiées mot à mot**.
Deux points précis restent contradictoires entre sources secondaires (date
d'application exacte de 2025/1566 : 19 août 2027 selon une page ELI EUR-Lex vs.
mai 2026 selon une source vendor ; contenu exact de la clause d'audit/journalisation
d'ETSI TS 119 461 v2, non confirmée). **Avant tout dossier de conformité formel
ou soumission à un organisme d'évaluation, faire relire ce document contre les
textes primaires** (CELEX 32024R1183, CELEX 32025R1566, PDF ETSI TS 119 461
V2.1.1, CELEX 32015R1502, PDF ANSSI PVID) par un accès réseau non restreint et,
pour les points juridiques, par un juriste spécialisé.

Ce document évalue **l'état technique du code**, pas la conformité organisationnelle
(gouvernance, contrats, assurance, personnel qualifié) — cette dernière n'est pas
vérifiable depuis un dépôt de code.

## Résumé exécutif

**Aucun des six référentiels n'est aujourd'hui satisfait**, pour une raison
structurelle commune : **la lecture réelle de la puce eMRTD par NFC (protocole
BAC/PACE, échange APDU) n'est pas implémentée** — c'est un stub qui lève une
erreur, aussi bien côté serveur (`apps/api/src/modules/verification/chip-data.decoder.ts`)
que côté mobile (`apps/mobile/src/nfc/emrtdReader.ts`). Sans cette étape, la
plateforme ne peut *actuellement exécuter aucune vérification d'identité de bout
en bout sur un document réel* — c'est le prérequis absolu de tous les référentiels
évalués (eIDAS2, ETSI, LoA, ENISA, PVID citent tous la lecture de puce comme
composante centrale d'une preuve d'identité forte).

Cela dit, l'**architecture est conçue avec l'ambition explicite d'un niveau élevé**
(Passive Authentication complète, Active/Chip Authentication, modèle de confiance
PKI à deux niveaux avec ancres épinglées hors bande, jamais de confiance `high`
par défaut, résultats signés, anomalies explicites plutôt que rejet silencieux) —
une fois la lecture NFC branchée, une bonne partie du travail de mise en conformité
technique restant est déjà fait ou proche. Le tableau ci-dessous détaille l'écart
par référentiel.

## Tableau de synthèse

| Référentiel | Champ d'application pour cette plateforme | Statut |
|---|---|---|
| eIDAS2 art. 24 | Indirect — vise les QTSP émettant certificats qualifiés/QEAA, pas une plateforme KYC privée, sauf si elle devient/sert un QTSP | Hors périmètre direct aujourd'hui |
| Règl. (UE) 2025/1566 | Indirect — même périmètre QTSP ; rend ETSI TS 119 461 v2.1.1 obligatoire pour ce périmètre | Hors périmètre direct aujourd'hui |
| ETSI TS 119 461 V2.1.1 | Devient la référence technique de facto en Europe pour la vérification d'identité à distance (via 2025/1566, et probablement via l'AMLR 2027) | **Non conforme** — écarts détaillés ci-dessous |
| Règl. (UE) 2015/1502 (LoA) | Cadre de référence pour situer le niveau d'assurance visé (substantial/high) | **Aucun niveau atteignable actuellement** (lecture NFC absente) ; architecture visant `substantial`→`high` une fois les écarts comblés |
| ENISA Remote ID Proofing | Bonnes pratiques non contraignantes, mais référence d'état de l'art largement citée par les régulateurs (dont l'ANSSI) | **Écarts sur les 2 pratiques les plus citées** (lecture NFC, interrogation de registres de statut de documents) |
| PVID (ANSSI) | Non obligatoire au sens strict (Code monétaire et financier R.561-5-1/5-2 offre d'autres voies), mais quasi incontournable commercialement pour vendre à des banques françaises en entrée en relation 100% à distance | **Non qualifiable en l'état** — suivi dédié dans [pvid-compliance.md](pvid-compliance.md) |

## 1. eIDAS2 (règlement 910/2014 modifié par UE 2024/1183) — article 24

**Champ d'application réel** : l'article 24 régit les obligations des
**prestataires de services de confiance qualifiés (QTSP)** lorsqu'ils émettent
des certificats qualifiés ou des attestations électroniques qualifiées
d'attributs (QEAA) — pas l'émission du Portefeuille européen d'identité
numérique (EUDI Wallet) lui-même (art. 5a, hors périmètre), et pas la
vérification d'identité pour un service KYC privé en tant que telle.

Une plateforme comme celle-ci n'entre dans le champ direct de l'article 24 que
si elle (a) devient elle-même QTSP, (b) agit comme sous-traitant technique
("Identity Proofing Service Provider") pour un QTSP, ou (c) cherche à faire
reconnaître sa méthode comme "autre méthode garantissant un niveau de confiance
élevé" au sens du point (d)/§1c via un organisme d'évaluation de la conformité.
**Aucun de ces trois cas ne s'applique aujourd'hui.**

**Pertinence indirecte à surveiller** : le futur règlement anti-blanchiment
**AMLR (UE 2024/1624)**, applicable à partir du 10 juillet 2027, devrait (selon
plusieurs sources vendor concordantes, non un texte que j'ai vérifié en détail)
restreindre les méthodes de vérification d'identité acceptées par les banques à
l'eID notifié eIDAS/l'EUDI Wallet/les services de confiance qualifiés, la
vérification documentaire classique (type eMRTD + biométrie — donc cette
plateforme) ne restant admise qu'en repli ("fallback"), et seulement si alignée
sur ETSI TS 119 461. **C'est le mécanisme le plus probable qui rendrait cette
plateforme concernée à terme** — à vérifier séparément, hors périmètre de cette
évaluation.

**Verdict** : pas d'action de mise en conformité technique requise vis-à-vis de
l'article 24 lui-même aujourd'hui. Point de vigilance stratégique : l'AMLR 2027.

## 2. Règlement d'exécution (UE) 2025/1566

Pris sur la base juridique de l'article 24 §1c, il impose aux QTSP l'usage
d'**ETSI TS 119 461 V2.1.1** comme norme de référence pour la vérification
d'identité/d'attributs. **Même périmètre que l'article 24** : ne s'applique pas
directement à cette plateforme sauf statut/rôle de QTSP.

**Verdict** : hors périmètre direct. Traité comme prescripteur indirect
d'ETSI TS 119 461 (section 3), qui elle est directement actionnable.

## 3. ETSI TS 119 461 V2.1.1 — écarts techniques

C'est le référentiel le plus directement actionnable pour évaluer l'architecture
technique. Exigences déduites (sources secondaires uniquement, cf. avertissement) :

| Exigence ETSI TS 119 461 v2 | État dans le dépôt | Écart |
|---|---|---|
| Vérification de documents d'identité, y compris lecture NFC eMRTD, avec voies "Automated"/"Manual"/"Hybrid Validation" | Toute la crypto en aval (Passive Authentication, Active/Chip Authentication, chaîne CSCA) est implémentée et testée — mais **la lecture NFC elle-même n'existe pas** (`chip-data.decoder.ts`, `emrtdReader.ts` : stubs qui lèvent une erreur) | **Bloquant.** Aucune vérification de bout en bout possible sur un vrai document aujourd'hui |
| Détection de vivacité / résistance aux attaques de présentation (photo, vidéo, masque, deepfake) — référence implicite ISO/IEC 30107 | `check_liveness()` (`services/face-match/app/liveness.py`) est **passive**, fondée sur résolution/netteté/nombre de visages — documenté explicitement comme "pas une détection anti-spoofing au sens fort", ne détecte ni photo imprimée de qualité, ni rejeu vidéo, ni masque, ni deepfake (voir `docs/facial-recognition.md`) | **Majeur.** Liveness active (challenge de mouvement/clignement) non implémentée ; aucun test PAD documenté |
| Matching biométrique visage-document | Implémenté (YuNet + SFace, ONNX local, scoring par similarité cosinus, seuil configurable par client) | Fonctionnellement présent, mais seuil non calibré sur données représentatives et aucun audit indépendant des taux de faux positifs/négatifs par sous-groupe démographique (documenté comme limite connue dans `docs/facial-recognition.md`) |
| Niveaux "Baseline"/"Extended", ce dernier avec supervision humaine ("human-in-the-loop") pour les cas équivalents à la présence physique | **Corrigé depuis** : `VerificationReview` (schema.prisma) trace formellement "quel opérateur a validé/invalidé quel cas, quand, avec quel motif" pour tout verdict `manual_review_required` — voir [pvid-compliance.md](pvid-compliance.md) | Résolu pour le niveau "Extended" |
| Audit/journalisation des décisions | `AuditLogEntry` journalise verdict, source de confiance, codes d'anomalie par vérification — solide pour la traçabilité *automatisée*, mais absent pour les actions *humaines* (voir ligne au-dessus) | Partiel |
| Conformité vérifiée par un organisme d'évaluation de la conformité (CAB) | Aucun audit externe mené (item déjà identifié dans `docs/roadmap.md` : "Audit de sécurité externe... non réalisé") | Non fait, prérequis pour toute certification |

## 4. Règlement d'exécution (UE) 2015/1502 — niveaux de garantie

Rappel des critères déduits (sources secondaires) : **"substantial"** exige une
preuve d'identité vérifiée (document photo/biométrique) et une comparaison de
caractéristiques physiques avec une source faisant autorité, à distance ou en
présentiel ; **"high"** exige en plus que l'authenticité du document soit vérifiée
auprès d'une source faisant autorité (pas seulement sa validité apparente), et
qu'une procédure à distance démontre une équivalence à la présence physique
(confrontation faciale robuste, biométrie renforcée), confirmée par un organisme
d'évaluation.

**Où se situe l'architecture** :
- Le design vise clairement "high" : Passive Authentication complète (hash DG vs
  SOD, signature DSC, chaîne CSCA — c'est exactement la vérification
  d'authenticité "auprès d'une source faisant autorité" que "high" exige), Active/
  Chip Authentication (anti-clonage), magasin de confiance qui ne dégrade jamais
  silencieusement (`extended-trust-store` jamais `high` par défaut) — tout ceci
  est réellement implémenté et testé.
- Mais **aucun niveau n'est atteignable aujourd'hui**, faute de lecture NFC
  fonctionnelle : sans elle, aucune des garanties cryptographiques ci-dessus ne
  peut s'exécuter sur un document réel.
- Une fois la lecture NFC branchée, l'écart restant pour prétendre à "high" est
  la liveness active (la version passive actuelle ne démontre pas une
  "équivalence à la présence physique" au sens de 2015/1502) et l'absence
  d'audit indépendant du pipeline biométrique.

**Verdict** : niveau `substantial` atteignable à moyen terme une fois la lecture
NFC et la liveness active livrées ; `high` nécessite en plus l'audit indépendant
et probablement une confirmation par un organisme d'évaluation de la conformité.

## 5. ENISA — Remote ID Proofing (bonnes pratiques, non contraignantes)

Rapport le plus récent ("Remote ID Proofing Good Practices", nov. 2024) : les
**deux bonnes pratiques les plus citées** pour la défense contre la fraude
documentaire sont (1) l'interrogation de registres de statut de documents
d'identité (perdus/volés/invalidés) et (2) la lecture de la puce NFC eMRTD
quand elle existe.

| Bonne pratique ENISA | État |
|---|---|
| Lecture NFC eMRTD | **Absente** (voir section 3) |
| Interrogation de registres de statut de documents (perdu/volé) | **Absente** — aucune intégration avec un registre national/Interpol de documents perdus/volés dans le dépôt ; seule la révocation CSCA/DSC via CRL PKD est couverte (mécanisme différent : révocation de certificat, pas statut de perte/vol du document physique) |
| Contre-mesures aux attaques par instrument (photo, replay, masque, deepfake, morphing) | Partiellement — la chaîne cryptographique protège contre le clonage/l'altération de la puce, mais la liveness faciale reste passive uniquement (voir section 3) |
| Approche combinée "best of breed"/"mix-and-match" selon le risque | Le design par client KYC (seuils configurables, politique de risque par client) va dans ce sens, mais reste à compléter par la lecture NFC et la liveness active pour être une combinaison réellement multi-facteurs |

**Verdict** : écart sur les deux pratiques structurantes. La vérification de
statut de document perdu/volé est un **gap non identifié dans le roadmap actuel**
— à ajouter (voir section 7).

## 6. PVID — référentiel ANSSI (France)

**Suivi déplacé vers un document dédié** : [pvid-compliance.md](pvid-compliance.md),
mis à jour après le [security-audit-2026-09.md](security-audit-2026-09.md) —
PVID est désormais tracé séparément (eIDAS2/ETSI/LoA/ENISA restant dans ce
document-ci). Résumé : non qualifiable en l'état, mêmes trois blocages
techniques (lecture NFC, liveness active, traçabilité de la validation
humaine), mais le volet "fiabilité du SI support" a été substantiellement
renforcé par les corrections de sécurité (voir le document dédié pour le
détail).

## 7. Écarts transverses — priorisés

1. **Lecture NFC réelle de la puce (BAC/PACE, APDU)** — bloquant pour les six
   référentiels. Déjà identifié dans `docs/roadmap.md` Phase 4, volontairement
   non tenté à l'aveugle (nécessite un vrai document + lecteur NFC pour être
   développé sans risque de faille de messagerie chiffrée silencieuse).
2. **Détection de vivacité active** (challenge de mouvement/clignement, ou
   solution biométrique certifiée équivalente) — déjà identifié dans
   `docs/roadmap.md`. Condition pour ETSI 119 461, LoA "high", PVID.
3. ~~Traçabilité de la revue humaine~~ — **résolu**, voir [pvid-compliance.md](pvid-compliance.md).
4. **Interrogation de registres de statut de documents perdus/volés** (nouveau,
   non présent dans le roadmap actuel) — bonne pratique ENISA la plus citée
   après la lecture NFC ; aucune source de données de ce type n'est
   actuellement intégrée (à distinguer de la révocation CSCA/DSC déjà couverte).
5. **Audit indépendant des taux de faux positifs/négatifs par sous-groupe
   démographique et calibration du seuil de décision facial** — déjà identifié
   dans `docs/roadmap.md`. Condition pour LoA "high" et bonne pratique générale
   de non-discrimination.
6. **Gestion de la clé de signature en HSM/KMS** — déjà identifié dans
   `docs/roadmap.md` Phase 5 ; actuellement une variable d'environnement en
   clair, acceptable en développement mais pas pour une certification.
7. **Audit de sécurité externe** (chaîne de confiance PKI + pipeline
   biométrique) — réalisé depuis (voir [security-audit-2026-09.md](security-audit-2026-09.md)),
   avec un correctif à sévérité `high` (Passive Authentication qui ne dépendait
   pas de la validité réelle de la signature SOD/du DSC). **Reste distinct**
   d'un audit de conformité formel par un organisme d'évaluation de la
   conformité (CAB) accrédité ETSI/PVID, qui est ce que ETSI/PVID exigent
   réellement pour une certification — cette revue-ci est un audit de sécurité
   technique, pas une évaluation de conformité normative.
8. **AIPD/DPIA complète** — déjà identifié dans `docs/gdpr-compliance.md`/
   `docs/roadmap.md` ; condition transversale pour tout déploiement réel en
   Europe, indépendamment des référentiels d'identité proprement dits.

Les items 1, 2, 5, 6, 7, 8 étaient déjà dans `docs/roadmap.md` avant cette
évaluation. Les items 3 et 4 sont de nouveaux constats issus de cette analyse de
conformité et doivent y être ajoutés.

## Ce que cette évaluation ne couvre pas

- **Le volet organisationnel/contractuel** de chaque référentiel (gouvernance,
  formation des opérateurs, contrats avec les clients KYC, assurance, politique
  d'impartialité PVID) — non vérifiable depuis un dépôt de code.
- **La confirmation formelle par un juriste ou un organisme d'évaluation
  accrédité** — cette évaluation reste une analyse technique de premier niveau,
  pas un avis juridique ni un pré-audit de certification.
- **Le règlement AMLR (UE 2024/1624)**, mentionné comme pertinent à terme mais
  explicitement hors périmètre de cette recherche — à évaluer séparément si la
  plateforme vise le marché bancaire français/européen après 2027.

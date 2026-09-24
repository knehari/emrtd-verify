# Référentiel de sécurité PVID (ANSSI) — état après corrections

Suivi dédié de la conformité au référentiel **PVID** (Prestataire Vérificateur
d'Identité à Distance, ANSSI), mis à jour après les corrections du
[security-audit-2026-09.md](security-audit-2026-09.md). **eIDAS2/ETSI TS 119
461/LoA 2015-1502/ENISA restent hors scope pour le moment** — leur analyse
complète reste disponible dans [eidas-compliance.md](eidas-compliance.md) si
besoin de la reprendre plus tard.

## Avertissement méthodologique

Comme pour `eidas-compliance.md` : le référentiel PVID lui-même
(cyber.gouv.fr) n'a pas pu être lu en source primaire dans cet environnement
(accès réseau bloqué) — les exigences ci-dessous proviennent de recherches web
recoupées, non vérifiées mot à mot. À faire relire contre le texte source
avant tout dossier de qualification formel.

## Cadre juridique (rappel)

Le PVID n'est pas une obligation légale nommément imposée par le Code
monétaire et financier (articles R. 561-5-1/R. 561-5-2, qui offrent d'autres
voies de conformité LCB-FT), mais un processus PVID qualifié est reconnu
comme équivalent à une vérification en face-à-face — de facto quasi
incontournable pour vendre ce service en marque blanche à des banques
françaises pour de l'entrée en relation 100% à distance.

## Tableau d'exigences — état après corrections de sécurité

| Exigence PVID | État avant l'audit (sept. 2026) | État après corrections |
|---|---|---|
| Vérification documentaire + biométrique avec tests d'efficacité poussés | Architecture crypto présente mais **`sufficientForClientPolicy` ne dépendait que du niveau de l'ancre de confiance** — un SOD forgé ou un DSC non signé par le CSCA de confiance pouvait passer sans anomalie | **Corrigé** : la validité de la signature SOD, la chaîne DSC↔CSCA et la période de validité du DSC sont désormais toutes requises (`packages/pki-trust/src/chainValidator.ts`), avec anomalies critiques explicites si l'une échoue. Lecture NFC toujours absente (bloquant, voir ci-dessous) ; pas de tests d'efficacité indépendants menés |
| Détection de vivacité (passive ou active) | Passive uniquement, acceptée par le verdict comme une liveness forte | **Protocole de liveness active implémenté et testé côté serveur** (challenge-réponse à séquence d'actions aléatoire, résistant au rejeu/à l'injection — voir [facial-recognition.md](facial-recognition.md)), mais son résultat ne peut prendre effet en production qu'une fois le module natif de capture ARKit construit (voir Blocages restants ci-dessous). En attendant, la liveness reste passive uniquement, et `livenessPassed: true` ne peut toujours pas, à lui seul, produire un verdict `authentic` automatique — anomalie `LIVENESS_PASSIVE_ONLY` systématique, dégrade vers `suspicious` |
| Vérification de révocation (CRL) | Jamais vérifiée, silencieusement absente du verdict | **Toujours pas de récupération de CRL en production** (nécessite un pipeline réseau non construit à l'aveugle, voir plus bas), mais l'absence est désormais **signalée explicitement** (`REVOCATION_NOT_CHECKED`, avertissement qui dégrade le verdict) au lieu d'être invisible |
| **Validation humaine obligatoire par un opérateur qualifié et formé, en fin de processus** | Non implémentée comme étape tracée | **Implémenté** : `VerificationReview` (schema.prisma) trace formellement "quel opérateur (`AdminUser`, SUPPORT ou SUPER_ADMIN) a validé/invalidé quel cas `manual_review_required`, quand, avec quel motif" — `POST /admin/verifications/:verificationId/review`, un seul enregistrement par cas, interface dédiée dans `apps/admin-web`. Vérifié en conditions réelles (HTTP + navigateur, voir [admin-web.md](admin-web.md) "Vérification"). **Ce qui reste hors périmètre technique** : la qualification/formation réelle des opérateurs (volet organisationnel) |
| Impartialité du prestataire, fiabilité du SI support | Non évaluable depuis le code (volet organisationnel) ; par ailleurs, des failles réelles existaient dans le SI (admin désactivé restant privilégié 12h, `services/face-match` sans authentification, pas de limite de taille d'image) | **Volet technique renforcé** : comptes admin/tenant désactivés/rétrogradés immédiatement privés de leurs droits (revalidation DB à chaque requête), `services/face-match` exige désormais une authentification par clé API, limites de taille/dimension/pixels sur les images reçues (déni de service), ports PostgreSQL/Redis du stack de développement non exposés au réseau. Le volet organisationnel (impartialité contractuelle) reste hors périmètre technique |
| Conformité RGPD | Couverte (voir `docs/gdpr-compliance.md`), AIPD/DPIA complète non réalisée | Inchangé |
| Interrogation d'un registre de statut de documents perdus/volés (bonne pratique ENISA associée) | Aucune intégration | **Interface pluggable implémentée et testée** (`DocumentStatusService`, voir [eidas-compliance.md](eidas-compliance.md) section 5) — reste **sans registre réel connecté** : accéder à un registre effectif (ex. INTERPOL SLTD) nécessite un enregistrement/accord spécifique, même limite que la lecture NFC ci-dessous |
| Audit par organisme évaluateur accrédité COFRAC, qualification valable 2 ans | Aucun audit mené | **Un audit de sécurité technique tiers a été réalisé et ses constats corrigés** (voir [security-audit-2026-09.md](security-audit-2026-09.md)) — mais **reste distinct** d'un audit de qualification PVID par un organisme accrédité COFRAC (ex. LSTI), qui est ce que le référentiel exige réellement pour la qualification |

## Blocages restants pour une qualification PVID

Par ordre de dépendance :

1. **Validation en conditions réelles de la lecture NFC BAC (contre un vrai document et un vrai
   lecteur NFC)** — bloquant absolu. Le protocole APDU (GET CHALLENGE, MUTUAL AUTHENTICATE,
   messagerie sécurisée, lecture SELECT/READ BINARY des DG/SOD) est implémenté
   (`packages/emrtd-core/src/nfc/{apdu,secureMessaging,bac,chipReader}.ts`, branché dans
   `apps/mobile/src/nfc/emrtdReader.ts`) et **validé byte-exact contre l'exemple travaillé
   officiel ICAO Doc 9303 Part 11 Appendix D.2/D.3/D.4** (pages scannées de la spécification
   fournies par l'utilisateur : `deriveBacSessionKeys` reproduit exactement Kseed/KEnc/KMac,
   `tripleDesCbcEncrypt` reproduit exactement E_IFD, `wrapCommandApdu`/`unwrapResponseApdu`
   reproduisent exactement chaque octet de la lecture protégée d'EF.COM documentée), en plus du
   round-trip/rejet sur falsification/interopérabilité entre implémentations indépendantes déjà
   en place. Ce qui manque encore n'est donc plus la conformité à la spécification, mais
   uniquement un **test contre un document et un lecteur NFC physiques réels** — aucun n'a été
   mené ici. PACE (ECDH-GM/CAM, 3DES/AES, courbes standardisées) est implémenté avec repli BAC, validé
   byte-exact contre l'exemple ICAO Doc 9303 Part 11 Appendix G.1 et deux traces réelles
   (`packages/emrtd-core/src/nfc/{pace,accessControl}.ts`). `bacKey.ts` est désormais entièrement
   portable React Native (SHA-1 via `crypto/sha1.ts`/`hash.js`, `crypto.getRandomValues` via
   `react-native-get-random-values` — plus aucune dépendance à Web Crypto). Sans cette validation
   matérielle réelle, aucune vérification de bout en bout sur un document réel n'est possible — tout le reste de cette
   évaluation est conditionnel à sa complétion (voir `docs/roadmap.md` Phase 4).
2. **Détection de vivacité active** — protocole de challenge-réponse à séquence
   d'actions aléatoire implémenté et testé côté serveur (`packages/emrtd-core/src/liveness/`,
   `apps/api` `LivenessChallengeService`/`VerificationProcessor`, voir
   [facial-recognition.md](facial-recognition.md) "Détection de vivacité active"), conçu pour
   une capture ARKit TrueDepth (seule techno grand public produisant une carte de profondeur 3D
   réelle, éliminant structurellement le rejeu photo/vidéo/deepfake pré-rendu). **Il manque
   encore, comme pour la lecture NFC au point 1, le module natif de capture lui-même** (impossible
   à écrire de manière vérifiable sans Xcode/appareil physique/compte Apple Developer payant — voir
   `apps/mobile/src/liveness/faceLivenessSession.ts` pour la spécification exacte de ce qui reste
   à construire) : sans lui, aucune capture réelle n'est possible, même si tout le reste du
   protocole (génération/vérification du challenge, anti-forge HMAC, résistance au rejeu/à
   l'injection) est déjà validé. Ne détecte pas un deepfake piloté en temps réel par un opérateur
   humain (scénario ENISA distinct, hors périmètre d'un simple challenge-réponse).
3. **Récupération et persistance des CRL ICAO PKD en production** — le
   décodage/la vérification cryptographique existent déjà et sont testés
   (`packages/pki-trust/src/crl.ts`), mais pas le pipeline de récupération
   réseau + persistance. Non construit à l'aveugle sans point d'accès PKD réel
   pour le vérifier (même raison que le point 1).
4. **Audit de qualification par un organisme évaluateur accrédité COFRAC**
   (ex. LSTI) — prérequis final, distinct de l'audit de sécurité technique
   déjà réalisé.

**Traçabilité de la validation humaine obligatoire — résolu.** `VerificationReview`
trace désormais formellement chaque décision d'un opérateur sur un cas
`manual_review_required` (voir tableau ci-dessus).

## Ce que ce document ne couvre pas

- Le volet organisationnel/contractuel du référentiel PVID (impartialité,
  formation des opérateurs, contrats) — non vérifiable depuis un dépôt de
  code.
- Une confirmation formelle par un juriste ou par l'organisme évaluateur
  accrédité — cette évaluation reste une analyse technique de premier niveau.
- eIDAS2/ETSI TS 119 461/LoA 2015-1502/ENISA — explicitement hors scope pour
  ce document, sur demande explicite ; voir [eidas-compliance.md](eidas-compliance.md)
  pour leur analyse complète si elle redevient pertinente.

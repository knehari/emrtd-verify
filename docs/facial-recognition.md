# Reconnaissance faciale

## Pipeline (`services/face-match`)

Implémentation réelle actuelle (voir `app/face_engine.py`, `app/matcher.py`,
`app/liveness.py`) — modèles ONNX exécutés localement via `cv2.dnn` (OpenCV),
**aucun appel réseau au moment de l'exécution**, aucune donnée envoyée à un tiers :

1. **Détection & alignement** : [YuNet](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md) (`models/yunet.onnx`) localise le(s) visage(s) dans (a) l'image extraite de DG2 (JPEG/JPEG2000 embarqué dans la puce), (b) la capture vivante, puis `cv2.FaceRecognizerSF.alignCrop` aligne le visage retenu à partir de ses repères (landmarks).
2. **Détection de vivacité (liveness)** : heuristiques passives sur une seule image — résolution minimale, netteté (variance du Laplacien), exactement un visage détecté avec une confiance suffisante. **Ce n'est pas une détection anti-spoofing au sens fort** : voir la section dédiée ci-dessous pour ce qui est et n'est pas couvert.
3. **Extraction d'embedding** : [SFace](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/README.md) (`models/sface.onnx`) produit un vecteur de 128 dimensions par visage détecté.
4. **Comparaison** : similarité cosinus entre les deux embeddings (`FaceMatcher._cosine_similarity`, calcul `numpy` pur, indépendant du modèle et testé directement), normalisée en score `[0, 1]` (`FaceMatcher._normalize_similarity`).
5. **Décision à seuil** : le seuil (`match_threshold`/`inconclusive_margin` de `FaceMatcher`) est **configurable par client KYC** (compromis faux positifs/faux négatifs selon le niveau de risque accepté), jamais codé en dur dans la logique de décision — mais sa **valeur par défaut n'est pas calibrée sur un jeu de données de production** (voir la section Choix de modèle).

Si aucun visage exploitable n'est détecté dans l'une des deux images (ou dans les
deux), `compare()` ne devine jamais un score : il retourne `similarity_score: 0.0`
et `match_decision: "inconclusive"`, accompagnés d'un avertissement explicite
dans `quality_warnings` (ex. `no_face_detected_in_reference_image`,
`multiple_faces_detected_in_probe_image`).

## Détection de vivacité — périmètre honnête

`check_liveness()` (`app/liveness.py`) est une implémentation **passive**, fondée
uniquement sur des heuristiques de qualité d'image :

- résolution minimale ;
- netteté de l'image (variance du Laplacien — une image trop floue est rejetée) ;
- exactement un visage détecté (zéro ou plusieurs visages sont rejetés).

**Ce que cela ne détecte pas** : une photo imprimée de bonne qualité tenue devant
la caméra, un écran rejoué (replay attack), un masque, une attaque par deepfake.
Un mode de liveness active (challenge de mouvement ou de clignement) reste
nécessaire pour les clients KYC à politique de risque plus stricte — voir
docs/threat-model.md #6. Ne jamais présenter ce module comme une protection
anti-spoofing forte dans la documentation client ou contractuelle.

Cette honnêteté est désormais appliquée jusque dans le verdict lui-même (suite à un audit de
sécurité tiers, voir [security-audit-2026-09.md](security-audit-2026-09.md)) : `VerificationProcessor`
remonte l'anomalie `LIVENESS_PASSIVE_ONLY` (avertissement) chaque fois que `livenessPassed: true`
provient de ce module, ce qui empêche un verdict `authentic` automatique sur ce seul signal —
**sauf si une liveness ACTIVE a réellement été exécutée et validée pour la même capture (voir
section suivante), auquel cas cet avertissement passif devient redondant** — voir
[verification-checklist.md](verification-checklist.md#6-reconnaissance-faciale).

## Détection de vivacité active

Protocole de challenge-réponse à séquence d'actions aléatoire, conçu pour être robuste contre les
attaques par présentation étudiées par l'ENISA (photo imprimée, écran rejoué, masque, deepfake
pré-rendu) — voir `packages/emrtd-core/src/liveness/`.

**Principe** : le serveur émet un challenge signé (HMAC-SHA256, `LivenessChallengeService`)
contenant une séquence ALÉATOIRE de 2-3 actions parmi { clignement, rotation de tête à gauche/à
droite, ouverture de bouche, sourire }, chacune assignée à une fenêtre temporelle précise et non
chevauchante (`generateLivenessChallenge`, `packages/emrtd-core/src/liveness/challenge.ts`). Le
mobile capture une série temporelle de coefficients de forme faciale (calqués sur les
`ARFaceAnchor.blendShapes` d'ARKit) et la soumet ; le serveur revérifie systématiquement
(`verifyLivenessResponse`, `packages/emrtd-core/src/liveness/verify.ts`) — **jamais de confiance
en un booléen envoyé par le client**, même discipline que la vérification du MAC avant déchiffrement
dans `nfc/bac.ts`. La vérification rejette : une action jamais détectée dans sa fenêtre, une action
détectée hors de sa fenêtre assignée, une montée de coefficient instantanée (plus rapide qu'un
clignement humain réel — signale une injection directe de valeur plutôt qu'un mouvement capturé),
un minutage mécaniquement identique entre plusieurs actions (signal probable de génération
synthétique), des horodatages non chronologiques, ou un challenge expiré.

**Choix technologique côté capture — ARKit TrueDepth** : `ARFaceTrackingConfiguration`
(iPhone X et ultérieurs) est la seule techno grand public qui produit une véritable carte de
profondeur 3D du visage, ce qui élimine STRUCTURELLEMENT le rejeu d'une photo, d'une vidéo ou d'un
deepfake pré-rendu affiché sur un écran plat (aucune carte de profondeur plausible n'en résulte) —
une approche purement 2D (simple détection de landmarks sur une caméra RGB classique) ne peut pas
offrir cette garantie et aurait été malhonnête à présenter comme "robuste contre le deepfake".

**Périmètre honnête — ce que ce protocole protège, et ce qu'il NE protège PAS** : la combinaison
"challenge imprévisible + preuve de profondeur 3D réelle" élimine le rejeu d'un contenu
pré-enregistré ou pré-rendu (photo, vidéo, deepfake généré à l'avance). Elle ne prétend **pas**
détecter un deepfake piloté en temps réel par un opérateur humain qui répondrait spontanément aux
instructions à l'écran (scénario "deepfake en direct via un flux vidéo détourné", explicitement
identifié par l'ENISA comme une menace distincte, plus coûteuse à monter mais réelle) — ce
scénario nécessiterait des mesures complémentaires hors périmètre de ce protocole (attestation
matérielle certifiée de bout en bout, détection d'anomalies du flux vidéo lui-même, revue humaine
systématique pour les profils à risque élevé).

**État d'implémentation** :
- Génération/vérification du challenge : implémentées et testées en TypeScript pur, sans aucune
  dépendance matérielle ou réseau (`packages/emrtd-core/test/liveness{Challenge,Verify,Session}.test.ts`,
  `frameIntegrity.test.ts`, `sha256.test.ts`) — même approche de test que le protocole BAC (voir
  `docs/roadmap.md` Phase 4).
- Émission/vérification côté serveur : `apps/api` (`LivenessChallengeService`,
  `POST /v1/verifications/liveness-challenge`, `VerificationProcessor`, anomalies
  `ACTIVE_LIVENESS_CHALLENGE_INVALID`/`ACTIVE_LIVENESS_FAILED`/`ACTIVE_LIVENESS_REPLAYED`) —
  implémentées et testées.
- Orchestration côté mobile (émission du challenge, capture, soumission) :
  `apps/mobile/src/screens/LivenessChallengeScreen.tsx`, branché dans `App.tsx`.
- **Capture native ARKit elle-même : délibérément NON implémentée.** Contrairement à l'adaptateur
  NFC (`isoDepHandler.transceive`, un passe-plat trivial autour de `react-native-nfc-manager`,
  bibliothèque déjà installée et testée), la capture ARKit nécessite d'écrire un module natif
  Swift complet (cycle de vie `ARSession`, délégué, threading, pont vers React Native) — impossible
  à compiler ou exécuter dans cet environnement (pas de Xcode, pas de simulateur TrueDepth, pas
  d'appareil physique confirmé, pas de compte Apple Developer payant). L'écrire à l'aveugle
  produirait une fausse impression d'achèvement sur un mécanisme anti-fraude qui mérite mieux
  qu'un code jamais vérifié. La spécification exacte de ce qu'il reste à construire (structure du
  module natif, noms exacts des coefficients ARKit à extraire, convention d'horodatage, chaînage
  des frames, canal lumineux) est documentée dans `apps/mobile/src/liveness/faceLivenessSession.ts`.
  En attendant, `createMockFaceLivenessSession` (`packages/emrtd-core`) permet de développer/tester
  tout le reste du parcours (écran, protocole réseau, vérification serveur) sans matériel réel.

## Sécurisation du flux caméra contre l'injection — priorité selon l'ENISA/OWASP MASVS

Un excellent algorithme d'analyse faciale ne sert à rien si l'attaquant peut injecter une vidéo
synthétique directement dans le flux traité par l'application (caméra virtuelle, appareil
rooté/jailbreaké, instrumentation dynamique type Frida, hook de l'API caméra, émulateur,
remplacement des frames après capture). Ce périmètre est traité en plusieurs contre-mesures
indépendantes, chacune avec un état d'implémentation honnête distinct :

- **Continuité de la séquence de frames** — `packages/emrtd-core/src/liveness/frameIntegrity.ts` :
  chaque frame capturée est chaînée cryptographiquement à la précédente (SHA-256, même principe
  que le compteur SSC de la messagerie sécurisée BAC, voir `nfc/secureMessaging.ts`), et la
  première frame est liée au nonce du challenge lui-même (`genesisHash`). Le serveur revérifie
  systématiquement cette chaîne (`verifyFrameChain`, intégrée dans `verifyLivenessResponse`) :
  toute frame substituée, réordonnée, dupliquée ou manquante après coup casse la chaîne dès ce
  point — un attaquant qui veut injecter une frame synthétique au milieu du flux doit recalculer
  tout le reste de la chaîne. **Implémenté et testé** (`test/frameIntegrity.test.ts`, 9 tests).
  Limite honnête : ce hash-chaînage est calculé côté client, sur des données qu'un attaquant qui
  compromet totalement l'application contrôle in fine — il ne prouve donc pas à lui seul qu'une
  frame provient physiquement du capteur ; combiné à la brièveté de la session
  (`LivenessChallenge.expiresAt`) et à l'attestation d'intégrité ci-dessous, il élève
  significativement le coût d'une injection sans l'éliminer structurellement.
- **Protection contre le rejeu du challenge** — `apps/api` `LivenessReplayGuardService` : chaque
  nonce de challenge ne peut être consommé qu'une seule fois, via une contrainte de clé primaire
  Postgres (table `consumed_liveness_challenges`, migration réelle appliquée et vérifiée contre
  une instance Postgres locale). Une tentative de rejeu (même challenge, même signature, soumis
  deux fois) produit l'anomalie critique `ACTIVE_LIVENESS_REPLAYED`. **Implémenté et testé**
  (mocks + smoke test direct contre Postgres démontrant la violation de contrainte P2002).
- **Durée de vie courte de la session** — chaque challenge expire peu après la fin de sa dernière
  fenêtre d'action (`SUBMISSION_GRACE_PERIOD_MS`, `challenge.ts`), et toute soumission après
  `expiresAt` est rejetée (`challenge_expired`). **Implémenté et testé.**
- **Attestation d'intégrité de l'application/l'appareil (App Attest iOS / Play Integrity
  Android)** — `apps/api` `DeviceAttestationService` : interface pluggable et testée qui reçoit un
  jeton d'attestation et un nonce attendu, mais **ne réalise PAS la vérification cryptographique
  réelle** (`verified` reste toujours `false`, anomalie `DEVICE_ATTESTATION_NOT_VERIFIED` de
  sévérité "info", jamais interprétée comme un signal de fraude tant que la vérification réelle
  n'existe pas). Une vérification réelle nécessiterait soit le certificat racine "Apple App
  Attestation Root CA" — jamais reconstruit de mémoire sans l'avoir confirmé byte-exact contre
  developer.apple.com, même discipline que `config/master-list-signer-trust-anchors.json` (vide
  par conception, voir `docs/pki-trust-model.md`) — soit un appel à l'API Google Play Integrity ou
  la récupération de son JWKS (accès réseau requis, même limite que la synchronisation CSCA/PKD,
  voir `docs/roadmap.md` Phase 6). La spécification exacte de ce qui reste à construire est
  documentée dans `device-attestation.service.ts`.
- **Détection root/jailbreak/hooking/émulation, acquisition caméra native uniquement (jamais
  depuis la galerie)** — non implémentées : ce sont des contrôles côté application mobile native
  (détection au niveau OS/binaire) hors du périmètre de ce qui peut être écrit et vérifié dans cet
  environnement sans appareil physique, même raison que la capture ARKit ci-dessus.

## Techniques explicitement hors périmètre de cette implémentation

Les techniques suivantes, mentionnées dans les bonnes pratiques 2026 de détection de deepfake pour
la vérification d'identité mobile, nécessitent des modèles de machine learning entraînés, des jeux
de données calibrés, ou une infrastructure live que ce projet n'a pas — les inclure sans un modèle
réel et une évaluation indépendante des biais serait aussi malhonnête que d'avoir prétendu, plus
tôt, qu'une simple analyse 2D "protège contre le deepfake" :

- **Reconstruction 3D/cohérence géométrique multi-frames, détection spatio-temporelle par modèle
  vidéo (dérive des traits faciaux, analyse fréquentielle temporelle)** — nécessite un modèle
  entraîné (ex. adaptation de CLIP, modèles fondamentaux faciaux CVPR 2025) et une évaluation
  indépendante de sa dégradation face à de nouveaux générateurs/appareils, absents ici. Le canal
  challenge lumineux (ci-dessus) et le hash-chaînage des frames couvrent une partie de ce que ces
  modèles ciblent (cohérence temporelle) par une approche protocolaire plutôt que par apprentissage.
- **Signaux physiologiques (rPPG — photopléthysmographie distante)** — nécessite un pipeline de
  traitement du signal calibré et une mesure explicite des biais démographiques/faux rejets avant
  toute utilisation en production (variations connues selon le générateur, la lumière, la couleur
  de peau, la qualité de caméra) ; non implémenté.
- **Cohérence audio-lèvres-environnement (synchronisation phonème-visème, détection de synthèse
  vocale)** — nécessite un pipeline audio complet (capture, transcription, analyse spectrale) non
  construit ici ; le protocole actuel n'implique aucune capture audio.
- **Suivi oculaire d'un point animé, rapprochement/éloignement du téléphone** — variantes
  d'actions supplémentaires pour le canal de liveness active, non ajoutées à `LIVENESS_ACTION_TYPES`
  faute de pouvoir les tester sur un appareil réel (suivi de trajectoire, mesure de distance) ; le
  jeu d'actions actuel (clignement, rotation de tête, ouverture de bouche, sourire) reste
  extensible sans changement d'architecture si elles sont ajoutées plus tard.

**Liaison avec le document eMRTD** (déjà implémentée, voir la section Pipeline ci-dessus) : le
parcours compare déjà la capture live à la photo DG2 signée extraite de la puce
(`FaceMatchClient.compare`), pas seulement à une photo prise du document — c'est l'avantage que
l'architecture eMRTD Verify a par construction sur un KYC ne lisant pas la puce.

**Évaluation formelle (ISO/IEC 30107-3, campagne d'attaques par injection dédiée)** : non menée —
nécessite un laboratoire de test biométrique indépendant, hors périmètre de ce dépôt de code (même
limite que l'audit de qualification PVID, voir `docs/pvid-compliance.md`).

## Reconnaissance faciale hors ligne

Voir [pki-trust-model.md](pki-trust-model.md) "Vérification hors ligne" pour l'architecture
d'ensemble (verdict local provisoire, réconciliation serveur obligatoire). Cette section couvre
uniquement la partie reconnaissance faciale de ce pipeline — `apps/mobile/src/faceMatch/`.

### Ce qui est implémenté et vérifié

Contrairement à la capture ARKit (liveness active) ou à la vérification cryptographique App
Attest/Play Integrity — délibérément non implémentées faute de matériel/compte pour les vérifier —
la partie **alignement + extraction d'embedding** du pipeline de reconnaissance faciale a pu être
vérifiée par exécution réelle, sans matériel physique, en reconstruisant son comportement exact à
partir des modèles ONNX eux-mêmes (déjà présents dans le dépôt, voir `services/face-match/models/`)
plutôt qu'en le devinant :

- **`align.ts`** — reproduit `cv2.FaceRecognizerSF.alignCrop` : ajustement d'une similarité
  (rotation + échelle + translation, méthode d'Umeyama) des 5 repères faciaux vers les points de
  référence canoniques ArcFace/SFace 112×112, puis ré-échantillonnage bilinéaire. Les points de
  référence ET la méthode de transformation ont été déterminés en comparant, sur des images
  synthétiques (dégradés, bruit aléatoire — jamais de photo réelle nécessaire, `alignCrop` accepte
  n'importe quelle image 112×112 en entrée), la sortie réelle d'`alignCrop` à notre propre
  ré-implémentation : correspondance pixel-exacte à l'arrondi près (test/faceMatch/align.test.ts).
- **`embedding.ts`** — reproduit le prétraitement exact de `cv2.FaceRecognizerSF.feature()` avant
  l'inférence `sface.onnx` : ordre de canaux RGB, valeurs brutes `[0,255]` (aucune normalisation),
  `NCHW`. Déterminé en testant systématiquement les combinaisons plausibles (ordre de canaux,
  normalisation) contre la sortie réelle de `cv2.dnn`, confirmé par inférence ONNX brute
  indépendante (`onnxruntime` Python) sur deux images synthétiques distinctes (cosinus > 0.9999,
  écart absolu max ~2×10⁻⁶ — bruit flottant, pas une divergence). Les tests JS
  (`test/faceMatch/embedding.test.ts`) exécutent le VRAI modèle `sface.onnx` via `onnxruntime-node`
  (Node pur, donc utilisable en CI sans React Native) et comparent à cette même référence Python.
- **`faceMatch.ts`** — combine les deux, avec la même règle de décision à seuil
  (`MATCH_THRESHOLD`/`INCONCLUSIVE_MARGIN`, valeurs identiques à `FaceMatcher` côté serveur — voir
  la note de calibration plus haut, ces valeurs par défaut ne sont pas calibrées) et une
  ré-implémentation vérifiée bit-exacte de l'heuristique de netteté (`check_liveness` côté serveur
  — formule de conversion en niveaux de gris de Pillow à virgule fixe et variance du Laplacien
  d'OpenCV, toutes deux confirmées diff=0.0 contre une exécution Python réelle).
- **`sfaceSession.ts`** — adaptateur de production, passe-plat trivial autour
  d'`onnxruntime-react-native` (même discipline que `nfc/emrtdReader.ts` pour
  `react-native-nfc-manager`) : `embedding.ts` reste le seul endroit où le comportement est défini.
- **Branchement dans le verdict** — `computeLocalVerification` (voir `pki-trust-model.md`) accepte
  un `faceMatch` optionnel et alimente `computeVerdict` exactement comme le chemin serveur (même
  package `@emrtd-verify/verification-policy`), testé de bout en bout avec le vrai modèle
  (`test/verification/localVerification.test.ts`).

### Ce qui reste hors périmètre — et pourquoi

Ce pipeline part de pixels déjà localisés (bbox + 5 repères) pour DEUX images. Produire ces
ingrédients à partir d'une capture brute nécessite deux étapes non implémentées ici, pour la même
raison que la capture ARKit (voir `apps/mobile/src/liveness/faceLivenessSession.ts`) : les
construire à l'aveugle, sans pouvoir vérifier leur comportement réel, produirait une fausse
impression d'achèvement sur un mécanisme dont dépend un verdict d'identité.

- **Détection de visage (YuNet)** — localiser un visage (bbox + 5 repères) dans une photo brute.
  Contrairement à `alignCrop`/`feature()`, la fonction de décodage des ancres et le NMS de YuNet
  n'ont pas pu être reconstruits par la même méthode (comparaison boîte noire à partir d'entrées
  synthétiques) faute d'accès aux sources d'OpenCV/opencv_zoo depuis cet environnement (dépôts hors
  du périmètre GitHub accessible à cette session) — reverse-engineer un décodeur d'ancres à l'aveugle,
  sans jamais pouvoir vérifier sa sortie contre l'implémentation réelle, comporterait le même risque
  qu'une implémentation BAC non vérifiée. Un détecteur natif (Vision framework iOS / ML Kit Android)
  serait l'alternative naturelle mais nécessite un module natif non écrit ici (même limite que la
  capture ARKit).
- **Décodage JPEG/JPEG2000 du portrait DG2** — `extractDg2FaceImage` (`@emrtd-verify/emrtd-core`)
  extrait uniquement les octets bruts du conteneur JPEG/JPEG2000 embarqué dans DG2 (voir la section
  Pipeline ci-dessus) ; les décoder en pixels RGB nécessite une bibliothèque de décodage image
  portable (React Native/Hermes) qui n'a pas été installée ni vérifiée dans cette session.
- **Comptage de visages dans l'heuristique de netteté** — voir la limite documentée dans
  `checkImageQuality` (`faceMatch.ts`) : "exactement un visage détecté" ne peut pas être
  re-vérifiée une fois qu'un seul `FaceRow` a déjà été fourni par l'appelant.

En résumé : le socle numérique (alignement, embedding, décision, intégration au verdict) est
implémenté et vérifié par exécution réelle contre les modèles OpenCV eux-mêmes ; ce qui manque pour
un pipeline de bout en bout utilisable en production (caméra brute → verdict) est la détection de
visage et le décodage image — deux modules qui, comme la capture ARKit, méritent d'être écrits et
testés sur du matériel réel plutôt qu'à l'aveugle dans cet environnement.

## Isolation et minimisation des données

- Le service ne persiste **aucune image** par défaut : traitement en mémoire, résultat = score + métadonnées de qualité (ex. `face_detected`, `liveness_passed`, `image_quality_warnings[]`), jamais l'image elle-même ni l'embedding brut en retour vers `apps/api`.
- Si une conservation temporaire est nécessaire (ex. contestation, litige), elle doit être explicitement configurée, chiffrée, à durée de vie courte et documentée dans le registre de traitement (voir [gdpr-compliance.md](gdpr-compliance.md)) — **désactivée par défaut**.
- Le service tourne dans un réseau interne, jamais exposé directement à internet — seul `apps/api` lui parle.

## Choix de modèle

`FaceMatcher.compare(reference_image, probe_image) -> MatchResult` (`app/matcher.py`)
utilise aujourd'hui deux modèles ONNX du dépôt [OpenCV Zoo](https://github.com/opencv/opencv_zoo)
(**licence Apache 2.0**), exécutés localement via `cv2.dnn` — voir
`services/face-match/models/README.md` pour la provenance exacte, les empreintes
SHA-256 et la procédure de mise à jour :

- **YuNet** (`models/yunet.onnx`, ~227 KiB) pour la détection de visage.
- **SFace** (`models/sface.onnx`, ~36.9 MiB) pour l'extraction d'embedding (128-d).

Ce choix a été retenu après évaluation dans cet environnement : un modèle
d'embedding profond plus établi (ArcFace ResNet100, dépôt `onnx/models`) a été
écarté car son poids (~250 Mo) ne correspond pas à l'objectif « quelques dizaines
de Mo, pas des Go » pour ce service ; MediaPipe (Google, Apache 2.0) a été
envisagé en repli mais sa distribution actuelle (Tasks API) ne fournit plus de
modèle de reconnaissance faciale embarqué directement dans le paquet pip et
nécessiterait un téléchargement de modèle à l'exécution — contraire à
l'isolation réseau attendue de ce service. YuNet + SFace sont fournis par
`opencv-python-headless` (déjà dans la stack) sans dépendance supplémentaire
lourde, sont de taille raisonnable, et sont accompagnés d'une évaluation
publique par leurs auteurs (SFace : 99.40 % sur un protocole de type LFW).

**Limites connues, à traiter avant tout déploiement en production :**

- Le chiffre de précision publié par les auteurs de SFace est un agrégat global ;
  il ne dit rien de la répartition des taux de faux positifs/négatifs par
  sous-groupe démographique (âge, genre, carnation, etc.).
- Le seuil de décision par défaut (`FaceMatcher.match_threshold = 0.75` sur le
  score normalisé `[0, 1]`) est une valeur de départ raisonnable, **pas une
  valeur calibrée** sur un jeu de données représentatif du déploiement réel.
- YuNet/SFace sont des modèles plus légers que les grands modèles d'embedding
  profond (ex. ArcFace ResNet100) : ils offrent un compromis précision/poids
  différent, à valider selon les exigences du client KYC.

**Ne pas déployer en production sans audit indépendant des taux de faux
positifs/négatifs par sous-groupe démographique, et sans calibration du seuil
de décision sur des données représentatives** — un biais non détecté ici a un
impact direct sur des personnes réelles dans un parcours KYC.

## Ce que l'API reçoit (jamais plus)

Forme exacte de `FaceMatchResult` (voir `packages/shared-types/src/verificationResult.ts`,
consommée par `apps/api`'s `FaceMatchClient` depuis la réponse JSON `snake_case`
de `POST /v1/compare`, voir `app/models.py`) :

```ts
interface FaceMatchResult {
  similarityScore: number; // [0, 1]
  matchDecision: "match" | "no_match" | "inconclusive";
  livenessPassed: boolean;
  qualityWarnings: string[];
}
```

Il n'y a pas de champs booléens séparés type `faceDetectedInDocument` /
`faceDetectedInLiveCapture` : l'absence (ou la multiplicité) de visage détecté
dans l'une des deux images est signalée sous forme de code texte dans
`qualityWarnings` (ex. `no_face_detected_in_reference_image`,
`multiple_faces_detected_in_probe_image`, `no_face_detected` pour le contrôle
de liveness), avec `matchDecision: "inconclusive"` dans ce cas — voir la section
Pipeline ci-dessus.

Pas de coordonnées de visage, pas d'embedding, pas d'image — cf. principe de minimisation RGPD (article 5.1.c).

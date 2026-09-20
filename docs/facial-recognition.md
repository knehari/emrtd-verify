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
provient de ce module, ce qui empêche un verdict `authentic` automatique sur ce seul signal — voir
[verification-checklist.md](verification-checklist.md#6-reconnaissance-faciale).

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

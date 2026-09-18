# Reconnaissance faciale

## Pipeline (`services/face-match`)

1. **Détection & alignement** : localiser le visage dans (a) l'image extraite de DG2 (JPEG/JPEG2000 embarqué dans la puce), (b) la capture vivante.
2. **Détection de vivacité (liveness)** : rejeter les tentatives de spoofing (photo d'une photo, écran rejoué, masque) avant toute comparaison. Passive liveness par défaut (analyse d'une image/courte séquence) ; active liveness (challenge de mouvement/clignement) activable selon la politique de risque du client KYC.
3. **Extraction d'embedding** : représentation vectorielle du visage pour chacune des deux images.
4. **Comparaison** : similarité (cosinus ou distance euclidienne selon le modèle) entre les deux embeddings, normalisée en score `[0, 1]`.
5. **Décision à seuil** : le seuil est **configurable par client KYC** (compromis faux positifs/faux négatifs selon le niveau de risque accepté), jamais codé en dur.

## Isolation et minimisation des données

- Le service ne persiste **aucune image** par défaut : traitement en mémoire, résultat = score + métadonnées de qualité (ex. `face_detected`, `liveness_passed`, `image_quality_warnings[]`), jamais l'image elle-même ni l'embedding brut en retour vers `apps/api`.
- Si une conservation temporaire est nécessaire (ex. contestation, litige), elle doit être explicitement configurée, chiffrée, à durée de vie courte et documentée dans le registre de traitement (voir [gdpr-compliance.md](gdpr-compliance.md)) — **désactivée par défaut**.
- Le service tourne dans un réseau interne, jamais exposé directement à internet — seul `apps/api` lui parle.

## Choix de modèle (à finaliser avant production)

Le stub (`app/matcher.py`) définit l'interface (`FaceMatcher.compare(reference_image, probe_image) -> MatchResult`) indépendamment de l'implémentation, pour permettre de brancher un modèle open source évalué (ex. ArcFace/InsightFace) ou un service tiers spécialisé, selon les contraintes de précision/biais/hébergement du déploiement. **Ne pas déployer en production sans audit indépendant des taux de faux positifs/négatifs par sous-groupe démographique** — un biais non détecté ici a un impact direct sur des personnes réelles dans un parcours KYC.

## Ce que l'API reçoit (jamais plus)

```ts
interface FaceMatchResult {
  faceDetectedInDocument: boolean;
  faceDetectedInLiveCapture: boolean;
  livenessPassed: boolean;
  similarityScore: number; // [0, 1]
  matchDecision: "match" | "no_match" | "inconclusive";
  qualityWarnings: string[];
}
```

Pas de coordonnées de visage, pas d'embedding, pas d'image — cf. principe de minimisation RGPD (article 5.1.c).

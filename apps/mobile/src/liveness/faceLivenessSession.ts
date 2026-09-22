import { FaceLivenessSessionUnavailableError, createMockFaceLivenessSession, type FaceLivenessSession } from "@emrtd-verify/emrtd-core";

/**
 * Frontière de capture réelle (ARKit TrueDepth) côté iOS — voir
 * packages/emrtd-core/src/liveness/session.ts `FaceLivenessSession` pour l'interface à respecter,
 * et docs/facial-recognition.md "Détection de vivacité active" pour le choix technologique
 * (ARFaceTrackingConfiguration/ARFaceAnchor.blendShapes, seule techno grand public produisant une
 * carte de profondeur 3D réelle, structurellement non reproductible par une photo/vidéo 2D).
 *
 * DÉLIBÉRÉMENT NON IMPLÉMENTÉ dans cet environnement — et ce n'est PAS la même situation que
 * `createIsoDepTransceiver` dans nfc/emrtdReader.ts (qui enveloppe `react-native-nfc-manager`, une
 * bibliothèque native déjà installée, testée, et dont l'API JS n'est qu'un passe-plat d'octets).
 * Ici, AUCUN module natif de capture ARKit n'existe dans ce dépôt (voir apps/mobile/package.json :
 * aucune dépendance caméra/ARKit) — il faudrait écrire un module natif Swift complet (gestion du
 * cycle de vie ARSession, délégué, threading, pont vers React Native) sans pouvoir le compiler ni
 * l'exécuter dans cet environnement (pas de Xcode, pas de simulateur TrueDepth, pas d'appareil
 * physique confirmé, pas de compte Apple Developer payant). Écrire ce code "à l'aveugle" produirait
 * une fausse impression d'achèvement pour un risque de sécurité (liveness anti-fraude) qui mérite
 * mieux qu'un code jamais vérifié — même discipline que le reste de ce projet (voir
 * docs/roadmap.md Phase 4 pour le précédent NFC/BAC : protocole testé en pur TypeScript d'abord,
 * adaptateur natif écrit seulement quand il pouvait rester trivial).
 *
 * Ce qu'il reste à construire pour compléter cette implémentation (spécification précise, pour
 * quiconque dispose du matériel réel — y compris moi-même dans une session future) :
 * 1. Un plugin de config Expo (ou du code natif éjecté) déclarant `NSCameraUsageDescription` et
 *    activant ARKit (`arkit` dans `ios.infoPlist`/capacités).
 * 2. Un module natif Swift démarrant une `ARSession` avec `ARFaceTrackingConfiguration` (vérifier
 *    `ARFaceTrackingConfiguration.isSupported` — iPhone X+ uniquement), implémentant
 *    `ARSessionDelegate.session(_:didUpdate:)`, et pour chaque `ARFaceAnchor` mis à jour, extraire :
 *    - `blendShapes[.eyeBlinkLeft]`, `.eyeBlinkRight`, `.jawOpen`, `.mouthSmileLeft`,
 *      `.mouthSmileRight` (valeurs `NSNumber` dans [0, 1], noms exacts de l'API ARKit — alignés
 *      délibérément avec `LivenessSignalFrame` dans packages/emrtd-core/src/liveness/types.ts) ;
 *    - le lacet de la tête en degrés à partir de `faceAnchor.transform` (ou `lookAtPoint`), avec la
 *      convention négatif=gauche/positif=droite déjà documentée sur `headYawDegrees`.
 * 3. Émettre chaque échantillon vers JS via un événement natif (`NativeEventEmitter` ou Turbo
 *    Module), horodaté en epoch ms (`Date().timeIntervalSince1970 * 1000`, PAS le temps ARKit
 *    relatif à la session) pour rester comparable aux fenêtres de `LivenessChallenge`.
 * 4. Chaîner chaque frame AVANT de l'envoyer à JS : `frameIndex` séquentiel depuis 0,
 *    `frameHash` calculé via `computeFrameHash`/`chainFrames` (packages/emrtd-core/src/liveness/
 *    frameIntegrity.ts) — jamais laissés à une valeur arbitraire côté natif, voir la doc de
 *    `FaceLivenessSession.onSample` (session.ts). Le module natif doit conserver le hash de la
 *    frame précédente en mémoire (état de session) pour calculer celui de la suivante.
 * 5. Si `challenge.lightSequence` est présent (voir `LivenessChallenge.lightSequence`, canal
 *    indépendant du challenge lumineux) : échantillonner la couleur perçue/reflétée (ex. zone
 *    peau/yeux du buffer caméra) en synchronisation avec les changements d'écran pilotés par
 *    `LightChallengeStep.atMs`, et l'émettre via `onLightSample` (`LightSignalSample`,
 *    `perceivedColor` en composantes [0, 1] mêmes conventions que `LightChallengeStep.color`).
 * 6. Adapter cette fonction pour retourner un objet conforme à `FaceLivenessSession` construit
 *    sur ce module natif, au lieu de lever `FaceLivenessSessionUnavailableError`.
 * 7. Validation en conditions réelles sur un iPhone X+ physique AVANT tout déploiement — aucune
 *    des étapes ci-dessus n'est vérifiable sans matériel réel.
 */
export function createFaceLivenessSession(): FaceLivenessSession {
  throw new FaceLivenessSessionUnavailableError(
    "Capture ARKit TrueDepth non implémentée dans ce build — aucun module natif de capture faciale n'existe encore (voir le commentaire de ce fichier pour la spécification exacte de ce qui reste à construire, et docs/facial-recognition.md). Utiliser createMockFaceLivenessSession() (@emrtd-verify/emrtd-core) pour le développement/les tests de l'écran sans matériel réel.",
  );
}

/**
 * Réexport explicite pour le développement/les tests d'intégration de l'écran (voir
 * LivenessChallengeScreen.tsx) — produit des échantillons SYNTHÉTIQUES, jamais une preuve réelle
 * de vivacité. Ne jamais utiliser en dehors d'un build de développement.
 */
export { createMockFaceLivenessSession, FaceLivenessSessionUnavailableError };
export type { FaceLivenessSession };

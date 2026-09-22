/**
 * Comparaison faciale on-device — combine `align.ts` (alignement) + `embedding.ts` (SFace) pour
 * produire un `FaceMatchResult` (@emrtd-verify/shared-types) structurellement identique à celui du
 * chemin serveur (`services/face-match` `FaceMatcher.compare`, voir `apps/api` `FaceMatchClient`)
 * — mêmes seuils de décision (`MATCH_THRESHOLD`/`INCONCLUSIVE_MARGIN`, voir `matcher.py`), même
 * formule de netteté (variance du Laplacien, voir `liveness.py`), vérifiées ci-dessous par
 * exécution réelle indépendante (voir test/faceMatch/faceMatch.test.ts).
 *
 * **Périmètre honnête — ce que ce module NE fait PAS** (même discipline que
 * `liveness/faceLivenessSession.ts` pour la capture ARKit) : il ne détecte AUCUN visage lui-même.
 * `referenceFace`/`probeFace` (bbox + 5 landmarks, voir `align.ts` `FaceRow`) doivent être fournis
 * par l'appelant — aucun détecteur on-device (YuNet ou natif) n'existe encore dans ce dépôt.
 * Construire un tel détecteur nécessiterait soit un portage JS de l'anchor-decoding/NMS de YuNet
 * (algorithme non trivial, jamais vérifié dans cette session faute d'accès à ses sources), soit un
 * détecteur natif (Vision/ML Kit) — hors périmètre ici, aucun module caméra n'existe même dans
 * apps/mobile à ce jour (voir `docs/facial-recognition.md` "Reconnaissance faciale hors ligne").
 * De même, `decodeChipDataEnvelope` fournit uniquement les octets JPEG/JPEG2000 bruts de DG2 (voir
 * `emrtd-core` `extractDg2FaceImage`) — les décoder en pixels RGB nécessite une bibliothèque de
 * décodage JPEG non installée/vérifiée ici. Ce module part donc de pixels DÉJÀ décodés.
 *
 * Limite additionnelle sur `livenessPassed` (heuristique passive, voir `checkImageQuality`
 * ci-dessous) : contrairement à `services/face-match` `check_liveness()`, ce module ne peut PAS
 * vérifier "exactement un visage détecté" (ce contrôle a déjà eu lieu, hors de ce module, au
 * moment où l'appelant a produit `probeFace`) — seules la résolution et la netteté sont vérifiées
 * ici ; un avertissement fixe `face_count_check_unavailable_offline` le signale explicitement,
 * jamais silencieusement.
 */

import { alignFace, type FaceRow } from "./align";
import { extractSfaceEmbedding, bgrToRgb, cosineSimilarity, type OnnxSessionLike, type TensorConstructorLike } from "./embedding";
import type { FaceMatchResult, MatchDecision } from "@emrtd-verify/shared-types";

// Mêmes valeurs par défaut que `FaceMatcher` (services/face-match/app/matcher.py) — voir sa
// docstring : point de départ raisonnable, PAS calibré sur un jeu de données de production.
const MATCH_THRESHOLD = 0.75;
const INCONCLUSIVE_MARGIN = 0.05;

// Mêmes valeurs que `liveness.py` — vérifiées ci-dessous (grayscale + Laplacian) contre une
// exécution réelle de `cv2.Laplacian(...).var()` (voir test/faceMatch/faceMatch.test.ts).
const MIN_WIDTH_PX = 80;
const MIN_HEIGHT_PX = 80;
const BLUR_VARIANCE_THRESHOLD = 15.0;

export interface RawImage {
  data: Uint8Array; // entrelacé, `channels` composantes par pixel
  width: number;
  height: number;
  channels: 3;
  channelOrder: "rgb" | "bgr";
}

export interface FaceMatchInput {
  referenceImage: RawImage;
  referenceFace: FaceRow;
  probeImage: RawImage;
  probeFace: FaceRow;
}

function toRgb(image: RawImage): Uint8Array {
  return image.channelOrder === "bgr" ? bgrToRgb(image.data) : image.data;
}

/**
 * Conversion en niveaux de gris identique à `PIL.Image.convert("L")` — formule à virgule fixe
 * exacte de Pillow (`L24 = (R*19595 + G*38470 + B*7471 + 0x8000) >> 16`), vérifiée bit-exacte
 * contre une vraie conversion PIL (voir test).
 */
function toGrayscale(image: RawImage): { gray: Int32Array; width: number; height: number } {
  const rgb = toRgb(image);
  const { width, height } = image;
  const gray = new Int32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 3) {
    gray[i] = (rgb[p] * 19595 + rgb[p + 1] * 38470 + rgb[p + 2] * 7471 + 0x8000) >> 16;
  }
  return { gray, width, height };
}

/**
 * Variance du Laplacien (netteté), noyau `[[0,1,0],[1,-4,1],[0,1,0]]` avec bordure `reflect101`
 * (BORDER_DEFAULT d'OpenCV) — vérifiée bit-exacte (diff=0.0) contre `cv2.Laplacian(gray,
 * CV_64F).var()` sur une image synthétique indépendante (voir test).
 */
function laplacianVariance(gray: Int32Array, width: number, height: number): number {
  const reflect101 = (i: number, n: number): number => {
    if (i < 0) return -i;
    if (i >= n) return 2 * n - 2 - i;
    return i;
  };
  const n = width * height;
  if (n === 0) return 0;
  const lap = new Float64Array(n);
  let sum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const top = gray[reflect101(y - 1, height) * width + x];
      const bottom = gray[reflect101(y + 1, height) * width + x];
      const left = gray[y * width + reflect101(x - 1, width)];
      const right = gray[y * width + reflect101(x + 1, width)];
      const center = gray[y * width + x];
      const value = top + bottom + left + right - 4 * center;
      lap[y * width + x] = value;
      sum += value;
    }
  }
  const mean = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const diff = lap[i] - mean;
    variance += diff * diff;
  }
  return variance / n;
}

export interface ImageQualityCheck {
  passed: boolean;
  warnings: string[];
}

/**
 * Équivalent partiel de `check_liveness()` (résolution + netteté uniquement — voir la limite
 * documentée dans l'en-tête du module concernant le comptage de visages).
 */
export function checkImageQuality(image: RawImage): ImageQualityCheck {
  const warnings: string[] = [];
  if (image.width < MIN_WIDTH_PX || image.height < MIN_HEIGHT_PX) {
    warnings.push("image_resolution_too_low");
  }
  const { gray, width, height } = toGrayscale(image);
  const variance = laplacianVariance(gray, width, height);
  if (variance < BLUR_VARIANCE_THRESHOLD) {
    warnings.push("image_too_blurry");
  }
  warnings.push("face_count_check_unavailable_offline");
  return { passed: warnings.length === 1 /* seul face_count_check_unavailable_offline présent */, warnings };
}

function decideMatch(similarityScore: number): MatchDecision {
  if (similarityScore >= MATCH_THRESHOLD + INCONCLUSIVE_MARGIN) return "match";
  if (similarityScore <= MATCH_THRESHOLD - INCONCLUSIVE_MARGIN) return "no_match";
  return "inconclusive";
}

/**
 * Compare deux visages déjà localisés (bbox+landmarks fournis par l'appelant, voir limites
 * ci-dessus) : aligne chacun vers 112×112 (`alignFace`), en extrait l'embedding SFace
 * (`extractSfaceEmbedding`), calcule la similarité cosinus normalisée dans [0,1] (même formule que
 * `FaceMatcher._normalize_similarity`) et applique la même règle de décision à seuil.
 */
export async function compareFaces(
  session: OnnxSessionLike,
  TensorCtor: TensorConstructorLike,
  input: FaceMatchInput,
): Promise<FaceMatchResult> {
  const referenceAlignedRgb = toRgb({
    ...input.referenceImage,
    data: alignFace(input.referenceImage.data, input.referenceImage.width, input.referenceImage.height, input.referenceImage.channels, input.referenceFace),
    width: 112,
    height: 112,
  });
  const probeAlignedRgb = toRgb({
    ...input.probeImage,
    data: alignFace(input.probeImage.data, input.probeImage.width, input.probeImage.height, input.probeImage.channels, input.probeFace),
    width: 112,
    height: 112,
  });

  const [referenceEmbedding, probeEmbedding] = await Promise.all([
    extractSfaceEmbedding(session, TensorCtor, referenceAlignedRgb),
    extractSfaceEmbedding(session, TensorCtor, probeAlignedRgb),
  ]);

  const rawCosine = cosineSimilarity(referenceEmbedding, probeEmbedding);
  const similarityScore = Math.min(1, Math.max(0, (rawCosine + 1) / 2));
  const matchDecision = decideMatch(similarityScore);

  const quality = checkImageQuality(input.probeImage);

  return {
    similarityScore,
    matchDecision,
    livenessPassed: quality.passed,
    qualityWarnings: quality.warnings,
  };
}

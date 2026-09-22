/**
 * Alignement facial portable (JS pur), reproduisant `cv2.FaceRecognizerSF.alignCrop` — vérifié par
 * exécution réelle et indépendante (voir test/faceMatch/align.test.ts, fixture générée via OpenCV/
 * onnxruntime réels, pas devinée) :
 *
 * 1. Transformation de similarité (rotation + échelle uniforme + translation, méthode d'Umeyama,
 *    moindres carrés sur 5 points) des 5 repères (`faceRow` : œil droit, œil gauche, pointe du
 *    nez, coin droit de la bouche, coin gauche de la bouche) vers les points de référence
 *    canoniques ArcFace/SFace 112×112 ci-dessous (publiés et documentés par OpenCV Zoo, confirmés
 *    ici par comparaison pixel-exacte avec la vraie sortie d'`alignCrop` — voir le test).
 * 2. Application de cette transformation par ré-échantillonnage bilinéaire (équivalent à
 *    `cv2.warpAffine(..., flags=INTER_LINEAR)`) sur une image de sortie 112×112.
 *
 * Format `faceRow` (15 valeurs) : `[x, y, w, h, xRe, yRe, xLe, yLe, xNt, yNt, xRm, yRm, xLm, yLm,
 * score]` — format de sortie standard de `cv2.FaceDetectorYN` (bbox + 5 landmarks + score),
 * documenté par l'API publique OpenCV. Ce module ne calcule PAS ces landmarks lui-même : aucun
 * détecteur de visage on-device (YuNet ou natif) n'existe encore dans ce dépôt — voir
 * docs/facial-recognition.md "Reconnaissance faciale hors ligne" pour ce qui reste à construire et
 * pourquoi (même limite honnête que la capture ARKit, voir liveness/faceLivenessSession.ts).
 */

export const ALIGNED_FACE_SIZE = 112;

/** Points de référence canoniques 112×112 (ArcFace/SFace) — vers lesquels les 5 landmarks sont alignés. */
const REFERENCE_LANDMARKS_112: ReadonlyArray<readonly [number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export interface FaceRow {
  boundingBox: { x: number; y: number; width: number; height: number };
  landmarks: {
    rightEye: readonly [number, number];
    leftEye: readonly [number, number];
    noseTip: readonly [number, number];
    rightMouthCorner: readonly [number, number];
    leftMouthCorner: readonly [number, number];
  };
  score: number;
}

/** Décode le format `faceRow` brut à 15 valeurs (voir docstring du module) en structure nommée. */
export function parseFaceRow(row: ArrayLike<number>): FaceRow {
  if (row.length !== 15) {
    throw new RangeError(`faceRow doit contenir 15 valeurs (bbox+5 landmarks+score), reçu ${row.length}`);
  }
  return {
    boundingBox: { x: row[0], y: row[1], width: row[2], height: row[3] },
    landmarks: {
      rightEye: [row[4], row[5]],
      leftEye: [row[6], row[7]],
      noseTip: [row[8], row[9]],
      rightMouthCorner: [row[10], row[11]],
      leftMouthCorner: [row[12], row[13]],
    },
    score: row[14],
  };
}

function landmarksAsPoints(face: FaceRow): Array<[number, number]> {
  const l = face.landmarks;
  return [l.rightEye, l.leftEye, l.noseTip, l.rightMouthCorner, l.leftMouthCorner].map(
    ([x, y]) => [x, y] as [number, number],
  );
}

/** Matrice affine 2×3 (comme `cv2.warpAffine` : mappe un point source vers sa position dans l'image de sortie). */
export type AffineMatrix = readonly [number, number, number, number, number, number]; // [a,b,tx, c,d,ty]

/**
 * Ajustement par moindres carrés d'une similarité (rotation+échelle+translation, méthode
 * d'Umeyama/Kabsch en 2D) faisant correspondre `src` à `dst` — vérifié pixel-exact contre
 * `cv2.FaceRecognizerSF.alignCrop` (voir test), pas une simple estimation approximative.
 */
export function fitSimilarityTransform(src: ReadonlyArray<[number, number]>, dst: ReadonlyArray<[number, number]>): AffineMatrix {
  const n = src.length;
  if (n !== dst.length || n === 0) {
    throw new RangeError("fitSimilarityTransform : src et dst doivent avoir la même longueur non nulle");
  }
  let srcMeanX = 0;
  let srcMeanY = 0;
  let dstMeanX = 0;
  let dstMeanY = 0;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i][0];
    srcMeanY += src[i][1];
    dstMeanX += dst[i][0];
    dstMeanY += dst[i][1];
  }
  srcMeanX /= n;
  srcMeanY /= n;
  dstMeanX /= n;
  dstMeanY /= n;

  // Matrice de covariance 2×2 : cov = (1/n) * sum( (dst_c) * (src_c)^T )
  let cov00 = 0;
  let cov01 = 0;
  let cov10 = 0;
  let cov11 = 0;
  let varSrc = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;
    cov00 += dx * sx;
    cov01 += dx * sy;
    cov10 += dy * sx;
    cov11 += dy * sy;
    varSrc += sx * sx + sy * sy;
  }
  cov00 /= n;
  cov01 /= n;
  cov10 /= n;
  cov11 /= n;
  varSrc /= n;

  // SVD 2×2 fermée sous forme close-form, puis correction du signe si det(cov) < 0 (méthode d'Umeyama).
  const det = cov00 * cov11 - cov01 * cov10;
  const { u, s, vt } = svd2x2(cov00, cov01, cov10, cov11);
  const sign = det < 0 ? -1 : 1;
  // R = U * diag(1,sign) * V^T
  const su0 = u[0][0];
  const su1 = u[0][1] * sign;
  const su2 = u[1][0];
  const su3 = u[1][1] * sign;
  const r00 = su0 * vt[0][0] + su1 * vt[1][0];
  const r01 = su0 * vt[0][1] + su1 * vt[1][1];
  const r10 = su2 * vt[0][0] + su3 * vt[1][0];
  const r11 = su2 * vt[0][1] + su3 * vt[1][1];

  const scale = (s[0] + sign * s[1]) / (varSrc || 1e-12);

  const a = scale * r00;
  const b = scale * r01;
  const c = scale * r10;
  const d = scale * r11;
  const tx = dstMeanX - (a * srcMeanX + b * srcMeanY);
  const ty = dstMeanY - (c * srcMeanX + d * srcMeanY);
  return [a, b, tx, c, d, ty];
}

/** SVD fermée d'une matrice 2×2 — suffisant ici (pas de dépendance à une librairie d'algèbre linéaire). */
function svd2x2(
  m00: number,
  m01: number,
  m10: number,
  m11: number,
): { u: [[number, number], [number, number]]; s: [number, number]; vt: [[number, number], [number, number]] } {
  // Valeurs/vecteurs propres de M^T M (symétrique 2×2) -> V et valeurs singulières.
  const a = m00 * m00 + m10 * m10;
  const b = m00 * m01 + m10 * m11;
  const d = m01 * m01 + m11 * m11;
  const trace = a + d;
  const diff = a - d;
  const disc = Math.sqrt(diff * diff + 4 * b * b);
  const lambda1 = (trace + disc) / 2;
  const lambda2 = (trace - disc) / 2;
  const s1 = Math.sqrt(Math.max(lambda1, 0));
  const s2 = Math.sqrt(Math.max(lambda2, 0));

  let v1: [number, number];
  if (Math.abs(b) > 1e-12) {
    v1 = [b, lambda1 - a];
  } else {
    v1 = diff >= 0 ? [1, 0] : [0, 1];
  }
  const v1norm = Math.hypot(v1[0], v1[1]) || 1;
  v1 = [v1[0] / v1norm, v1[1] / v1norm];
  const v2: [number, number] = [-v1[1], v1[0]]; // orthogonal

  // U = M * V * diag(1/s) (colonnes), en gérant s≈0.
  const mv1: [number, number] = [m00 * v1[0] + m01 * v1[1], m10 * v1[0] + m11 * v1[1]];
  const mv2: [number, number] = [m00 * v2[0] + m01 * v2[1], m10 * v2[0] + m11 * v2[1]];
  const u1: [number, number] = s1 > 1e-9 ? [mv1[0] / s1, mv1[1] / s1] : [1, 0];
  let u2: [number, number] = s2 > 1e-9 ? [mv2[0] / s2, mv2[1] / s2] : [-u1[1], u1[0]];
  // Assure l'orthonormalité stricte de u2 par rapport à u1 (robustesse numérique).
  const dot = u1[0] * u2[0] + u1[1] * u2[1];
  u2 = [u2[0] - dot * u1[0], u2[1] - dot * u1[1]];
  const u2norm = Math.hypot(u2[0], u2[1]) || 1;
  u2 = [u2[0] / u2norm, u2[1] / u2norm];

  return {
    u: [
      [u1[0], u2[0]],
      [u1[1], u2[1]],
    ],
    s: [s1, s2],
    vt: [
      [v1[0], v1[1]],
      [v2[0], v2[1]],
    ],
  };
}

/**
 * Ré-échantillonnage bilinéaire équivalent à `cv2.warpAffine(src, M, (112,112))` : pour chaque
 * pixel de sortie, on retrouve sa position dans l'image source via l'inverse de `matrix` (même
 * convention qu'OpenCV : `matrix` mappe source -> destination), puis interpolation bilinéaire à
 * 4 voisins (les pixels hors image source sont traités comme noirs, comme `BORDER_CONSTANT` par défaut).
 */
export function warpAffineBilinear(
  src: Uint8Array, // RGB ou BGR entrelacé, peu importe : ce module ne réordonne jamais les canaux lui-même
  srcWidth: number,
  srcHeight: number,
  channels: number,
  matrix: AffineMatrix,
  dstSize: number = ALIGNED_FACE_SIZE,
): Uint8Array {
  const [a, b, tx, c, d, ty] = matrix;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) {
    throw new RangeError("warpAffineBilinear : matrice de transformation non inversible");
  }
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const itx = -(ia * tx + ib * ty);
  const ity = -(ic * tx + id * ty);

  const dst = new Uint8Array(dstSize * dstSize * channels);
  for (let oy = 0; oy < dstSize; oy++) {
    for (let ox = 0; ox < dstSize; ox++) {
      // Coordonnées entières directement (pas de décalage +0.5 supplémentaire) — confirmé par la
      // correspondance pixel-exacte avec la fixture réelle `alignCrop` dans le test.
      const sx = ia * ox + ib * oy + itx;
      const sy = ic * ox + id * oy + ity;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;

      for (let ch = 0; ch < channels; ch++) {
        const p00 = samplePixel(src, srcWidth, srcHeight, channels, x0, y0, ch);
        const p10 = samplePixel(src, srcWidth, srcHeight, channels, x0 + 1, y0, ch);
        const p01 = samplePixel(src, srcWidth, srcHeight, channels, x0, y0 + 1, ch);
        const p11 = samplePixel(src, srcWidth, srcHeight, channels, x0 + 1, y0 + 1, ch);
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        const value = top + (bottom - top) * fy;
        dst[(oy * dstSize + ox) * channels + ch] = clampByte(value);
      }
    }
  }
  return dst;
}

function samplePixel(src: Uint8Array, width: number, height: number, channels: number, x: number, y: number, ch: number): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0; // BORDER_CONSTANT (noir), comme cv2.warpAffine par défaut
  return src[(y * width + x) * channels + ch];
}

function clampByte(value: number): number {
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 255) return 255;
  return rounded;
}

/**
 * Recadre et aligne un visage à partir de l'image source et de son `faceRow` (bbox+5 landmarks),
 * vers une image 112×112 dans le même ordre de canaux que l'entrée — voir `embedding.ts` pour la
 * suite du pipeline (conversion RGB + extraction d'embedding SFace).
 */
export function alignFace(
  image: Uint8Array,
  width: number,
  height: number,
  channels: number,
  face: FaceRow,
): Uint8Array {
  const srcPoints = landmarksAsPoints(face);
  const matrix = fitSimilarityTransform(srcPoints, REFERENCE_LANDMARKS_112 as Array<[number, number]>);
  return warpAffineBilinear(image, width, height, channels, matrix);
}

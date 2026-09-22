/**
 * Extraction d'embedding facial (SFace, `sface.onnx`) — prétraitement vérifié par exécution réelle
 * et indépendante (deux images synthétiques distinctes, comparées à la fois à `cv2.
 * FaceRecognizerSF.feature()` ET à une inférence ONNX brute via `onnxruntime` Python — voir
 * test/faceMatch/embedding.test.ts pour l'équivalent JS de cette même vérification, exécutée
 * contre le vrai modèle via `onnxruntime-node`) : l'image alignée 112×112 doit être fournie en
 * ordre de canaux **RGB**, valeurs brutes `[0,255]` en `float32` (AUCUNE soustraction de moyenne,
 * AUCUNE mise à l'échelle), réarrangée en `NCHW` `[1,3,112,112]`. La sortie du nœud `fc1` est
 * l'embedding final (128 dimensions) — AUCUNE normalisation L2 supplémentaire n'est appliquée par
 * OpenCV, donc aucune ici non plus (confirmé par comparaison directe des normes L2).
 *
 * Ce module est découplé du runtime ONNX concret via `OnnxSessionLike`/`TensorConstructorLike` :
 * `sfaceSession.ts` (React Native, `onnxruntime-react-native`) fournit l'implémentation de
 * production, tandis que les tests utilisent `onnxruntime-node` (exécutable en pur Node, donc
 * dans vitest) pour faire tourner le VRAI modèle `sface.onnx` et comparer à la référence Python —
 * les deux bibliothèques implémentent la même interface `onnxruntime-common` (`InferenceSession`/
 * `Tensor`), donc ce découplage n'introduit aucune divergence de comportement.
 */

export const SFACE_INPUT_NAME = "data";
export const SFACE_OUTPUT_NAME = "fc1";
export const EMBEDDING_DIMENSIONS = 128;
const ALIGNED_SIZE = 112;
const CHANNELS = 3;

export interface OnnxTensorLike {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
}

export interface OnnxSessionLike {
  run(feeds: Record<string, OnnxTensorLike>): Promise<Record<string, OnnxTensorLike>>;
}

export interface TensorConstructorLike {
  new (type: "float32", data: Float32Array, dims: readonly number[]): OnnxTensorLike;
}

/**
 * Construit le tenseur d'entrée `NCHW [1,3,112,112]` à partir d'une image alignée 112×112 en
 * ordre de canaux RGB (voir `align.ts` `alignFace` — dont la sortie garde l'ordre de canaux de
 * l'image source, à convertir en RGB par l'appelant si besoin, ex. `bgrToRgb` ci-dessous) —
 * prétraitement exact vérifié empiriquement (docstring du module).
 */
export function buildSfaceInputData(alignedFaceRgb: Uint8Array): Float32Array {
  const expectedLength = ALIGNED_SIZE * ALIGNED_SIZE * CHANNELS;
  if (alignedFaceRgb.length !== expectedLength) {
    throw new RangeError(`buildSfaceInputData : attendu ${expectedLength} octets (112×112×3 RGB), reçu ${alignedFaceRgb.length}`);
  }
  const data = new Float32Array(expectedLength);
  const planeSize = ALIGNED_SIZE * ALIGNED_SIZE;
  for (let y = 0; y < ALIGNED_SIZE; y++) {
    for (let x = 0; x < ALIGNED_SIZE; x++) {
      const pixelIndex = (y * ALIGNED_SIZE + x) * CHANNELS;
      const spatialIndex = y * ALIGNED_SIZE + x;
      data[0 * planeSize + spatialIndex] = alignedFaceRgb[pixelIndex]; // canal R
      data[1 * planeSize + spatialIndex] = alignedFaceRgb[pixelIndex + 1]; // canal G
      data[2 * planeSize + spatialIndex] = alignedFaceRgb[pixelIndex + 2]; // canal B
    }
  }
  return data;
}

/** Convertit une image entrelacée BGR (ordre natif d'`align.ts`, hérité de la source caméra/DG2) en RGB. */
export function bgrToRgb(bgr: Uint8Array): Uint8Array {
  const rgb = new Uint8Array(bgr.length);
  for (let i = 0; i < bgr.length; i += 3) {
    rgb[i] = bgr[i + 2];
    rgb[i + 1] = bgr[i + 1];
    rgb[i + 2] = bgr[i];
  }
  return rgb;
}

/** Exécute le modèle SFace sur une image déjà alignée (RGB 112×112) et retourne l'embedding brut (128-d). */
export async function extractSfaceEmbedding(
  session: OnnxSessionLike,
  TensorCtor: TensorConstructorLike,
  alignedFaceRgb: Uint8Array,
): Promise<Float32Array> {
  const inputData = buildSfaceInputData(alignedFaceRgb);
  const input = new TensorCtor("float32", inputData, [1, CHANNELS, ALIGNED_SIZE, ALIGNED_SIZE]);
  const outputs = await session.run({ [SFACE_INPUT_NAME]: input });
  const output = outputs[SFACE_OUTPUT_NAME];
  if (!output || output.data.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`extractSfaceEmbedding : sortie '${SFACE_OUTPUT_NAME}' absente ou de dimension inattendue`);
  }
  return Float32Array.from(output.data);
}

/** Similarité cosinus entre deux embeddings — même calcul que `FaceMatcher._cosine_similarity` côté serveur (services/face-match). */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new RangeError("cosineSimilarity : les deux embeddings doivent avoir la même dimension");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

import { describe, it, expect } from "vitest";
import { InferenceSession, Tensor } from "onnxruntime-node";
import path from "node:path";
import alignFixture from "./fixtures/alignCrop.fixture.json";
import expectedEmbedding from "./fixtures/sfaceEmbedding.fixture.json";
import { extractSfaceEmbedding, cosineSimilarity, bgrToRgb, type OnnxSessionLike, type TensorConstructorLike } from "../../src/faceMatch/embedding";

const SFACE_MODEL_PATH = path.resolve(__dirname, "../../../../services/face-match/models/sface.onnx");

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/**
 * Vérification de bout en bout, contre le VRAI modèle `sface.onnx` (via `onnxruntime-node`, pas un
 * mock) : le crop aligné attendu de la fixture (produit par un vrai `alignCrop` OpenCV, voir
 * fixtures/alignCrop.fixture.json) est converti BGR->RGB par notre code, passé dans notre
 * prétraitement (`buildSfaceInputData`), exécuté par le modèle réel, et comparé à l'embedding que
 * `cv2.FaceRecognizerSF.feature()` a réellement produit pour la même image (fixtures/
 * sfaceEmbedding.fixture.json) — aucune étape simulée entre l'image et l'embedding final.
 */
describe("extractSfaceEmbedding (parité end-to-end avec le vrai modèle sface.onnx)", () => {
  it("produit un embedding quasi identique (cosinus ≈ 1) à la référence cv2.FaceRecognizerSF.feature()", async () => {
    const session = (await InferenceSession.create(SFACE_MODEL_PATH, { logSeverityLevel: 3 })) as unknown as OnnxSessionLike;
    const TensorCtor = Tensor as unknown as TensorConstructorLike;

    const alignedBgr = base64ToBytes(alignFixture.expectedAlignedBgrBase64);
    const alignedRgb = bgrToRgb(alignedBgr);

    const embedding = await extractSfaceEmbedding(session, TensorCtor, alignedRgb);

    expect(embedding.length).toBe(128);

    const expected = Float32Array.from(expectedEmbedding as number[]);
    const cosine = cosineSimilarity(embedding, expected);
    let maxAbsDiff = 0;
    for (let i = 0; i < embedding.length; i++) {
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(embedding[i] - expected[i]));
    }

    // Tolérance large pour l'écart flottant entre runtimes ONNX (Node vs Python) — un cosinus
    // proche de 1 est la preuve que prétraitement ET lecture de sortie sont corrects, pas une
    // coïncidence numérique (voir la découverte initiale où un mauvais ordre de canaux donnait
    // cosinus ≈ 0.72, voir historique de session).
    expect(cosine).toBeGreaterThan(0.999);
    expect(maxAbsDiff).toBeLessThan(0.05);
  }, 30_000);
});

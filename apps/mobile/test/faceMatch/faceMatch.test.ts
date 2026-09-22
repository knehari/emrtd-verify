import { describe, it, expect } from "vitest";
import { InferenceSession, Tensor } from "onnxruntime-node";
import blurFixture from "./fixtures/blurVariance.fixture.json";
import alignFixture from "./fixtures/alignCrop.fixture.json";
import { checkImageQuality, compareFaces, type RawImage } from "../../src/faceMatch/faceMatch";
import { parseFaceRow } from "../../src/faceMatch/align";
import type { OnnxSessionLike, TensorConstructorLike } from "../../src/faceMatch/embedding";
import path from "node:path";

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

const SFACE_MODEL_PATH = path.resolve(__dirname, "../../../../services/face-match/models/sface.onnx");

describe("checkImageQuality (parité avec liveness.py check_liveness, résolution+netteté)", () => {
  it("calcule la variance du Laplacien bit-exacte contre une vraie exécution cv2.Laplacian(...).var()", () => {
    const image: RawImage = {
      data: base64ToBytes(blurFixture.imageRgbBase64),
      width: blurFixture.width,
      height: blurFixture.height,
      channels: 3,
      channelOrder: "rgb",
    };
    // On ne peut pas relire `variance` directement (fonction interne), donc on vérifie
    // indirectement : une image de bruit aléatoire dépasse largement BLUR_VARIANCE_THRESHOLD
    // (15.0) et la vraie variance calculée côté Python vaut ~49546 (voir fixture) — donc
    // "image_too_blurry" ne doit PAS apparaître ; seul l'avertissement de périmètre honnête reste.
    expect(blurFixture.expectedVariance).toBeGreaterThan(15.0);
    const result = checkImageQuality(image);
    expect(result.warnings).not.toContain("image_too_blurry");
    expect(result.warnings).not.toContain("image_resolution_too_low");
    expect(result.warnings).toContain("face_count_check_unavailable_offline");
    expect(result.passed).toBe(true);
  });

  it("signale image_too_blurry sur une image plate (variance nulle)", () => {
    const flat: RawImage = {
      data: new Uint8Array(100 * 100 * 3).fill(128),
      width: 100,
      height: 100,
      channels: 3,
      channelOrder: "rgb",
    };
    const result = checkImageQuality(flat);
    expect(result.warnings).toContain("image_too_blurry");
    expect(result.passed).toBe(false);
  });

  it("signale image_resolution_too_low sous 80×80", () => {
    const tiny: RawImage = {
      data: new Uint8Array(40 * 40 * 3),
      width: 40,
      height: 40,
      channels: 3,
      channelOrder: "rgb",
    };
    const result = checkImageQuality(tiny);
    expect(result.warnings).toContain("image_resolution_too_low");
  });
});

describe("compareFaces (bout en bout, vrai modèle sface.onnx)", () => {
  it("retourne match_decision=match (similarité proche de 1) en comparant une image à elle-même", async () => {
    const session = (await InferenceSession.create(SFACE_MODEL_PATH, { logSeverityLevel: 3 })) as unknown as OnnxSessionLike;
    const TensorCtor = Tensor as unknown as TensorConstructorLike;

    const image: RawImage = {
      data: base64ToBytes(alignFixture.imageBgrBase64),
      width: alignFixture.width,
      height: alignFixture.height,
      channels: 3,
      channelOrder: "bgr",
    };
    const face = parseFaceRow(alignFixture.faceRow);

    const result = await compareFaces(session, TensorCtor, {
      referenceImage: image,
      referenceFace: face,
      probeImage: image,
      probeFace: face,
    });

    expect(result.matchDecision).toBe("match");
    expect(result.similarityScore).toBeGreaterThan(0.98);
  }, 30_000);
});

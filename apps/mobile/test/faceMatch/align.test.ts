import { describe, it, expect } from "vitest";
import fixture from "./fixtures/alignCrop.fixture.json";
import { alignFace, parseFaceRow, ALIGNED_FACE_SIZE } from "../../src/faceMatch/align";

/**
 * Vérifie `alignFace` (transformation de similarité + ré-échantillonnage bilinéaire, JS pur)
 * contre une fixture générée par une vraie exécution de `cv2.FaceRecognizerSF.alignCrop` (voir
 * services/face-match, exploration documentée dans la session ayant produit ce module) — jamais
 * une supposition sur le comportement d'OpenCV.
 */
function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

describe("alignFace (parité OpenCV alignCrop)", () => {
  it("reproduit la sortie réelle de cv2.FaceRecognizerSF.alignCrop à quelques niveaux de gris près (interpolation)", () => {
    const image = base64ToBytes(fixture.imageBgrBase64);
    const expected = base64ToBytes(fixture.expectedAlignedBgrBase64);
    const face = parseFaceRow(fixture.faceRow);

    const aligned = alignFace(image, fixture.width, fixture.height, 3, face);

    expect(aligned.length).toBe(ALIGNED_FACE_SIZE * ALIGNED_FACE_SIZE * 3);
    expect(aligned.length).toBe(expected.length);

    let maxDiff = 0;
    let sumDiff = 0;
    for (let i = 0; i < aligned.length; i++) {
      const diff = Math.abs(aligned[i] - expected[i]);
      if (diff > maxDiff) maxDiff = diff;
      sumDiff += diff;
    }
    const meanDiff = sumDiff / aligned.length;

    // Tolérance : différences résiduelles d'arrondi entre notre bilinéaire et l'implémentation
    // interne d'OpenCV (constatées empiriquement à max=1 sur une image lisse lors de la
    // reverse-engineering initiale) — jamais une divergence structurelle de la transformation.
    expect(maxDiff).toBeLessThanOrEqual(4);
    expect(meanDiff).toBeLessThan(0.2);
  });
});

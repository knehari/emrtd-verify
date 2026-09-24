/**
 * Recadrage de visage renvoyé par le module natif `modules/face-kit` (Apple Vision), pour la photo
 * DG2 comme pour le selfie : pixels RGB entrelacés (base64), cadre du visage et 5 repères dans le
 * recadrage, dans l'ordre de `cv2.FaceDetectorYN` attendu par `align.ts` (œil côté gauche de
 * l'image, œil côté droit, nez, coin de bouche gauche, droit). Convertit en `RawImage` + `FaceRow`,
 * les entrées de `compareFaces` (faceMatch.ts).
 */
import { base64ToBytes } from "@emrtd-verify/emrtd-core";
import { parseFaceRow, type FaceRow } from "./align";
import type { RawImage } from "./faceMatch";

export interface NativeFaceCrop {
  rgb: string;
  width: number;
  height: number;
  /** 10 valeurs : x, y des 5 repères, en pixels du recadrage. */
  landmarks: number[];
  /** x, y, largeur, hauteur du visage, en pixels du recadrage. */
  box: number[];
  /** Visages détectés dans l'image source (le recadrage porte sur le plus grand). */
  faceCount: number;
}

export interface FaceSample {
  image: RawImage;
  face: FaceRow;
  faceCount: number;
}

export function faceSampleFromCrop(crop: NativeFaceCrop): FaceSample {
  const data = base64ToBytes(crop.rgb);
  if (data.length !== crop.width * crop.height * 3) {
    throw new RangeError(`Recadrage incohérent : ${data.length} octets pour ${crop.width}×${crop.height} RGB`);
  }
  if (crop.landmarks.length !== 10 || crop.box.length !== 4) {
    throw new RangeError("Recadrage incohérent : 5 repères et un cadre attendus");
  }
  return {
    image: { data, width: crop.width, height: crop.height, channels: 3, channelOrder: "rgb" },
    face: parseFaceRow([...crop.box, ...crop.landmarks, 1]),
    faceCount: crop.faceCount,
  };
}

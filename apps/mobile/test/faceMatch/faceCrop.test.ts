import { describe, expect, it } from "vitest";
import { faceSampleFromCrop } from "../../src/faceMatch/faceCrop";

describe("faceSampleFromCrop", () => {
  const rgb = Buffer.from(new Uint8Array(4 * 3 * 3).map((_, i) => i)).toString("base64");
  const crop = { rgb, width: 4, height: 3, landmarks: [1, 1, 3, 1, 2, 2, 1, 3, 3, 3], box: [0, 0, 4, 3], faceCount: 1 };

  it("convertit le recadrage natif en image RGB et en repères align.ts", () => {
    const sample = faceSampleFromCrop(crop);
    expect(sample.image).toMatchObject({ width: 4, height: 3, channels: 3, channelOrder: "rgb" });
    expect(sample.image.data[5]).toBe(5);
    expect(sample.face.landmarks.rightEye).toEqual([1, 1]);
    expect(sample.face.landmarks.leftEye).toEqual([3, 1]);
    expect(sample.face.landmarks.leftMouthCorner).toEqual([3, 3]);
    expect(sample.face.boundingBox).toEqual({ x: 0, y: 0, width: 4, height: 3 });
  });

  it("refuse un recadrage dont la taille ne correspond pas aux pixels", () => {
    expect(() => faceSampleFromCrop({ ...crop, width: 5 })).toThrow(RangeError);
    expect(() => faceSampleFromCrop({ ...crop, landmarks: [1, 2] })).toThrow(RangeError);
  });
});

import { describe, expect, it } from "vitest";
import { SelfieLivenessTracker, type FaceFrameSample } from "../../src/faceMatch/selfieLiveness";

const centered = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 };
const face = (timestamp: number, patch: Partial<FaceFrameSample> = {}): FaceFrameSample => ({
  faceCount: 1,
  timestamp,
  box: centered,
  turn: 0,
  eyeOpenness: 0.35,
  ...patch,
});

/** Joue une suite d'images, une toutes les 66 ms, et renvoie la dernière mise à jour. */
function play(tracker: SelfieLivenessTracker, start: number, frames: Array<Partial<FaceFrameSample>>) {
  let t = start;
  let last = tracker.push(face(t, frames[0]));
  const updates = [last];
  for (const patch of frames.slice(1)) {
    t += 66;
    last = tracker.push(face(t, patch));
    updates.push(last);
  }
  return { last, updates, end: t };
}

const still = (n: number, patch: Partial<FaceFrameSample> = {}) => Array.from({ length: n }, () => patch);

describe("SelfieLivenessTracker", () => {
  it("guide le cadrage avant de demander la capture", () => {
    const tracker = new SelfieLivenessTracker();
    expect(tracker.push({ faceCount: 0, timestamp: 0 }).hint).toBe("no-face");
    expect(tracker.push({ faceCount: 2, timestamp: 66, box: centered }).hint).toBe("multiple");
    expect(tracker.push(face(132, { box: { x: 0.42, y: 0.42, width: 0.16, height: 0.16 } })).hint).toBe("closer");
    expect(tracker.push(face(198, { box: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } })).hint).toBe("farther");
    expect(tracker.push(face(264, { box: { x: 0.0, y: 0.3, width: 0.4, height: 0.4 } })).hint).toBe("center");
    expect(tracker.push(face(330, { turn: 0.3 })).hint).toBe("face-camera");
    expect(tracker.phase).toBe(0);
  });

  it("demande une seule capture après ~0,7 s immobile de face, puis enchaîne rotation et clignement", () => {
    const tracker = new SelfieLivenessTracker();
    const hold = play(tracker, 0, still(12));
    const captures = hold.updates.filter((u) => u.requestCapture);
    expect(captures).toHaveLength(1);
    expect(hold.last.phase).toBe(1);

    const turn = play(tracker, hold.end + 66, [{ turn: 0.1 }, { turn: 0.2 }, { turn: 0.32 }, { turn: 0.2 }, { turn: 0.05 }]);
    expect(turn.last.phase).toBe(2);

    const blink = play(tracker, turn.end + 66, [{ eyeOpenness: 0.34 }, { eyeOpenness: 0.12 }, { eyeOpenness: 0.1 }, { eyeOpenness: 0.33 }]);
    expect(blink.last.phase).toBe(3);
    expect([...hold.updates, ...turn.updates, ...blink.updates].filter((u) => u.requestCapture)).toHaveLength(1);
  });

  it("n'accepte pas un clignement trop lent (yeux fermés plus de 0,9 s)", () => {
    const tracker = new SelfieLivenessTracker();
    const hold = play(tracker, 0, still(12));
    const turn = play(tracker, hold.end + 66, [{ turn: 0.3 }, { turn: 0 }]);
    const slow = play(tracker, turn.end + 66, [...still(20, { eyeOpenness: 0.1 }), { eyeOpenness: 0.34 }]);
    expect(slow.last.phase).toBe(2);
  });

  it("recommence si le visage disparaît plus d'une seconde en cours de séquence", () => {
    const tracker = new SelfieLivenessTracker();
    const hold = play(tracker, 0, still(12));
    expect(tracker.phase).toBe(1);
    tracker.push({ faceCount: 0, timestamp: hold.end + 500 });
    expect(tracker.phase).toBe(1);
    tracker.push({ faceCount: 2, timestamp: hold.end + 1200, box: centered });
    expect(tracker.phase).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  analyzeMrzLines,
  formatHint,
  groupIntoRows,
  isMrzLikeText,
  MrzConsensus,
  normalizeMrzText,
  type DetectedLine,
} from "../../src/mrz/mrzFromLines";

// Spécimens ICAO Doc 9303 (Part 4 TD3, Part 5 TD1).
const TD3 = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"];
const TD1 = ["I<UTOD231458907<<<<<<<<<<<<<<<", "7408122F1204159UTO<<<<<<<<<<<6", "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"];

function asLines(rows: string[], top = 0.6): DetectedLine[] {
  return rows.map((text, i) => ({ text, x: 0.05, y: top + i * 0.03, width: 0.9, height: 0.025 }));
}

describe("normalizeMrzText", () => {
  it("maps OCR filler look-alikes to '<' and strips spaces/punctuation", () => {
    expect(normalizeMrzText("p<uto eriksson«anna‹maria.")).toBe("P<UTOERIKSSON<<ANNA<MARIA");
  });
});

describe("analyzeMrzLines", () => {
  it("reads a clean TD3 passport MRZ", () => {
    const result = analyzeMrzLines(asLines(TD3));
    expect(result.kind).toBe("mrz");
    if (result.kind !== "mrz") return;
    expect(result.read.documentNumber).toBe("L898902C3");
    expect(result.read.dateOfBirth).toBe("740812");
    expect(result.read.dateOfExpiry).toBe("120415");
    expect(result.read.parsed.format).toBe("TD3");
  });

  it("reads a clean TD1 ID card MRZ", () => {
    const result = analyzeMrzLines(asLines(TD1));
    expect(result.kind).toBe("mrz");
    if (result.kind !== "mrz") return;
    expect(result.read.documentNumber).toBe("D23145890");
    expect(result.read.dateOfBirth).toBe("740812");
    expect(result.read.dateOfExpiry).toBe("120415");
    expect(result.read.parsed.format).toBe("TD1");
  });

  it("recovers from typical OCR noise: spaces, '«', letter/digit confusions in date fields", () => {
    const noisyLine2 = "L898902C3 6UTO74O8I22F12O4159ZE184226B«<<<10";
    const result = analyzeMrzLines(asLines([TD3[0], noisyLine2]));
    expect(result.kind).toBe("mrz");
    if (result.kind !== "mrz") return;
    expect(result.read.dateOfBirth).toBe("740812");
    expect(result.read.dateOfExpiry).toBe("120415");
  });

  it("repairs O/0 confusion inside the alphanumeric document number using its check digit", () => {
    const line2 = TD3[1].replace("L898902C3", "L8989O2C3");
    const result = analyzeMrzLines(asLines([TD3[0], line2]));
    expect(result.kind).toBe("mrz");
    if (result.kind !== "mrz") return;
    expect(result.read.documentNumber).toBe("L898902C3");
  });

  it("tolerates a dropped trailing filler character", () => {
    const result = analyzeMrzLines(asLines([TD3[0].slice(0, 43), TD3[1]]));
    expect(result.kind).toBe("mrz");
  });

  it("joins a MRZ line that Vision split into two observations", () => {
    const lines: DetectedLine[] = [
      { text: TD3[0], x: 0.05, y: 0.6, width: 0.9, height: 0.025 },
      { text: TD3[1].slice(22), x: 0.52, y: 0.631, width: 0.43, height: 0.025 },
      { text: TD3[1].slice(0, 22), x: 0.05, y: 0.63, width: 0.45, height: 0.025 },
    ];
    expect(groupIntoRows(lines)).toEqual(TD3);
    expect(analyzeMrzLines(lines).kind).toBe("mrz");
  });

  it("ignores unrelated text above the MRZ", () => {
    const lines = [...asLines(["REPUBLIQUE FRANCAISE", "CARTE NATIONALE D'IDENTITE"], 0.1), ...asLines(TD1)];
    expect(analyzeMrzLines(lines).kind).toBe("mrz");
  });

  it("rejects a read whose check digits do not match (never trusts OCR alone)", () => {
    const tampered = TD3[1].replace("7408122", "7408132");
    expect(analyzeMrzLines(asLines([TD3[0], tampered])).kind).toBe("none");
  });

  it("recognises the pre-2021 French ID card (2 x 36, no chip)", () => {
    const line1 = ("IDFRA" + "DUPONT").padEnd(30, "<") + "750123";
    const line2 = ("8806923102856" + "JEAN<<PIERRE").padEnd(27, "<") + "8001012M8";
    expect(line1).toHaveLength(36);
    expect(line2).toHaveLength(36);
    expect(analyzeMrzLines(asLines([line1, line2])).kind).toBe("legacy-fr-id");
  });

  it("returns none for random text", () => {
    expect(analyzeMrzLines(asLines(["HELLO WORLD", "NOTHING TO SEE"])).kind).toBe("none");
  });
});

describe("isMrzLikeText", () => {
  it("flags MRZ-shaped lines for highlighting and not ordinary text", () => {
    expect(isMrzLikeText(TD3[0])).toBe(true);
    expect(isMrzLikeText("CARTE NATIONALE D'IDENTITE")).toBe(false);
  });
});

describe("MrzConsensus", () => {
  it("only accepts a read once it has been seen twice", () => {
    const result = analyzeMrzLines(asLines(TD3));
    if (result.kind !== "mrz") throw new Error("fixture should parse");
    const consensus = new MrzConsensus();
    expect(consensus.push(result.read)).toBeNull();
    expect(consensus.push(null)).toBeNull();
    expect(consensus.push(result.read)?.key).toBe(result.read.key);
  });

  it("forgets reads older than the window", () => {
    const result = analyzeMrzLines(asLines(TD3));
    if (result.kind !== "mrz") throw new Error("fixture should parse");
    const consensus = new MrzConsensus(2, 3);
    consensus.push(result.read);
    consensus.push(null);
    consensus.push(null);
    consensus.push(null);
    expect(consensus.push(result.read)).toBeNull();
  });
});

describe("formatHint", () => {
  it("suggests TD3 as soon as one passport-length line is visible", () => {
    expect(formatHint([TD3[0]])).toBe("TD3");
    expect(formatHint(TD3)).toBe("TD3");
  });

  it("suggests TD1 only with at least two card-length lines", () => {
    expect(formatHint(TD1)).toBe("TD1");
    expect(formatHint([TD1[0]])).toBeUndefined();
  });

  it("stays silent on a passport line cut by the frame edge", () => {
    expect(formatHint([TD3[1].slice(0, 30)])).toBeUndefined();
  });
});

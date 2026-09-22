import { describe, it, expect } from "vitest";
import { buildCommandApdu, formatStatusWord, isSuccess, parseResponseApdu } from "../src/nfc/apdu";

describe("buildCommandApdu", () => {
  it("case 1 : ni données ni Le → seulement l'en-tête (4 octets)", () => {
    const apdu = buildCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x04, p2: 0x0c });
    expect(Array.from(apdu)).toEqual([0x00, 0xa4, 0x04, 0x0c]);
  });

  it("case 2 (forme courte) : Le seul → en-tête + 1 octet Le", () => {
    const apdu = buildCommandApdu({ cla: 0x00, ins: 0x84, p1: 0x00, p2: 0x00, le: 8 });
    expect(Array.from(apdu)).toEqual([0x00, 0x84, 0x00, 0x00, 0x08]);
  });

  it("case 3 (forme courte) : données seules → en-tête + Lc(1) + données", () => {
    const data = Uint8Array.of(0x01, 0x02, 0x03);
    const apdu = buildCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x02, p2: 0x0c, data });
    expect(Array.from(apdu)).toEqual([0x00, 0xa4, 0x02, 0x0c, 0x03, 0x01, 0x02, 0x03]);
  });

  it("case 4 (forme courte) : données + Le → en-tête + Lc(1) + données + Le(1)", () => {
    const data = Uint8Array.of(0xaa, 0xbb);
    const apdu = buildCommandApdu({ cla: 0x00, ins: 0x82, p1: 0x00, p2: 0x00, data, le: 8 });
    expect(Array.from(apdu)).toEqual([0x00, 0x82, 0x00, 0x00, 0x02, 0xaa, 0xbb, 0x08]);
  });

  it("Le=0 en forme courte s'encode comme l'octet 0x00 (convention ISO 7816-4 : signifie 256)", () => {
    const apdu = buildCommandApdu({ cla: 0x00, ins: 0xb0, p1: 0x00, p2: 0x00, le: 0 });
    expect(Array.from(apdu)).toEqual([0x00, 0xb0, 0x00, 0x00, 0x00]);
  });

  it("bascule en forme étendue quand les données dépassent 255 octets (Lc sur 3 octets : 0x00 + 2 octets de longueur)", () => {
    const data = new Uint8Array(300).fill(0x42);
    const apdu = buildCommandApdu({ cla: 0x00, ins: 0xd6, p1: 0x00, p2: 0x00, data });
    expect(Array.from(apdu.subarray(0, 7))).toEqual([0x00, 0xd6, 0x00, 0x00, 0x00, 0x01, 0x2c]); // 300 = 0x012C
    expect(apdu).toHaveLength(4 + 3 + 300);
    expect(Array.from(apdu.subarray(7))).toEqual(Array.from(data));
  });

  it("bascule en forme étendue quand Le dépasse 256, sans données (case 2E : 0x00 explicite devant Le sur 2 octets)", () => {
    const apdu = buildCommandApdu({ cla: 0x00, ins: 0xb0, p1: 0x00, p2: 0x00, le: 500 });
    expect(Array.from(apdu)).toEqual([0x00, 0xb0, 0x00, 0x00, 0x00, 0x01, 0xf4]); // 500 = 0x01F4
  });

  it("forme étendue avec données ET Le (case 4E) : Lc étendu, données, puis Le sur 2 octets SANS second préfixe 0x00", () => {
    const data = new Uint8Array(300).fill(0x01);
    const apdu = buildCommandApdu({ cla: 0x00, ins: 0xd6, p1: 0x00, p2: 0x00, data, le: 500 });
    expect(apdu).toHaveLength(4 + 3 + 300 + 2);
    const leBytes = apdu.subarray(apdu.length - 2);
    expect(Array.from(leBytes)).toEqual([0x01, 0xf4]);
  });

  it("rejette un octet d'en-tête hors plage 0..255", () => {
    expect(() => buildCommandApdu({ cla: 256, ins: 0xa4, p1: 0, p2: 0 })).toThrow();
    expect(() => buildCommandApdu({ cla: 0, ins: -1, p1: 0, p2: 0 })).toThrow();
  });
});

describe("parseResponseApdu", () => {
  it("sépare les données de SW1/SW2", () => {
    const bytes = Uint8Array.of(0x01, 0x02, 0x03, 0x90, 0x00);
    const response = parseResponseApdu(bytes);
    expect(Array.from(response.data)).toEqual([0x01, 0x02, 0x03]);
    expect(response.sw1).toBe(0x90);
    expect(response.sw2).toBe(0x00);
  });

  it("gère une réponse sans donnée (SW seul)", () => {
    const response = parseResponseApdu(Uint8Array.of(0x69, 0x82));
    expect(response.data).toHaveLength(0);
    expect(response.sw1).toBe(0x69);
    expect(response.sw2).toBe(0x82);
  });

  it("rejette une réponse trop courte pour contenir SW1/SW2", () => {
    expect(() => parseResponseApdu(Uint8Array.of(0x90))).toThrow();
    expect(() => parseResponseApdu(new Uint8Array(0))).toThrow();
  });
});

describe("isSuccess/formatStatusWord", () => {
  it("isSuccess est vrai uniquement pour 0x9000", () => {
    expect(isSuccess({ sw1: 0x90, sw2: 0x00 })).toBe(true);
    expect(isSuccess({ sw1: 0x69, sw2: 0x82 })).toBe(false);
    expect(isSuccess({ sw1: 0x90, sw2: 0x01 })).toBe(false);
  });

  it("formatStatusWord retourne 4 chiffres hexadécimaux majuscules", () => {
    expect(formatStatusWord({ sw1: 0x6a, sw2: 0x82 })).toBe("6A82");
    expect(formatStatusWord({ sw1: 0x9, sw2: 0x0 })).toBe("0900");
  });
});

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { ChipFileNotFoundError, ChipReaderError, readEmrtdChipData, dataGroupFileId, EF_SOD_FID } from "../src/nfc/chipReader";
import { incrementSsc, type SecureMessagingKeys } from "../src/nfc/secureMessaging";
import { computeRetailMac, constantTimeEquals, padIso9797Method2, unpadIso9797Method2 } from "../src/crypto/retailMac";
import { tripleDesCbcDecrypt, tripleDesCbcEncrypt } from "../src/crypto/tripleDes";
import type { ApduTransceiver } from "../src/nfc/bac";

const ZERO_IV = new Uint8Array(8);

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function encodeDerLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  if (length <= 0xff) return Uint8Array.of(0x81, length);
  return Uint8Array.of(0x82, (length >> 8) & 0xff, length & 0xff);
}

function tlv(tag: number, value: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(tag), encodeDerLength(value.length), value);
}

/** Construit un "fichier" ASN.1 DER réaliste (tag SEQUENCE 0x30 + longueur DER + corps arbitraire). */
function buildDerFile(bodyLength: number): Uint8Array {
  const body = Uint8Array.from(randomBytes(bodyLength));
  return concat(Uint8Array.of(0x30), encodeDerLength(bodyLength), body);
}

/** Petit parseur TLV local (tag 1 octet, longueur courte/0x81/0x82) — pour lire le corps des commandes SM reçues. */
function parseTlvAt(bytes: Uint8Array, offset: number) {
  const tag = bytes[offset];
  const first = bytes[offset + 1];
  let length: number;
  let valueOffset: number;
  if (first < 0x80) {
    length = first;
    valueOffset = offset + 2;
  } else if (first === 0x81) {
    length = bytes[offset + 2];
    valueOffset = offset + 3;
  } else {
    length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    valueOffset = offset + 4;
  }
  return { tag, value: bytes.subarray(valueOffset, valueOffset + length), raw: bytes.subarray(offset, valueOffset + length), nextOffset: valueOffset + length };
}

/**
 * Simule une puce servant SELECT/READ BINARY sous messagerie sécurisée, écrite indépendamment de
 * chipReader.ts (dispatch INS/P1/P2 propre, pas un simple miroir) — pour valider la logique de
 * sondage de longueur ASN.1 DER et de découpage en blocs sans matériel réel.
 */
class FakeSmChip implements ApduTransceiver {
  private ssc: Uint8Array;
  private applicationSelected = false;
  private currentFile: Uint8Array | undefined;

  constructor(
    private readonly keys: SecureMessagingKeys,
    initialSsc: Uint8Array,
    private readonly files: Record<number, Uint8Array>,
    private readonly aid: Uint8Array,
  ) {
    this.ssc = initialSsc;
  }

  async transceive(commandApdu: Uint8Array): Promise<Uint8Array> {
    this.ssc = incrementSsc(this.ssc);
    const ins = commandApdu[1];
    const p1 = commandApdu[2];
    const p2 = commandApdu[3];
    const lc = commandApdu[4];
    const body = commandApdu.subarray(5, 5 + lc);

    let plaintextData: Uint8Array | undefined;
    let requestedLe = 0;
    let macObject: Uint8Array | undefined;
    const authenticated: Uint8Array[] = [];
    let offset = 0;
    while (offset < body.length) {
      const parsed = parseTlvAt(body, offset);
      if (parsed.tag === 0x87) {
        const decrypted = tripleDesCbcDecrypt(this.keys.ksEnc, ZERO_IV, parsed.value.subarray(1));
        plaintextData = unpadIso9797Method2(decrypted);
        authenticated.push(parsed.raw);
      } else if (parsed.tag === 0x97) {
        requestedLe = parsed.value[0] === 0 ? 256 : parsed.value[0];
        authenticated.push(parsed.raw);
      } else if (parsed.tag === 0x8e) {
        macObject = parsed.value;
      }
      offset = parsed.nextOffset;
    }

    const paddedHeader = padIso9797Method2(Uint8Array.of(0x0c, ins, p1, p2));
    const macInput = padIso9797Method2(concat(this.ssc, paddedHeader, ...authenticated));
    const expectedMac = computeRetailMac(this.keys.ksMac, macInput);
    if (!macObject || !constantTimeEquals(expectedMac, macObject)) {
      throw new Error("FakeSmChip: MAC de commande invalide (bug de test, pas le comportement testé ici)");
    }

    let responsePlaintext: Uint8Array | undefined;
    let sw1 = 0x90;
    let sw2 = 0x00;

    if (ins === 0xa4 && p1 === 0x04) {
      if (!plaintextData || Buffer.compare(Buffer.from(plaintextData), Buffer.from(this.aid)) !== 0) {
        sw1 = 0x6a;
        sw2 = 0x82;
      } else {
        this.applicationSelected = true;
      }
    } else if (ins === 0xa4 && p1 === 0x02) {
      const fid = plaintextData ? (plaintextData[0] << 8) | plaintextData[1] : -1;
      if (!this.applicationSelected || !(fid in this.files)) {
        sw1 = 0x6a;
        sw2 = 0x82;
      } else {
        this.currentFile = this.files[fid];
      }
    } else if (ins === 0xb0) {
      const readOffset = (p1 << 8) | p2;
      if (!this.currentFile) {
        sw1 = 0x69;
        sw2 = 0x86;
      } else {
        responsePlaintext = this.currentFile.subarray(readOffset, readOffset + requestedLe);
      }
    } else if (ins === 0x88 && plaintextData) {
      // INTERNAL AUTHENTICATE simulé : "signature" = défi renversé (seul l'aller-retour SM est testé ici).
      responsePlaintext = Uint8Array.from(plaintextData).reverse();
    } else {
      sw1 = 0x6d;
      sw2 = 0x00;
    }

    this.ssc = incrementSsc(this.ssc);
    const objects: Uint8Array[] = [];
    if (responsePlaintext) {
      const encrypted = tripleDesCbcEncrypt(this.keys.ksEnc, ZERO_IV, padIso9797Method2(responsePlaintext));
      objects.push(tlv(0x87, concat(Uint8Array.of(0x01), encrypted)));
    }
    objects.push(tlv(0x99, Uint8Array.of(sw1, sw2)));
    const respMacInput = padIso9797Method2(concat(this.ssc, ...objects));
    const respMac = computeRetailMac(this.keys.ksMac, respMacInput);
    objects.push(tlv(0x8e, respMac));
    return concat(...objects, Uint8Array.of(0x90, 0x00));
  }
}

function randomSmKeys(): SecureMessagingKeys {
  return { ksEnc: Uint8Array.from(randomBytes(16)), ksMac: Uint8Array.from(randomBytes(16)) };
}

describe("readEmrtdChipData", () => {
  const keys = randomSmKeys();
  const initialSsc = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0);
  const AID = Uint8Array.of(0xa0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01);

  it("lit un petit fichier tenant dans la sonde initiale", async () => {
    const file = buildDerFile(3); // total 5 octets, < sonde de 6
    const chip = new FakeSmChip(keys, initialSsc, { [EF_SOD_FID]: file }, AID);
    const result = await readEmrtdChipData(chip, keys, initialSsc, [], { maxChunkSize: 10 });
    expect(Array.from(result.sod)).toEqual(Array.from(file));
  });

  it("lit un fichier nécessitant plusieurs blocs READ BINARY (longueur DER courte)", async () => {
    const file = buildDerFile(45); // 45 < 0x80, longueur DER sur 1 octet ; total 47 octets
    const chip = new FakeSmChip(keys, initialSsc, { [EF_SOD_FID]: file }, AID);
    const result = await readEmrtdChipData(chip, keys, initialSsc, [], { maxChunkSize: 10 });
    expect(Array.from(result.sod)).toEqual(Array.from(file));
  });

  it("lit un fichier nécessitant une longueur DER longue forme (0x81)", async () => {
    const file = buildDerFile(200); // > 0x80, longueur DER sur 0x81+1 octet
    const chip = new FakeSmChip(keys, initialSsc, { [EF_SOD_FID]: file }, AID);
    const result = await readEmrtdChipData(chip, keys, initialSsc, [], { maxChunkSize: 32 });
    expect(Array.from(result.sod)).toEqual(Array.from(file));
    expect(result.sod).toHaveLength(file.length);
  });

  it("lit EF.SOD ET plusieurs DG dans le même appel, chacun correctement isolé", async () => {
    const sodFile = buildDerFile(20);
    const dg1File = buildDerFile(15);
    const dg2File = buildDerFile(80);
    const chip = new FakeSmChip(
      keys,
      initialSsc,
      { [EF_SOD_FID]: sodFile, [dataGroupFileId(1)]: dg1File, [dataGroupFileId(2)]: dg2File },
      AID,
    );

    const result = await readEmrtdChipData(chip, keys, initialSsc, [1, 2], { maxChunkSize: 16 });

    expect(Array.from(result.sod)).toEqual(Array.from(sodFile));
    expect(Array.from(result.dataGroups[1])).toEqual(Array.from(dg1File));
    expect(Array.from(result.dataGroups[2])).toEqual(Array.from(dg2File));
  });

  it("ignore un DG facultatif absent de la puce (SW 6A82) et poursuit la lecture — ex. pas de DG15 sur une CNI française", async () => {
    const sodFile = buildDerFile(20);
    const dg1File = buildDerFile(15);
    const dg14File = buildDerFile(30);
    const chip = new FakeSmChip(
      keys,
      initialSsc,
      { [EF_SOD_FID]: sodFile, [dataGroupFileId(1)]: dg1File, [dataGroupFileId(14)]: dg14File },
      AID,
    );

    const result = await readEmrtdChipData(chip, keys, initialSsc, [1, 15, 14], { maxChunkSize: 16 });

    expect(result.missingDataGroups).toEqual([15]);
    expect(Object.keys(result.dataGroups).map(Number).sort((a, b) => a - b)).toEqual([1, 14]);
    expect(Array.from(result.dataGroups[14])).toEqual(Array.from(dg14File));
  });

  it("envoie INTERNAL AUTHENTICATE sous messagerie sécurisée quand DG15 est présent et un défi fourni", async () => {
    const chip = new FakeSmChip(
      keys,
      initialSsc,
      { [EF_SOD_FID]: buildDerFile(20), [dataGroupFileId(1)]: buildDerFile(15), [dataGroupFileId(15)]: buildDerFile(40) },
      AID,
    );
    const challenge = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
    const result = await readEmrtdChipData(chip, keys, initialSsc, [1, 15], { maxChunkSize: 16, activeAuthenticationChallenge: challenge });
    expect(Array.from(result.activeAuthentication!.response!)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);

    const withoutDg15 = new FakeSmChip(keys, initialSsc, { [EF_SOD_FID]: buildDerFile(20), [dataGroupFileId(1)]: buildDerFile(15) }, AID);
    const noAa = await readEmrtdChipData(withoutDg15, keys, initialSsc, [1, 15], { maxChunkSize: 16, activeAuthenticationChallenge: challenge });
    expect(noAa.activeAuthentication).toBeUndefined();
  });

  it("échoue si un DG obligatoire (DG1/DG2) est absent", async () => {
    const chip = new FakeSmChip(keys, initialSsc, { [EF_SOD_FID]: buildDerFile(20), [dataGroupFileId(1)]: buildDerFile(15) }, AID);
    await expect(readEmrtdChipData(chip, keys, initialSsc, [1, 2], { maxChunkSize: 16 })).rejects.toBeInstanceOf(ChipFileNotFoundError);
  });

  it("lève ChipReaderError si l'application eMRTD n'est pas trouvée (mauvais AID côté puce)", async () => {
    const wrongAid = Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
    const chip = new FakeSmChip(keys, initialSsc, { [EF_SOD_FID]: buildDerFile(10) }, wrongAid);
    await expect(readEmrtdChipData(chip, keys, initialSsc, [], { maxChunkSize: 10 })).rejects.toThrow(ChipReaderError);
  });

  it("lève ChipReaderError pour un DG hors plage (1..16)", () => {
    expect(() => dataGroupFileId(0)).toThrow(ChipReaderError);
    expect(() => dataGroupFileId(17)).toThrow(ChipReaderError);
  });

  it("dataGroupFileId suit la convention Doc 9303 Part 10 (FID = 0x0100 | numéro de DG)", () => {
    expect(dataGroupFileId(1)).toBe(0x0101);
    expect(dataGroupFileId(2)).toBe(0x0102);
    expect(dataGroupFileId(15)).toBe(0x010f);
    expect(dataGroupFileId(16)).toBe(0x0110);
  });
});

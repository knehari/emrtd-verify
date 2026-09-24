import { describe, expect, it } from "vitest";
import { createDiffieHellmanGroup, createECDH, generateKeyPairSync, randomBytes, type ECDH } from "node:crypto";
import { BitString, fromBER, Integer, ObjectIdentifier, Sequence, Set as Asn1Set } from "asn1js";
import { dataGroupFileId, EF_SOD_FID, readEmrtdChipData } from "../src/nfc/chipReader";
import { derivePaceKey } from "../src/nfc/pace";
import { parseDg14ChipAuthentication, selectChipAuthentication, verifyPaceCam } from "../src/nfc/chipAuthentication";
import { incrementSsc, type SecureMessagingKeys } from "../src/nfc/secureMessaging";
import { computeRetailMac, padIso9797Method2, unpadIso9797Method2 } from "../src/crypto/retailMac";
import { tripleDesCbcDecrypt, tripleDesCbcEncrypt } from "../src/crypto/tripleDes";
import { aesCbcDecrypt, aesCbcEncrypt, aesCmac8, aesEcbEncryptBlock } from "../src/crypto/aes";
import { bigIntToBytes, bytesToBigInt, standardizedEcDomain } from "../src/crypto/ecCurves";
import type { ApduTransceiver } from "../src/nfc/bac";

const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const derLength = (n: number) => (n < 0x80 ? [n] : n <= 0xff ? [0x81, n] : [0x82, n >> 8, n & 0xff]);
const tlv = (tag: number, value: Uint8Array) => Uint8Array.of(tag, ...derLength(value.length), ...value);
const der = (node: { toBER(sizeOnly?: boolean): ArrayBuffer }) => new Uint8Array(node.toBER(false));

function readTlv(bytes: Uint8Array, offset: number) {
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let start = offset + 2;
  if (length === 0x81) {
    length = bytes[offset + 2];
    start = offset + 3;
  } else if (length === 0x82) {
    length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    start = offset + 4;
  }
  return { tag, value: bytes.subarray(start, start + length), raw: bytes.subarray(offset, start + length), next: start + length };
}

/** Messagerie sécurisée côté puce (3DES ou AES), écrite à part de secureMessaging.ts. */
class ChipSm {
  constructor(
    public keys: SecureMessagingKeys,
    public ssc: Uint8Array,
  ) {}
  private get aes() {
    return this.keys.cipher === "AES";
  }
  private pad(data: Uint8Array) {
    return padIso9797Method2(data, this.aes ? 16 : 8);
  }
  private crypt(decrypt: boolean, data: Uint8Array) {
    if (this.aes) {
      const iv = aesEcbEncryptBlock(this.keys.ksEnc, this.ssc);
      return decrypt ? aesCbcDecrypt(this.keys.ksEnc, iv, data) : aesCbcEncrypt(this.keys.ksEnc, iv, data);
    }
    return decrypt ? tripleDesCbcDecrypt(this.keys.ksEnc, new Uint8Array(8), data) : tripleDesCbcEncrypt(this.keys.ksEnc, new Uint8Array(8), data);
  }
  private mac(data: Uint8Array) {
    return this.aes ? aesCmac8(this.keys.ksMac, this.pad(data)) : computeRetailMac(this.keys.ksMac, this.pad(data));
  }
  /** Commande déballée, ou null si le MAC ne correspond pas (le terminal n'a pas les mêmes clés). */
  unwrap(apdu: Uint8Array) {
    this.ssc = incrementSsc(this.ssc);
    const [, ins, p1, p2] = apdu;
    const extended = apdu[4] === 0 && apdu.length > 7;
    const lc = extended ? (apdu[5] << 8) | apdu[6] : apdu[4];
    const body = apdu.subarray(extended ? 7 : 5, (extended ? 7 : 5) + lc);
    const authenticated: Uint8Array[] = [];
    let mac: Uint8Array | undefined;
    for (let offset = 0; offset < body.length; ) {
      const t = readTlv(body, offset);
      if (t.tag === 0x87 || t.tag === 0x97) authenticated.push(t.raw);
      if (t.tag === 0x8e) mac = t.value;
      offset = t.next;
    }
    const expected = this.mac(concat(this.ssc, this.pad(Uint8Array.of(0x0c, ins, p1, p2)), ...authenticated));
    if (!mac || !expected.every((b, i) => b === mac![i])) return null;
    const do87 = authenticated.find((raw) => raw[0] === 0x87);
    const data = do87 ? unpadIso9797Method2(this.crypt(true, readTlv(do87, 0).value.subarray(1))) : new Uint8Array(0);
    return { ins, p1, p2, data };
  }
  wrap(data: Uint8Array | undefined, sw: [number, number]) {
    this.ssc = incrementSsc(this.ssc);
    const objects: Uint8Array[] = [];
    if (data && data.length > 0) objects.push(tlv(0x87, concat(Uint8Array.of(1), this.crypt(false, this.pad(data)))));
    objects.push(tlv(0x99, Uint8Array.of(...sw)));
    objects.push(tlv(0x8e, this.mac(concat(this.ssc, ...objects))));
    return concat(...objects, Uint8Array.of(0x90, 0x00));
  }
}

type StaticKey = { kind: "EC"; ecdh: ECDH } | { kind: "DH"; dh: ReturnType<typeof createDiffieHellmanGroup> };

/** Puce eMRTD simulée avec Chip Authentication. `clone` : ses données sont copiées, pas la clé privée. */
class CaChip implements ApduTransceiver {
  sm: ChipSm;
  private file: Uint8Array | undefined;
  switchedToCa = false;
  constructor(
    keys: SecureMessagingKeys,
    ssc: Uint8Array,
    private files: Record<number, Uint8Array>,
    private staticKey: StaticKey,
    private caCipher: { cipher: "3DES" | "AES"; keyLength: 16 | 24 | 32 },
    private clone = false,
  ) {
    this.sm = new ChipSm(keys, ssc);
  }
  async transceive(apdu: Uint8Array): Promise<Uint8Array> {
    const cmd = this.sm.unwrap(apdu);
    // Commande protégée avec des clés que la puce n'a pas : erreur non protégée, comme une vraie puce.
    if (!cmd) return Uint8Array.of(0x69, 0x88);
    let out: Uint8Array | undefined;
    let sw: [number, number] = [0x90, 0x00];
    let switchWith: Uint8Array | undefined;
    if (cmd.ins === 0xa4) {
      if (cmd.p1 === 0x02) {
        this.file = this.files[(cmd.data[0] << 8) | cmd.data[1]];
        if (!this.file) sw = [0x6a, 0x82];
      }
    } else if (cmd.ins === 0xb0 && this.file) {
      const offset = (cmd.p1 << 8) | cmd.p2;
      out = this.file.subarray(offset, offset + 64);
    } else if (cmd.ins === 0x22 && cmd.p2 === 0xa6) {
      switchWith = readTlv(cmd.data, 0).value; // MSE:Set KAT, 91 = clé éphémère du terminal
    } else if (cmd.ins === 0x22 && cmd.p2 === 0xa4) {
      // MSE:Set AT : protocole accepté.
    } else if (cmd.ins === 0x86) {
      switchWith = readTlv(readTlv(cmd.data, 0).value, 0).value; // 7C { 80 clé éphémère }
      out = Uint8Array.of(0x7c, 0x00);
    } else {
      sw = [0x6d, 0x00];
    }
    const response = this.sm.wrap(out, sw);
    if (switchWith) this.switchKeys(switchWith);
    return response;
  }
  private switchKeys(terminalPublic: Uint8Array) {
    let secret: Uint8Array;
    if (this.clone) {
      secret = Uint8Array.from(randomBytes(32));
    } else if (this.staticKey.kind === "EC") {
      secret = new Uint8Array(this.staticKey.ecdh.computeSecret(Buffer.from(terminalPublic)));
    } else {
      const primeLength = this.staticKey.dh.getPrime().length;
      const raw = new Uint8Array(this.staticKey.dh.computeSecret(Buffer.from(terminalPublic)));
      secret = concat(new Uint8Array(primeLength - raw.length), raw);
    }
    this.sm = new ChipSm(
      { ksEnc: derivePaceKey(secret, 1, this.caCipher), ksMac: derivePaceKey(secret, 2, this.caCipher), cipher: this.caCipher.cipher },
      new Uint8Array(this.caCipher.cipher === "AES" ? 16 : 8),
    );
    this.switchedToCa = true;
  }
}

function dg14(entries: Sequence[]): Uint8Array {
  return tlv(0x6e, der(new Asn1Set({ value: entries })));
}

function ecDg14(ecdh: ECDH, caOid: string | null, curveOid = "1.3.36.3.3.2.8.1.1.7") {
  const spki = new Sequence({
    value: [
      new Sequence({ value: [new ObjectIdentifier({ value: "1.2.840.10045.2.1" }), new ObjectIdentifier({ value: curveOid })] }),
      new BitString({ valueHex: new Uint8Array(ecdh.getPublicKey()).buffer }),
    ],
  });
  const entries = [new Sequence({ value: [new ObjectIdentifier({ value: "0.4.0.127.0.7.2.2.1.2" }), spki] })];
  if (caOid) entries.push(new Sequence({ value: [new ObjectIdentifier({ value: caOid }), new Integer({ value: 1 })] }));
  return dg14(entries);
}

function dhDg14(dh: ReturnType<typeof createDiffieHellmanGroup>) {
  const spki = new Sequence({
    value: [
      new Sequence({
        value: [
          new ObjectIdentifier({ value: "1.2.840.113549.1.3.1" }),
          new Sequence({ value: [Integer.fromBigInt(bytesToBigInt(dh.getPrime())), Integer.fromBigInt(bytesToBigInt(dh.getGenerator()))] }),
        ],
      }),
      new BitString({ valueHex: der(Integer.fromBigInt(bytesToBigInt(dh.getPublicKey()))).slice().buffer }),
    ],
  });
  return dg14([
    new Sequence({ value: [new ObjectIdentifier({ value: "0.4.0.127.0.7.2.2.1.1" }), spki] }),
    new Sequence({ value: [new ObjectIdentifier({ value: "0.4.0.127.0.7.2.2.3.1.1" }), new Integer({ value: 1 })] }),
  ]);
}

const dg1 = tlv(0x61, tlv(0x5f, new TextEncoder().encode("P<UTOERIKSSON<<ANNA<MARIA")));

function sessionKeys(cipher: "3DES" | "AES"): SecureMessagingKeys {
  return { ksEnc: Uint8Array.from(randomBytes(16)), ksMac: Uint8Array.from(randomBytes(16)), cipher };
}

function chipFiles(dg14Bytes: Uint8Array) {
  return { [EF_SOD_FID]: tlv(0x77, Uint8Array.of(1, 2, 3)), [dataGroupFileId(1)]: dg1, [dataGroupFileId(14)]: dg14Bytes };
}

async function readWith(chip: CaChip, keys: SecureMessagingKeys) {
  return readEmrtdChipData(chip, keys, new Uint8Array(keys.cipher === "AES" ? 16 : 8), [1, 14], { maxChunkSize: 64 });
}

function newEcdh(curve: string) {
  const ecdh = createECDH(curve);
  ecdh.generateKeys();
  return ecdh;
}

describe("Chip Authentication (Doc 9303 Part 11 §6.2)", () => {
  it("ECDH + AES-128 (MSE:Set AT + GENERAL AUTHENTICATE) sur un canal AES : la puce authentique prouve sa clé", async () => {
    const ecdh = newEcdh("brainpoolP256r1");
    const keys = sessionKeys("AES");
    const chip = new CaChip(keys, new Uint8Array(16), chipFiles(ecDg14(ecdh, "0.4.0.127.0.7.2.2.3.2.2")), { kind: "EC", ecdh }, { cipher: "AES", keyLength: 16 });
    const result = await readWith(chip, keys);
    expect(chip.switchedToCa).toBe(true);
    expect(result.chipAuthentication).toEqual({ performed: true, valid: true, protocol: "CA", oid: "0.4.0.127.0.7.2.2.3.2.2" });
  });

  it("ECDH + 3DES (MSE:Set KAT) après BAC, y compris CA 3DES implicite sans ChipAuthenticationInfo", async () => {
    for (const caOid of ["0.4.0.127.0.7.2.2.3.2.1", null]) {
      const ecdh = newEcdh("prime256v1");
      const keys = sessionKeys("3DES");
      const chip = new CaChip(keys, new Uint8Array(8), chipFiles(ecDg14(ecdh, caOid, "1.2.840.10045.3.1.7")), { kind: "EC", ecdh }, { cipher: "3DES", keyLength: 16 });
      const result = await readWith(chip, keys);
      expect(result.chipAuthentication).toMatchObject({ performed: true, valid: true, oid: "0.4.0.127.0.7.2.2.3.2.1" });
    }
  });

  it("DH (PKCS #3, groupe MODP 2048 bits) + 3DES, en APDU étendue", async () => {
    const dh = createDiffieHellmanGroup("modp14");
    dh.generateKeys();
    const keys = sessionKeys("3DES");
    const chip = new CaChip(keys, new Uint8Array(8), chipFiles(dhDg14(dh)), { kind: "DH", dh }, { cipher: "3DES", keyLength: 16 });
    const result = await readWith(chip, keys);
    expect(result.chipAuthentication).toMatchObject({ performed: true, valid: true, oid: "0.4.0.127.0.7.2.2.3.1.1" });
  });

  it("un clone (données copiées, sans la clé privée) est détecté : réalisée mais invalide", async () => {
    const ecdh = newEcdh("brainpoolP256r1");
    const keys = sessionKeys("AES");
    const chip = new CaChip(
      keys,
      new Uint8Array(16),
      chipFiles(ecDg14(ecdh, "0.4.0.127.0.7.2.2.3.2.2")),
      { kind: "EC", ecdh },
      { cipher: "AES", keyLength: 16 },
      true,
    );
    const result = await readWith(chip, keys);
    expect(result.chipAuthentication?.performed).toBe(true);
    expect(result.chipAuthentication?.valid).toBe(false);
  });

  it("désactivée : aucune tentative", async () => {
    const ecdh = newEcdh("brainpoolP256r1");
    const keys = sessionKeys("AES");
    const chip = new CaChip(keys, new Uint8Array(16), chipFiles(ecDg14(ecdh, "0.4.0.127.0.7.2.2.3.2.2")), { kind: "EC", ecdh }, { cipher: "AES", keyLength: 16 });
    const result = await readEmrtdChipData(chip, keys, new Uint8Array(16), [1, 14], { maxChunkSize: 64, chipAuthentication: { enabled: false } });
    expect(result.chipAuthentication).toBeUndefined();
    expect(chip.switchedToCa).toBe(false);
  });

  it("préfère AES à 3DES et reprend le keyId", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "brainpoolP256r1" });
    const spki = fromBER(new Uint8Array(publicKey.export({ type: "spki", format: "der" })).slice().buffer).result as Sequence;
    const bytes = dg14([
      new Sequence({ value: [new ObjectIdentifier({ value: "0.4.0.127.0.7.2.2.1.2" }), spki, new Integer({ value: 7 })] }),
      new Sequence({ value: [new ObjectIdentifier({ value: "0.4.0.127.0.7.2.2.3.2.1" }), new Integer({ value: 1 }), new Integer({ value: 7 })] }),
      new Sequence({ value: [new ObjectIdentifier({ value: "0.4.0.127.0.7.2.2.3.2.4" }), new Integer({ value: 1 }), new Integer({ value: 7 })] }),
    ]);
    const selection = selectChipAuthentication(parseDg14ChipAuthentication(bytes));
    expect(selection.info).toMatchObject({ cipher: "AES", keyLength: 32 });
    expect(selection.keyId).toBe(7);
  });
});

describe("PACE-CAM (Doc 9303 Part 11 §4.4.3.5)", () => {
  function modInverse(a: bigint, m: bigint) {
    let [r0, r1, s0, s1] = [a % m, m, 1n, 0n];
    while (r1 !== 0n) {
      const q = r0 / r1;
      [r0, r1, s0, s1] = [r1, r0 - q * r1, s1, s0 - q * s1];
    }
    return ((s0 % m) + m) % m;
  }

  it("accepte PK_map = CA_IC · PK_IC et refuse toute autre valeur", () => {
    const domain = standardizedEcDomain(13)!;
    const ecdh = newEcdh("brainpoolP256r1");
    const skIc = bytesToBigInt(ecdh.getPrivateKey());
    const skMap = (bytesToBigInt(randomBytes(40)) % (domain.order - 1n)) + 1n;
    // La puce envoie CA_IC = SK_IC⁻¹ · SK_map mod n ; donc CA_IC · PK_IC = SK_map · G = PK_map.
    const ca = (modInverse(skIc, domain.order) * skMap) % domain.order;
    const pkMap = domain.Point.BASE.multiply(skMap).toAffine();
    const encoded = Uint8Array.of(4, ...bigIntToBytes(pkMap.x, 32), ...bigIntToBytes(pkMap.y, 32));
    const parsed = parseDg14ChipAuthentication(ecDg14(ecdh, "0.4.0.127.0.7.2.2.3.2.2"));
    expect(verifyPaceCam({ chipAuthenticationData: bigIntToBytes(ca, 32), chipMappingPublicKey: encoded }, parsed)).toEqual({ valid: true });
    const wrong = bigIntToBytes((ca + 1n) % domain.order, 32);
    expect(verifyPaceCam({ chipAuthenticationData: wrong, chipMappingPublicKey: encoded }, parsed).valid).toBe(false);
  });

  it("déchiffre les données CAM d'une vraie carte allemande (trace de pace.test.ts) en un CA_IC valide", () => {
    const ksEnc = Uint8Array.from(Buffer.from("a8e85e938514ec67ae33cda3d43d3c48", "hex"));
    const aIc = Uint8Array.from(
      Buffer.from("b3ae8830311b1d5605777f47cb4ed028346cd00105d32859de127da3d8398865358f26f08ebe410864eaf6e39f33f3f5", "hex"),
    );
    const ca = unpadIso9797Method2(aesCbcDecrypt(ksEnc, aesEcbEncryptBlock(ksEnc, new Uint8Array(16).fill(0xff)), aIc));
    expect(ca.length).toBe(32);
    expect(bytesToBigInt(ca) < standardizedEcDomain(13)!.order).toBe(true);
  });
});

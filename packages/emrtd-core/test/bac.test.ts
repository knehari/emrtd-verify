import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { BacAuthenticationError, performBacHandshake, type ApduTransceiver } from "../src/nfc/bac";
import { parseResponseApdu } from "../src/nfc/apdu";
import { computeRetailMac, constantTimeEquals, padIso9797Method2 } from "../src/crypto/retailMac";
import { tripleDesCbcDecrypt, tripleDesCbcEncrypt } from "../src/crypto/tripleDes";
import { deriveKeyFromSeed, type BacSessionKeys } from "../src/mrz/bacKey";

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
function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * Simule le côté PUCE du protocole BAC, écrit indépendamment de performBacHandshake (pas un
 * simple appel inverse) — pour valider que deux implémentations distinctes du protocole
 * interopèrent correctement, seule validation possible sans accès à un exemple ICAO officiel
 * byte-exact dans cet environnement (voir docs/roadmap.md Phase 4).
 */
class FakeChip implements ApduTransceiver {
  protected rndIc: Uint8Array | undefined;
  public derivedSmKeys: { ksEnc: Uint8Array; ksMac: Uint8Array } | undefined;

  constructor(protected readonly documentKeys: BacSessionKeys) {}

  async transceive(commandApdu: Uint8Array): Promise<Uint8Array> {
    const ins = commandApdu[1];
    if (ins === 0x84) {
      return this.handleGetChallenge();
    } else if (ins === 0x82) {
      return this.handleMutualAuthenticate(commandApdu);
    }
    return Uint8Array.of(0x6d, 0x00); // instruction non supportée
  }

  private async handleGetChallenge(): Promise<Uint8Array> {
    this.rndIc = Uint8Array.from(randomBytes(8));
    return concat(this.rndIc, Uint8Array.of(0x90, 0x00));
  }

  private async handleMutualAuthenticate(commandApdu: Uint8Array): Promise<Uint8Array> {
    if (!this.rndIc) throw new Error("GET CHALLENGE requis avant MUTUAL AUTHENTICATE");
    const lc = commandApdu[4];
    const body = commandApdu.subarray(5, 5 + lc);
    const eIfd = body.subarray(0, 32);
    const mIfdReceived = body.subarray(32, 40);

    const mIfdExpected = computeRetailMac(this.documentKeys.kMac, padIso9797Method2(eIfd));
    if (!constantTimeEquals(mIfdExpected, mIfdReceived)) {
      return Uint8Array.of(0x63, 0x00); // authentification échouée (mauvaise clé document)
    }

    const decrypted = tripleDesCbcDecrypt(this.documentKeys.kEnc, ZERO_IV, eIfd);
    const rndIfdFromReader = decrypted.subarray(0, 8);
    const rndIcEchoedByReader = decrypted.subarray(8, 16);
    const kIfd = decrypted.subarray(16, 32);

    if (!constantTimeEquals(rndIcEchoedByReader, this.rndIc)) {
      return Uint8Array.of(0x63, 0x00);
    }

    const kIc = Uint8Array.from(randomBytes(16));
    const responsePlaintext = concat(this.rndIc, rndIfdFromReader, kIc);
    const eIc = tripleDesCbcEncrypt(this.documentKeys.kEnc, ZERO_IV, responsePlaintext);
    const mIc = computeRetailMac(this.documentKeys.kMac, padIso9797Method2(eIc));

    const sessionSeed = xor(kIfd, kIc);
    const [ksEnc, ksMac] = await Promise.all([deriveKeyFromSeed(sessionSeed, 1), deriveKeyFromSeed(sessionSeed, 2)]);
    this.derivedSmKeys = { ksEnc, ksMac };

    return concat(eIc, mIc, Uint8Array.of(0x90, 0x00));
  }
}

function randomDocumentKeys(): BacSessionKeys {
  return { kEnc: Uint8Array.from(randomBytes(16)), kMac: Uint8Array.from(randomBytes(16)) };
}

describe("performBacHandshake", () => {
  it("réussit face à une puce simulée indépendamment et dérive les mêmes clés de session des deux côtés", async () => {
    const documentKeys = randomDocumentKeys();
    const chip = new FakeChip(documentKeys);

    const result = await performBacHandshake(chip, documentKeys);

    expect(chip.derivedSmKeys).toBeDefined();
    expect(Array.from(result.smKeys.ksEnc)).toEqual(Array.from(chip.derivedSmKeys!.ksEnc));
    expect(Array.from(result.smKeys.ksMac)).toEqual(Array.from(chip.derivedSmKeys!.ksMac));
    expect(result.ssc).toHaveLength(8);
  });

  it("produit un SSC initial = 4 octets de poids faible de RND.IC || 4 octets de poids faible de RND.IFD", async () => {
    const documentKeys = randomDocumentKeys();
    let capturedRndIc: Uint8Array | undefined;
    let capturedRndIfdFromReader: Uint8Array | undefined;
    const chip = new (class extends FakeChip {
      async transceive(apdu: Uint8Array): Promise<Uint8Array> {
        const raw = await super.transceive(apdu);
        if (apdu[1] === 0x84) {
          capturedRndIc = parseResponseApdu(raw).data.subarray(0, 8);
        }
        if (apdu[1] === 0x82 && capturedRndIc) {
          const lc = apdu[4];
          const eIfd = apdu.subarray(5, 5 + lc).subarray(0, 32);
          const decrypted = tripleDesCbcDecrypt(documentKeys.kEnc, ZERO_IV, eIfd);
          capturedRndIfdFromReader = decrypted.subarray(0, 8);
        }
        return raw;
      }
    })(documentKeys);

    const result = await performBacHandshake(chip, documentKeys);

    expect(Array.from(result.ssc)).toEqual([
      ...Array.from(capturedRndIc!.subarray(4, 8)),
      ...Array.from(capturedRndIfdFromReader!.subarray(4, 8)),
    ]);
  });

  it("rejette l'authentification si la puce ne détient pas la clé document attendue (MRZ mal lue)", async () => {
    const readerKeys = randomDocumentKeys();
    const chipKeys = randomDocumentKeys(); // différentes de readerKeys
    const chip = new FakeChip(chipKeys);

    await expect(performBacHandshake(chip, readerKeys)).rejects.toThrow(BacAuthenticationError);
  });

  it("rejette une réponse GET CHALLENGE de longueur incorrecte", async () => {
    const documentKeys = randomDocumentKeys();
    const brokenChip: ApduTransceiver = {
      async transceive(apdu) {
        if (apdu[1] === 0x84) return Uint8Array.of(1, 2, 3, 0x90, 0x00); // seulement 3 octets au lieu de 8
        return Uint8Array.of(0x6d, 0x00);
      },
    };
    await expect(performBacHandshake(brokenChip, documentKeys)).rejects.toThrow(BacAuthenticationError);
  });

  it("rejette la réponse MUTUAL AUTHENTICATE si son MAC a été altéré en transit (falsification détectée avant déchiffrement)", async () => {
    const documentKeys = randomDocumentKeys();
    const chip = new FakeChip(documentKeys);
    let callCount = 0;
    const tamperingChip: ApduTransceiver = {
      async transceive(apdu) {
        const raw = await chip.transceive(apdu);
        callCount++;
        if (apdu[1] === 0x82) {
          const tampered = Uint8Array.from(raw);
          tampered[39] ^= 0x01; // altère le dernier octet du MIC
          return tampered;
        }
        return raw;
      },
    };

    await expect(performBacHandshake(tamperingChip, documentKeys)).rejects.toThrow(BacAuthenticationError);
    expect(callCount).toBe(2);
  });

  it("rejette si la puce renvoie un RND.IFD différent de celui envoyé (indice d'usurpation/rejeu)", async () => {
    const documentKeys = randomDocumentKeys();
    class SpoofingChip extends FakeChip {
      async transceive(apdu: Uint8Array): Promise<Uint8Array> {
        if (apdu[1] !== 0x82) return super.transceive(apdu);
        const lc = apdu[4];
        const eIfd = apdu.subarray(5, 5 + lc).subarray(0, 32);
        const decrypted = tripleDesCbcDecrypt(documentKeys.kEnc, ZERO_IV, eIfd);
        const rndIc = decrypted.subarray(8, 16); // ce que le lecteur a écho de RND.IC (correct ici)
        const wrongRndIfd = Uint8Array.from(randomBytes(8)); // délibérément faux
        const kIc = Uint8Array.from(randomBytes(16));
        const plaintext = concat(rndIc, wrongRndIfd, kIc);
        const eIc = tripleDesCbcEncrypt(documentKeys.kEnc, ZERO_IV, plaintext);
        const mIc = computeRetailMac(documentKeys.kMac, padIso9797Method2(eIc));
        return concat(eIc, mIc, Uint8Array.of(0x90, 0x00));
      }
    }

    await expect(performBacHandshake(new SpoofingChip(documentKeys), documentKeys)).rejects.toThrow(BacAuthenticationError);
  });

  it("des sessions successives avec la même puce produisent des clés de session différentes (nonces frais à chaque fois)", async () => {
    const documentKeys = randomDocumentKeys();
    const chip1 = new FakeChip(documentKeys);
    const chip2 = new FakeChip(documentKeys);

    const result1 = await performBacHandshake(chip1, documentKeys);
    const result2 = await performBacHandshake(chip2, documentKeys);

    expect(Array.from(result1.smKeys.ksEnc)).not.toEqual(Array.from(result2.smKeys.ksEnc));
  });
});

describe("performBacHandshake — exemple travaillé officiel ICAO (Doc 9303 Part 11 Appendix D.2/D.3)", () => {
  // Toutes les valeurs ci-dessous sont confirmées byte-exact contre les pages scannées de la
  // spécification (App D-2/D-3, fournies par l'utilisateur), à l'exception de K.ICC/Kseed' :
  // ces deux-là ne provenaient que d'une transcription texte (Appendix D.3, jamais capturée en
  // image) et se sont révélées incohérentes entre elles (Kseed' ≠ Kifd XOR Kicc calculé) —
  // elles sont donc volontairement absentes d'ici plutôt que supposées correctes.
  const documentKeys: BacSessionKeys = {
    kEnc: Uint8Array.from(Buffer.from("AB94FDECF2674FDFB9B391F85D7F76F2", "hex")),
    kMac: Uint8Array.from(Buffer.from("7962D9ECE03D1ACD4C76089DCE131543", "hex")),
  };
  const officialRndIc = Uint8Array.from(Buffer.from("4608F91988702212", "hex"));
  const officialRndIfd = Uint8Array.from(Buffer.from("781723860C06C226", "hex"));
  const officialKIfd = Uint8Array.from(Buffer.from("0B795240CB7049B01C19B33E32804F0B", "hex"));
  const officialEIfd = "72C29C2371CC9BDB65B779B8E8D37B29ECC154AA56A8799FAE2F498F76ED92F2";

  it("construit une commande MUTUAL AUTHENTICATE dont E_IFD est un chiffré 3DES-CBC valide de 32 octets face au RND.IC officiel", async () => {
    let capturedEIfdHex: string | undefined;
    const chip: ApduTransceiver = {
      async transceive(apdu) {
        if (apdu[1] === 0x84) {
          return concat(officialRndIc, Uint8Array.of(0x90, 0x00));
        }
        if (apdu[1] === 0x82) {
          const lc = apdu[4];
          const data = apdu.subarray(5, 5 + lc);
          const eIfd = data.subarray(0, 32);
          capturedEIfdHex = Buffer.from(eIfd).toString("hex").toUpperCase();
          // Comme une vraie puce : déchiffre EIFD avec KEnc pour récupérer le RND.IFD réellement
          // généré par le client (aléatoire, différent à chaque exécution — pas la valeur
          // documentée ICAO, qui n'apparaît que pour le RND.IFD spécifique de l'exemple travaillé).
          const decrypted = tripleDesCbcDecrypt(documentKeys.kEnc, ZERO_IV, eIfd);
          const actualRndIfd = decrypted.subarray(0, 8);
          const kIcc = Uint8Array.from(randomBytes(16));
          const r = concat(officialRndIc, actualRndIfd, kIcc);
          const eIcc = tripleDesCbcEncrypt(documentKeys.kEnc, ZERO_IV, r);
          const mIcc = computeRetailMac(documentKeys.kMac, padIso9797Method2(eIcc));
          return concat(eIcc, mIcc, Uint8Array.of(0x90, 0x00));
        }
        return Uint8Array.of(0x6d, 0x00);
      },
    };

    // RND.IFD est généré aléatoirement par performBacHandshake (crypto.getRandomValues) — non
    // déterministe, donc ce test ne peut pas forcer RND.IFD=officialRndIfd. Il vérifie à la place
    // que le protocole aboutit et produit un E_IFD de la bonne forme ; le test suivant vérifie
    // indépendamment que l'algorithme de chiffrement lui-même reproduit exactement l'exemple
    // ICAO officiel pour le RND.IFD documenté.
    await performBacHandshake(chip, documentKeys);
    expect(capturedEIfdHex).toBeDefined();
    expect(capturedEIfdHex).toHaveLength(64);
  });

  it("E_IFD = 3DES-CBC(KEnc, RND.IFD||RND.IC||K.IFD) reproduit exactement l'exemple ICAO officiel pour le RND.IFD documenté", () => {
    const s = concat(officialRndIfd, officialRndIc, officialKIfd);
    const eIfd = tripleDesCbcEncrypt(documentKeys.kEnc, ZERO_IV, s);
    expect(Buffer.from(eIfd).toString("hex").toUpperCase()).toBe(officialEIfd);
  });
});

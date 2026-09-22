import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  incrementSsc,
  SecureMessagingError,
  unwrapResponseApdu,
  wrapCommandApdu,
  type SecureMessagingKeys,
} from "../src/nfc/secureMessaging";
import { computeRetailMac, padIso9797Method2 } from "../src/crypto/retailMac";
import { tripleDesCbcDecrypt, tripleDesCbcEncrypt } from "../src/crypto/tripleDes";
import { parseResponseApdu } from "../src/nfc/apdu";

function randomKeys(): SecureMessagingKeys {
  return { ksEnc: Uint8Array.from(randomBytes(16)), ksMac: Uint8Array.from(randomBytes(16)) };
}

describe("incrementSsc", () => {
  it("incrémente le dernier octet dans le cas simple", () => {
    const ssc = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 5);
    expect(Array.from(incrementSsc(ssc))).toEqual([0, 0, 0, 0, 0, 0, 0, 6]);
  });

  it("propage la retenue sur plusieurs octets", () => {
    const ssc = Uint8Array.of(0, 0, 0, 0, 0, 0, 0xff, 0xff);
    expect(Array.from(incrementSsc(ssc))).toEqual([0, 0, 0, 0, 0, 0x01, 0x00, 0x00]);
  });

  it("boucle à zéro depuis la valeur maximale", () => {
    const ssc = new Uint8Array(8).fill(0xff);
    expect(Array.from(incrementSsc(ssc))).toEqual(new Array(8).fill(0));
  });

  it("ne mute pas le tableau d'entrée", () => {
    const ssc = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 5);
    incrementSsc(ssc);
    expect(Array.from(ssc)).toEqual([0, 0, 0, 0, 0, 0, 0, 5]);
  });
});

/** Petit constructeur BER-TLV local, écrit indépendamment de encodeTlv (non exporté) — pour que
 * les tests ci-dessous simulent une "puce" sans réutiliser le code interne testé. */
function tlv(tag: number, value: Uint8Array): Uint8Array {
  const lengthBytes = value.length < 0x80 ? Uint8Array.of(value.length) : Uint8Array.of(0x81, value.length);
  const out = new Uint8Array(1 + lengthBytes.length + value.length);
  out.set([tag], 0);
  out.set(lengthBytes, 1);
  out.set(value, 1 + lengthBytes.length);
  return out;
}
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

describe("wrapCommandApdu", () => {
  const keys = randomKeys();
  const initialSsc = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0);

  it("force CLA à 0x0C quel que soit le CLA d'entrée", () => {
    const { wrapped } = wrapCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x02, p2: 0x0c, data: Uint8Array.of(1, 2) }, keys, initialSsc);
    expect(wrapped[0]).toBe(0x0c);
    expect(wrapped[1]).toBe(0xa4);
  });

  it("consomme exactement un incrément de SSC", () => {
    const { nextSsc } = wrapCommandApdu({ cla: 0x00, ins: 0xb0, p1: 0, p2: 0, le: 0 }, keys, initialSsc);
    expect(Array.from(nextSsc)).toEqual(Array.from(incrementSsc(initialSsc)));
  });

  it("produit un DO87 (données chiffrées) et un DO8E (MAC) déchiffrables/vérifiables indépendamment — simule le déballage côté puce", () => {
    const plaintext = Uint8Array.of(0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03);
    const { wrapped, nextSsc } = wrapCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x02, p2: 0x0c, data: plaintext }, keys, initialSsc);

    // "Puce" : réanalyse manuelle du corps protégé (Lc en position 4, forme courte car < 256).
    const lc = wrapped[4];
    const body = wrapped.subarray(5, 5 + lc);
    expect(body[0]).toBe(0x87); // DO87 en premier
    const do87Len = body[1];
    const do87Value = body.subarray(2, 2 + do87Len);
    const do8eStart = 2 + do87Len;
    expect(body[do8eStart]).toBe(0x8e);
    const mac = body.subarray(do8eStart + 2, do8eStart + 2 + body[do8eStart + 1]);

    // Vérifie le MAC comme le ferait la puce : SSC || en-tête paddé || DO87 complet.
    const paddedHeader = padIso9797Method2(Uint8Array.of(0x0c, 0xa4, 0x02, 0x0c));
    const do87Tlv = tlv(0x87, do87Value);
    const macInput = padIso9797Method2(concat(nextSsc, paddedHeader, do87Tlv));
    const expectedMac = computeRetailMac(keys.ksMac, macInput);
    expect(Array.from(mac)).toEqual(Array.from(expectedMac));

    // Déchiffre DO87 (après l'octet indicateur 0x01) et retire le padding.
    expect(do87Value[0]).toBe(0x01);
    const decrypted = tripleDesCbcDecrypt(keys.ksEnc, new Uint8Array(8), do87Value.subarray(1));
    // padIso9797Method2 ajoute 0x80 puis des zéros : on retrouve le texte clair en retirant le padding.
    let end = decrypted.length;
    while (end > 0 && decrypted[end - 1] === 0) end--;
    expect(decrypted[end - 1]).toBe(0x80);
    expect(Array.from(decrypted.subarray(0, end - 1))).toEqual(Array.from(plaintext));
  });

  it("des clés différentes produisent des DO8E différents pour la même commande", () => {
    const a = wrapCommandApdu({ cla: 0x00, ins: 0xb0, p1: 0, p2: 0, le: 8 }, keys, initialSsc);
    const b = wrapCommandApdu({ cla: 0x00, ins: 0xb0, p1: 0, p2: 0, le: 8 }, randomKeys(), initialSsc);
    expect(Array.from(a.wrapped)).not.toEqual(Array.from(b.wrapped));
  });
});

describe("unwrapResponseApdu", () => {
  const keys = randomKeys();
  const initialSsc = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0);

  /** Construit une réponse protégée comme le ferait la puce, avec les primitives déjà testées indépendamment. */
  function buildFakeChipResponse(plaintext: Uint8Array | undefined, sw1: number, sw2: number, ssc: Uint8Array): Uint8Array {
    const objects: Uint8Array[] = [];
    if (plaintext) {
      const encrypted = tripleDesCbcEncrypt(keys.ksEnc, new Uint8Array(8), padIso9797Method2(plaintext));
      objects.push(tlv(0x87, concat(Uint8Array.of(0x01), encrypted)));
    }
    const do99 = tlv(0x99, Uint8Array.of(sw1, sw2));
    objects.push(do99);
    const macInput = padIso9797Method2(concat(ssc, ...objects));
    const mac = computeRetailMac(keys.ksMac, macInput);
    objects.push(tlv(0x8e, mac));
    const body = concat(...objects);
    return concat(body, Uint8Array.of(0x90, 0x00));
  }

  it("déchiffre et authentifie une réponse protégée construite indépendamment (simulation puce)", () => {
    const expectedSsc = incrementSsc(initialSsc);
    const plaintext = Uint8Array.of(1, 2, 3, 4, 5);
    const raw = buildFakeChipResponse(plaintext, 0x90, 0x00, expectedSsc);

    const { response, nextSsc } = unwrapResponseApdu(raw, keys, initialSsc);

    expect(Array.from(response.data)).toEqual(Array.from(plaintext));
    expect(response.sw1).toBe(0x90);
    expect(response.sw2).toBe(0x00);
    expect(Array.from(nextSsc)).toEqual(Array.from(expectedSsc));
  });

  it("restitue le statut réel porté par DO99 même si le SW externe de l'APDU diffère", () => {
    const expectedSsc = incrementSsc(initialSsc);
    const raw = buildFakeChipResponse(undefined, 0x6a, 0x82, expectedSsc);
    const { response } = unwrapResponseApdu(raw, keys, initialSsc);
    expect(response.sw1).toBe(0x6a);
    expect(response.sw2).toBe(0x82);
  });

  it("gère une réponse sans DO87 (aucune donnée, juste un statut)", () => {
    const expectedSsc = incrementSsc(initialSsc);
    const raw = buildFakeChipResponse(undefined, 0x90, 0x00, expectedSsc);
    const { response } = unwrapResponseApdu(raw, keys, initialSsc);
    expect(response.data).toHaveLength(0);
  });

  it("rejette une réponse dont le MAC a été altéré (propriété de sécurité critique)", () => {
    const expectedSsc = incrementSsc(initialSsc);
    const raw = buildFakeChipResponse(Uint8Array.of(9, 9), 0x90, 0x00, expectedSsc);
    const tampered = Uint8Array.from(raw);
    tampered[tampered.length - 3] ^= 0x01; // altère le dernier octet du MAC (juste avant le SW final)
    expect(() => unwrapResponseApdu(tampered, keys, initialSsc)).toThrow(SecureMessagingError);
  });

  it("rejette une réponse dont les données chiffrées ont été altérées sans toucher au MAC (détection de falsification, pas seulement de corruption aléatoire)", () => {
    const expectedSsc = incrementSsc(initialSsc);
    const raw = buildFakeChipResponse(Uint8Array.of(9, 9, 9, 9, 9, 9, 9, 9), 0x90, 0x00, expectedSsc);
    const tampered = Uint8Array.from(raw);
    tampered[3] ^= 0x01; // un octet dans DO87, avant le DO8E
    expect(() => unwrapResponseApdu(tampered, keys, initialSsc)).toThrow(SecureMessagingError);
  });

  it("rejette une réponse chiffrée/authentifiée avec de mauvaises clés (désynchronisation)", () => {
    const expectedSsc = incrementSsc(initialSsc);
    const raw = buildFakeChipResponse(Uint8Array.of(1), 0x90, 0x00, expectedSsc);
    expect(() => unwrapResponseApdu(raw, randomKeys(), initialSsc)).toThrow(SecureMessagingError);
  });

  it("rejette une réponse avec un SSC désynchronisé (rejeu ou perte d'échange)", () => {
    const wrongSsc = incrementSsc(incrementSsc(initialSsc)); // MAC calculé pour SSC+2, pas SSC+1
    const raw = buildFakeChipResponse(Uint8Array.of(1), 0x90, 0x00, wrongSsc);
    expect(() => unwrapResponseApdu(raw, keys, initialSsc)).toThrow(SecureMessagingError);
  });
});

describe("round-trip complet wrap→(analyse indépendante)→unwrap", () => {
  it("une commande construite par wrapCommandApdu peut être authentifiée et déchiffrée par une implémentation indépendante, et sa réponse simulée redonne les mêmes données via unwrapResponseApdu", () => {
    const keys = randomKeys();
    let ssc = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0);

    const commandPlaintext = Uint8Array.of(1, 2, 3, 4, 5, 6, 7);
    const { nextSsc: sscAfterCommand } = wrapCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x02, p2: 0x0c, data: commandPlaintext }, keys, ssc);
    ssc = sscAfterCommand;

    // La "puce" répond avec des données arbitraires, protégées avec le SSC déjà avancé par la commande.
    const responsePlaintext = Uint8Array.of(9, 8, 7, 6);
    const sscForResponse = incrementSsc(ssc);
    const encrypted = tripleDesCbcEncrypt(keys.ksEnc, new Uint8Array(8), padIso9797Method2(responsePlaintext));
    const do87 = tlv(0x87, concat(Uint8Array.of(0x01), encrypted));
    const do99 = tlv(0x99, Uint8Array.of(0x90, 0x00));
    const macInput = padIso9797Method2(concat(sscForResponse, do87, do99));
    const mac = computeRetailMac(keys.ksMac, macInput);
    const rawResponse = concat(do87, do99, tlv(0x8e, mac), Uint8Array.of(0x90, 0x00));

    const { response, nextSsc } = unwrapResponseApdu(rawResponse, keys, ssc);
    expect(Array.from(response.data)).toEqual(Array.from(responsePlaintext));
    expect(response.sw1).toBe(0x90);
    expect(response.sw2).toBe(0x00);
    expect(Array.from(nextSsc)).toEqual(Array.from(sscForResponse));
    expect(parseResponseApdu(rawResponse).sw1).toBe(0x90); // sanity : l'APDU externe reste bien formée
  });
});

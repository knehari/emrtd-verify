import { describe, it, expect } from "vitest";
import {
  PaceAuthenticationError,
  derivePaceKey,
  encodeOidContent,
  parsePaceInfos,
  performPace,
  selectSupportedPaceInfo,
  type PaceInfo,
  type PacePassword,
} from "../src/nfc/pace";
import type { ApduTransceiver } from "../src/nfc/bac";
import { unwrapResponseApdu, wrapCommandApdu } from "../src/nfc/secureMessaging";

const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** Puce rejouée : chaque commande envoyée DOIT être exactement celle de la trace de référence. */
class ScriptedChip implements ApduTransceiver {
  private index = 0;
  constructor(private readonly script: [string, string][]) {}
  async transceive(command: Uint8Array): Promise<Uint8Array> {
    const step = this.script[this.index++];
    if (!step) throw new Error(`Commande inattendue au-delà de la trace : ${toHex(command)}`);
    expect(toHex(command)).toBe(step[0].toLowerCase());
    return hex(step[1]);
  }
  get finished(): boolean {
    return this.index === this.script.length;
  }
}

function fixedKeys(mapping: string, agreement: string) {
  return (_domain: unknown, step: "mapping" | "agreement") => BigInt("0x" + (step === "mapping" ? mapping : agreement));
}

/*
 * Traces : tests de gmrtd (bibliothèque Go de lecture eMRTD, pace/pace_test.go) — exemple travaillé
 * officiel ICAO Doc 9303 Part 11 Appendix G.1, passeport néo-zélandais (3DES), carte d'identité
 * allemande (PACE-CAM, AES). Mêmes clés éphémères que la trace pour obtenir les mêmes octets.
 */
describe("performPace — exemple travaillé ICAO Doc 9303 Part 11 Appendix G.1 (ECDH-GM, AES-128, brainpoolP256r1)", () => {
  const cardAccess = hex("31143012060A04007F0007020204020202010202010D");
  const password: PacePassword = { kind: "mrz", accessKey: { documentNumber: "T22000129", dateOfBirth: "640812", dateOfExpiry: "101031" } };

  it("EF.CardAccess → PACEInfo ECDH-GM AES-128, paramètres 13", () => {
    const infos = parsePaceInfos(cardAccess);
    expect(infos).toEqual([
      { oid: "0.4.0.127.0.7.2.2.4.2.2", version: 2, parameterId: 13, mapping: "GM", agreement: "ECDH", cipher: "AES", keyLength: 16 },
    ]);
    expect(toHex(encodeOidContent(infos[0].oid))).toBe("04007f00070202040202");
  });

  it("Kπ, chaque APDU échangée et les clés de session sont exactement ceux de l'ICAO", async () => {
    const [info] = parsePaceInfos(cardAccess);
    expect(toHex(derivePaceKey(Uint8Array.from(Buffer.from("7E2D2A41C74EA0B38CD36F863939BFA8E9032AAD", "hex")), 3, info))).toBe(
      "89ded1b26624ec1e634c1989302849dd",
    );
    const chip = new ScriptedChip([
      ["0022C1A412800A04007F0007020204020283010184010D", "9000"],
      ["10860000027C0000", "7C12801095A3A016522EE98D01E76CB6B98B42C39000"],
      [
        "10860000457C438141047ACF3EFC982EC45565A4B155129EFBC74650DCBFA6362D896FC70262E0C2CC5E544552DCB6725218799115B55C9BAA6D9F6BC3A9618E70C25AF71777A9C4922D00",
        "7C43824104824FBA91C9CBE26BEF53A0EBE7342A3BF178CEA9F45DE0B70AA601651FBA3F5730D8C879AAA9C9F73991E61B58F4D52EB87A0A0C709A49DC63719363CCD13C549000",
      ],
      [
        "10860000457C438341042DB7A64C0355044EC9DF190514C625CBA2CEA48754887122F3A5EF0D5EDD301C3556F3B3B186DF10B857B58F6A7EB80F20BA5DC7BE1D43D9BF850149FBB3646200",
        "7C438441049E880F842905B8B3181F7AF7CAA9F0EFB743847F44A306D2D28C1D9EC65DF6DB7764B22277A2EDDC3C265A9F018F9CB852E111B768B326904B59A0193776F0949000",
      ],
      ["008600000C7C0A8508C2B0BD78D94BA86600", "7C0A86083ABB9674BCE93C089000"],
    ]);
    const result = await performPace(chip, password, info, {
      generatePrivateKey: fixedKeys(
        "7F4EF07B9EA82FD78AD689B38D0BC78CF21F249D953BC46F4C6E19259C010F99",
        "A73FB703AC1436A18E0CFA5ABB3F7BEC7A070E7A6788486BEE230C4A22762595",
      ),
    });
    expect(chip.finished).toBe(true);
    expect(toHex(result.smKeys.ksEnc)).toBe("f5f0e35c0d7161ee6724ee513a0d9a7f");
    expect(toHex(result.smKeys.ksMac)).toBe("fe251c7858b356b24514b3bd5f4297d1");
    expect(result.smKeys.cipher).toBe("AES");
    expect(toHex(result.ssc)).toBe("00".repeat(16));
  });

  it("jeton de la puce faux → PaceAuthenticationError (MRZ incorrecte ou document non authentique)", async () => {
    const [info] = parsePaceInfos(cardAccess);
    const chip = new ScriptedChip([
      ["0022C1A412800A04007F0007020204020283010184010D", "9000"],
      ["10860000027C0000", "7C12801095A3A016522EE98D01E76CB6B98B42C39000"],
      [
        "10860000457C438141047ACF3EFC982EC45565A4B155129EFBC74650DCBFA6362D896FC70262E0C2CC5E544552DCB6725218799115B55C9BAA6D9F6BC3A9618E70C25AF71777A9C4922D00",
        "7C43824104824FBA91C9CBE26BEF53A0EBE7342A3BF178CEA9F45DE0B70AA601651FBA3F5730D8C879AAA9C9F73991E61B58F4D52EB87A0A0C709A49DC63719363CCD13C549000",
      ],
      [
        "10860000457C438341042DB7A64C0355044EC9DF190514C625CBA2CEA48754887122F3A5EF0D5EDD301C3556F3B3B186DF10B857B58F6A7EB80F20BA5DC7BE1D43D9BF850149FBB3646200",
        "7C438441049E880F842905B8B3181F7AF7CAA9F0EFB743847F44A306D2D28C1D9EC65DF6DB7764B22277A2EDDC3C265A9F018F9CB852E111B768B326904B59A0193776F0949000",
      ],
      ["008600000C7C0A8508C2B0BD78D94BA86600", "7C0A86083ABB9674BCE93C099000"],
    ]);
    await expect(
      performPace(chip, password, info, {
        generatePrivateKey: fixedKeys(
          "7F4EF07B9EA82FD78AD689B38D0BC78CF21F249D953BC46F4C6E19259C010F99",
          "A73FB703AC1436A18E0CFA5ABB3F7BEC7A070E7A6788486BEE230C4A22762595",
        ),
      }),
    ).rejects.toBeInstanceOf(PaceAuthenticationError);
  });

  it("la puce refuse l'authentification (SW 6300, mot de passe faux) → PaceAuthenticationError", async () => {
    const [info] = parsePaceInfos(cardAccess);
    const chip = new ScriptedChip([
      ["0022C1A412800A04007F0007020204020283010184010D", "9000"],
      ["10860000027C0000", "7C12801095A3A016522EE98D01E76CB6B98B42C39000"],
      [
        "10860000457C438141047ACF3EFC982EC45565A4B155129EFBC74650DCBFA6362D896FC70262E0C2CC5E544552DCB6725218799115B55C9BAA6D9F6BC3A9618E70C25AF71777A9C4922D00",
        "7C43824104824FBA91C9CBE26BEF53A0EBE7342A3BF178CEA9F45DE0B70AA601651FBA3F5730D8C879AAA9C9F73991E61B58F4D52EB87A0A0C709A49DC63719363CCD13C549000",
      ],
      [
        "10860000457C438341042DB7A64C0355044EC9DF190514C625CBA2CEA48754887122F3A5EF0D5EDD301C3556F3B3B186DF10B857B58F6A7EB80F20BA5DC7BE1D43D9BF850149FBB3646200",
        "7C438441049E880F842905B8B3181F7AF7CAA9F0EFB743847F44A306D2D28C1D9EC65DF6DB7764B22277A2EDDC3C265A9F018F9CB852E111B768B326904B59A0193776F0949000",
      ],
      ["008600000C7C0A8508C2B0BD78D94BA86600", "6300"],
    ]);
    await expect(
      performPace(chip, password, info, {
        generatePrivateKey: fixedKeys(
          "7F4EF07B9EA82FD78AD689B38D0BC78CF21F249D953BC46F4C6E19259C010F99",
          "A73FB703AC1436A18E0CFA5ABB3F7BEC7A070E7A6788486BEE230C4A22762595",
        ),
      }),
    ).rejects.toBeInstanceOf(PaceAuthenticationError);
  });
});

describe("performPace — traces réelles", () => {
  it("passeport NZ : ECDH-GM 3DES, brainpoolP256r1", async () => {
    const [info] = parsePaceInfos(hex("31143012060a04007f0007020204020102010202010d"));
    expect(info).toMatchObject({ cipher: "3DES", mapping: "GM", parameterId: 13 });
    const chip = new ScriptedChip([
      ["0022C1A412800A04007F0007020204020183010184010D", "9000"],
      ["10860000027c0000", "7c128010b88382812290017af1cc906ff00e7f4d9000"],
      [
        "10860000457c438141047706b2b6246ab4612229b8a11212ddba7fea0568c9c0975dee22c0e3dd3a3f0321e8afee836e373b570d24000d56fb195104d486e63321ff8c819dd5ee018dcb00",
        "7c43824104780b4edec9b926f9f964fad826d9990a667608d96ba7b397ae8609b6533e0d036d148365ddf4e5ff6611c2b62aa17fc9899f327bc929db543e7abd0ee724e4be9000",
      ],
      [
        "10860000457c43834104507a0156efae8fb8acc519036c0b2fe0393c878744c7f91878ee4e07a41412ba5c0753d68a44a91e9f57f3f992ab689e6c2065d3b2a27c3658a4fd632931ee3800",
        "7c438441042dbaf62e6fdfb31eb66f206493b9e7721586f0e5c93754d7bd5a884ca251ee4d720ab539a60561bc46812fa289b58ac69f0c6e32adbaf7241049a31211f80f5b9000",
      ],
      ["008600000c7c0a85088d7c617d43efe09e00", "7c0a8608cb57047c809079f69000"],
    ]);
    const result = await performPace(
      chip,
      { kind: "mrz", accessKey: { documentNumber: "LM277954", dateOfBirth: "781214", dateOfExpiry: "271115" } },
      info,
      {
        generatePrivateKey: fixedKeys(
          "2808272c0ec20e01a3450030ef32855e9feb5cb17719e985389b1cf47609e69f",
          "8f89449052df6c7983750c7b042c3cea12b36819174424c7cd28153f7b70b402",
        ),
      },
    );
    expect(chip.finished).toBe(true);
    expect(toHex(result.smKeys.ksEnc)).toBe("430e4c8c38dfefaed92067b919a897f8");
    expect(toHex(result.smKeys.ksMac)).toBe("c1bc1f075797b970b5a45e64a764b0cb");
    expect(toHex(result.ssc)).toBe("00".repeat(8));
  });

  it("carte d'identité DE : PACE-CAM AES-128 puis lecture protégée (SELECT + READ BINARY)", async () => {
    const infos = parsePaceInfos(hex("31283012060A04007F0007020204020202010202010D3012060A04007F0007020204060202010202010D"));
    expect(infos.map((i) => i.mapping)).toEqual(["GM", "CAM"]);
    expect(selectSupportedPaceInfo(infos)?.mapping).toBe("GM");
    const cam = infos.find((i) => i.mapping === "CAM") as PaceInfo;
    const chip = new ScriptedChip([
      ["0022C1A412800A04007F0007020204060283010184010D", "9000"],
      ["10860000027c0000", "7c1280109bff93e6ed9f5f9764ec0d783d14fb039000"],
      [
        "10860000457c43814104303f340815eea501772393e299a4a6f6694600189c249c63a8513ff3fefa66e346d11970b5f76fb564c3b0e54b215528f647ec5a9ab209cdbe262e763d6119a100",
        "7c4382410476dc295c4fb14237d87318d70967e25ec45f74d6fd4aff588c90efb3d868f05b450ba6b64967227c2246dbe2905522c8086dac7f3bbe5cf3b192f0a0c2d97ee59000",
      ],
      [
        "10860000457c438341048442b191ef5346a6b6dacb6cd5728c4a72f0ca7aecdf7afdfb3ef175e12a6f7c74f509af768b8dbe2cf42d16c1f00714691d78a19cdf1b493390d1173785f2b700",
        "7c438441042315ae8143f21de15b35f083cfa148c5fcbd9f2eb9dcdc4519bcf337443e79e55b28a5e218fb919c30880d263e469645ff114c46ed29918910be3453527d21649000",
      ],
      [
        "008600000c7c0a8508fee088a4d7be1b7f00",
        "7c3c860819a2b9192e11512a8a30b3ae8830311b1d5605777f47cb4ed028346cd00105d32859de127da3d8398865358f26f08ebe410864eaf6e39f33f3f59000",
      ],
    ]);
    const result = await performPace(
      chip,
      { kind: "mrz", accessKey: { documentNumber: "C4KHNY1PF", dateOfBirth: "780214", dateOfExpiry: "330315" } },
      cam,
      {
        generatePrivateKey: fixedKeys(
          "01fd26013f5bc41fad8bb09811e435f16fbe2eb3c2e1d999b0f63da8c3d58bb5",
          "1fcd3d8ac4fae3960a14fea2925d75add335f13b248eba192358dded93a89552",
        ),
      },
    );
    expect(chip.finished).toBe(true);
    expect(toHex(result.smKeys.ksEnc)).toBe("a8e85e938514ec67ae33cda3d43d3c48");
    expect(toHex(result.smKeys.ksMac)).toBe("27f1adeb705a049a305b0c619b14b9b3");

    // Le canal établi par PACE chiffre/authentifie exactement comme la puce réelle.
    const select = wrapCommandApdu({ cla: 0, ins: 0xa4, p1: 0x02, p2: 0x0c, data: hex("011d") }, result.smKeys, result.ssc);
    expect(toHex(select.wrapped)).toBe("0ca4020c1d87110147ee2e3bd440fb596167f2bb6cd6395e8e08a105747484314bcf00");
    expect(unwrapResponseApdu(hex("990290008e085f570baddd1002d29000"), result.smKeys, select.nextSsc).response.sw1).toBe(0x90);
  });
});

describe("parsePaceInfos / selectSupportedPaceInfo", () => {
  it("ignore les variantes non prises en charge (DH, IM, paramètres inconnus) et renvoie undefined si rien d'exploitable", () => {
    // id-PACE-DH-GM-AES-128 (4.1.2) paramètres 0 + id-PACE-ECDH-IM-AES-128 (4.4.2) paramètres 13
    const cardAccess = hex("31283012060A04007F0007020204010202010202010030120" + "60A04007F0007020204040202010202010D");
    const infos = parsePaceInfos(cardAccess);
    expect(infos.map((i) => [i.agreement, i.mapping])).toEqual([
      ["DH", "GM"],
      ["ECDH", "IM"],
    ]);
    expect(selectSupportedPaceInfo(infos)).toBeUndefined();
  });

  it("rejette un EF.CardAccess qui n'est pas un SET ASN.1", () => {
    expect(() => parsePaceInfos(hex("3003020101"))).toThrow();
  });
});

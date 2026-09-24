import { describe, it, expect } from "vitest";
import { establishSecureChannel, readCardAccess } from "../src/nfc/accessControl";
import { PaceAuthenticationError, PaceError } from "../src/nfc/pace";
import { BacAuthenticationError, type ApduTransceiver } from "../src/nfc/bac";

const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

class ScriptedChip implements ApduTransceiver {
  readonly sent: string[] = [];
  private index = 0;
  constructor(private readonly script: [string, string][]) {}
  async transceive(command: Uint8Array): Promise<Uint8Array> {
    this.sent.push(toHex(command));
    const step = this.script[this.index++];
    if (!step) throw new Error(`Commande inattendue : ${toHex(command)}`);
    expect(toHex(command)).toBe(step[0].toLowerCase());
    return hex(step[1]);
  }
}

const SELECT_MF = "00a4000c023f00";
const READ_CARD_ACCESS = "00b09c0000";
const SELECT_EMRTD = "00a4040c07a0000002471001";
const ICAO_CARD_ACCESS = "31143012060A04007F0007020204020202010202010D";
const ICAO_KEY = { documentNumber: "T22000129", dateOfBirth: "640812", dateOfExpiry: "101031" };
const ICAO_PACE: [string, string][] = [
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
];
const icaoKeys = {
  generatePrivateKey: (_d: unknown, step: "mapping" | "agreement") =>
    BigInt(
      "0x" +
        (step === "mapping"
          ? "7F4EF07B9EA82FD78AD689B38D0BC78CF21F249D953BC46F4C6E19259C010F99"
          : "A73FB703AC1436A18E0CFA5ABB3F7BEC7A070E7A6788486BEE230C4A22762595"),
    ),
};

describe("readCardAccess", () => {
  it("sélectionne le MF puis lit EF.CardAccess par SFI", async () => {
    const chip = new ScriptedChip([
      [SELECT_MF, "9000"],
      [READ_CARD_ACCESS, ICAO_CARD_ACCESS + "9000"],
    ]);
    expect(toHex((await readCardAccess(chip))!)).toBe(ICAO_CARD_ACCESS.toLowerCase());
  });

  it("accepte SW 6282 (fin de fichier avant Le)", async () => {
    const chip = new ScriptedChip([
      [SELECT_MF, "6a82"],
      [READ_CARD_ACCESS, ICAO_CARD_ACCESS + "6282"],
    ]);
    expect(await readCardAccess(chip)).toBeDefined();
  });

  it("undefined si la puce n'a pas d'EF.CardAccess (document BAC uniquement)", async () => {
    const chip = new ScriptedChip([
      [SELECT_MF, "9000"],
      [READ_CARD_ACCESS, "6a82"],
    ]);
    expect(await readCardAccess(chip)).toBeUndefined();
  });
});

describe("establishSecureChannel", () => {
  it("PACE quand EF.CardAccess l'annonce (exemple ICAO complet)", async () => {
    const chip = new ScriptedChip([[SELECT_MF, "9000"], [READ_CARD_ACCESS, ICAO_CARD_ACCESS + "9000"], ...ICAO_PACE]);
    const protocols: string[] = [];
    const channel = await establishSecureChannel(chip, ICAO_KEY, { pace: icaoKeys, onProtocol: (p) => protocols.push(p) });
    expect(channel.protocol).toBe("PACE");
    expect(protocols).toEqual(["PACE"]);
    expect(toHex(channel.smKeys.ksEnc)).toBe("f5f0e35c0d7161ee6724ee513a0d9a7f");
  });

  it("BAC (après SELECT de l'application en clair) quand il n'y a pas d'EF.CardAccess", async () => {
    const chip = new ScriptedChip([
      [SELECT_MF, "9000"],
      [READ_CARD_ACCESS, "6a82"],
      [SELECT_EMRTD, "9000"],
      ["0084000008", "6d00"],
    ]);
    await expect(establishSecureChannel(chip, ICAO_KEY)).rejects.toBeInstanceOf(BacAuthenticationError);
    expect(chip.sent).toHaveLength(4);
  });

  it("mot de passe refusé par PACE → PaceAuthenticationError, sans tentative BAC", async () => {
    const script = [[SELECT_MF, "9000"], [READ_CARD_ACCESS, ICAO_CARD_ACCESS + "9000"], ...ICAO_PACE] as [string, string][];
    script[script.length - 1] = [script[script.length - 1][0], "6300"];
    const chip = new ScriptedChip(script);
    await expect(establishSecureChannel(chip, ICAO_KEY, { pace: icaoKeys })).rejects.toBeInstanceOf(PaceAuthenticationError);
    expect(chip.sent).toHaveLength(script.length);
  });

  it("autre échec PACE → repli BAC ; si BAC échoue aussi, l'erreur PACE est remontée", async () => {
    const chip = new ScriptedChip([
      [SELECT_MF, "9000"],
      [READ_CARD_ACCESS, ICAO_CARD_ACCESS + "9000"],
      ["0022C1A412800A04007F0007020204020283010184010D", "6a80"],
      [SELECT_EMRTD, "9000"],
      ["0084000008", "6d00"],
    ]);
    const error = await establishSecureChannel(chip, ICAO_KEY).catch((e) => e);
    expect(error).toBeInstanceOf(PaceError);
    expect(error).not.toBeInstanceOf(PaceAuthenticationError);
    expect(String(error.message)).toMatch(/MSE:Set AT/);
  });
});

import { describe, it, expect } from "vitest";
import { unwrapResponseApdu, wrapCommandApdu, type SecureMessagingKeys } from "../src/nfc/secureMessaging";

const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/**
 * Messagerie sécurisée AES : trace réelle d'une carte d'identité allemande après PACE-CAM
 * AES-128 (reprise des tests de gmrtd, bibliothèque Go de lecture eMRTD — pace/pace_test.go
 * `TestDoPace_CAM_ECDH_DE`) : clés de session et chaque APDU protégée/réponse, octet par octet.
 */
describe("wrapCommandApdu/unwrapResponseApdu — AES (trace réelle, carte DE)", () => {
  const keys: SecureMessagingKeys = {
    ksEnc: hex("a8e85e938514ec67ae33cda3d43d3c48"),
    ksMac: hex("27f1adeb705a049a305b0c619b14b9b3"),
    cipher: "AES",
  };

  it("SELECT EF.CardSecurity puis deux READ BINARY reproduisent exactement la trace", () => {
    let ssc: Uint8Array = new Uint8Array(16);

    const select = wrapCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x02, p2: 0x0c, data: hex("011d") }, keys, ssc);
    expect(toHex(select.wrapped)).toBe("0ca4020c1d87110147ee2e3bd440fb596167f2bb6cd6395e8e08a105747484314bcf00");
    const selectResp = unwrapResponseApdu(hex("990290008e085f570baddd1002d29000"), keys, select.nextSsc);
    expect([selectResp.response.sw1, selectResp.response.sw2]).toEqual([0x90, 0x00]);
    ssc = selectResp.nextSsc;

    const probe = wrapCommandApdu({ cla: 0x00, ins: 0xb0, p1: 0x00, p2: 0x00, le: 4 }, keys, ssc);
    expect(toHex(probe.wrapped)).toBe("0cb000000d9701048e085d283ec183cbb99800");
    const probeResp = unwrapResponseApdu(hex("871101d688d27a6d16f03619e76dcb59c1f1ec990290008e08b7df9a5982bb17299000"), keys, probe.nextSsc);
    expect(probeResp.response.data).toHaveLength(4);
    expect(probeResp.response.data[0]).toBe(0x30); // début d'une SEQUENCE DER (EF.CardSecurity = ContentInfo CMS)
    ssc = probeResp.nextSsc;

    const next = wrapCommandApdu({ cla: 0x00, ins: 0xb0, p1: 0x00, p2: 0x04, le: 0 }, keys, ssc);
    expect(toHex(next.wrapped)).toBe("0cb000040d9701008e08a893fca2cd1cb17d00");
    expect(toHex(next.nextSsc)).toBe("00000000000000000000000000000005");
  });

  it("rejette une réponse AES dont le MAC a été altéré", () => {
    const select = wrapCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x02, p2: 0x0c, data: hex("011d") }, keys, new Uint8Array(16));
    expect(() => unwrapResponseApdu(hex("990290008e085f570baddd1002d39000"), keys, select.nextSsc)).toThrow(/MAC/);
  });
});

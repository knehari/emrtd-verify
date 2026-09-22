/**
 * Construction/analyse d'APDU ISO/IEC 7816-4 (couche transport de la puce eMRTD) — pur byte-
 * packing défini par la norme, indépendant de toute plateforme (Node/React Native) et de tout
 * matériel : testable par construction/analyse structurelle, sans vecteur externe.
 */

export interface CommandApduInput {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  /** Corps de la commande (Lc), absent si aucune donnée n'est envoyée. */
  data?: Uint8Array;
  /**
   * Longueur de réponse attendue (Le). 0 signifie "autant que possible" (256 en forme courte,
   * 65536 en forme étendue — conventions ISO 7816-4) ; absent = aucun Le (case 1/3).
   */
  le?: number;
}

const SHORT_FORM_MAX_LENGTH = 255;
const SHORT_FORM_MAX_LE = 256;
const EXTENDED_FORM_MAX_LE = 65536;

function requiresExtendedForm(data: Uint8Array | undefined, le: number | undefined): boolean {
  const dataTooLong = (data?.length ?? 0) > SHORT_FORM_MAX_LENGTH;
  const leTooLarge = le !== undefined && le !== 0 && le > SHORT_FORM_MAX_LE;
  return dataTooLong || leTooLarge;
}

/**
 * Construit un APDU de commande — bascule automatiquement en forme étendue (préfixe 0x00 devant
 * Lc/Le sur 2 octets) dès que les données ou le Le demandé dépassent la forme courte (255/256) :
 * c'est ce qui permet d'éviter de fragmenter la lecture de DG2 (photo) en dizaines de petits
 * READ BINARY quand la puce annonce le supporter (voir chipReader.ts).
 */
export function buildCommandApdu(input: CommandApduInput): Uint8Array {
  const { cla, ins, p1, p2, data, le } = input;
  for (const [name, value] of [
    ["cla", cla],
    ["ins", ins],
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    if (value < 0 || value > 0xff) {
      throw new Error(`APDU invalide : ${name}=${value} hors plage 0..255`);
    }
  }

  const extended = requiresExtendedForm(data, le);
  const header = Uint8Array.of(cla, ins, p1, p2);
  const parts: Uint8Array[] = [header];

  if (data && data.length > 0) {
    if (extended) {
      parts.push(Uint8Array.of(0x00, (data.length >> 8) & 0xff, data.length & 0xff));
    } else {
      parts.push(Uint8Array.of(data.length));
    }
    parts.push(data);
  }

  if (le !== undefined) {
    if (extended) {
      const maxLe = EXTENDED_FORM_MAX_LE;
      const effectiveLe = le === 0 ? 0 : le % maxLe;
      if (!data || data.length === 0) {
        // Case 2E : pas de Lc, donc le préfixe 0x00 doit être écrit explicitement devant Le.
        parts.push(Uint8Array.of(0x00, (effectiveLe >> 8) & 0xff, effectiveLe & 0xff));
      } else {
        // Case 4E : Lc étendu déjà écrit ci-dessus, Le suit directement sur 2 octets (pas de 0x00).
        parts.push(Uint8Array.of((effectiveLe >> 8) & 0xff, effectiveLe & 0xff));
      }
    } else {
      const effectiveLe = le === 0 ? 0 : le % SHORT_FORM_MAX_LE;
      parts.push(Uint8Array.of(effectiveLe));
    }
  }

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface ResponseApdu {
  data: Uint8Array;
  sw1: number;
  sw2: number;
}

/** Analyse une réponse APDU brute : les 2 derniers octets sont SW1/SW2, le reste est la donnée. */
export function parseResponseApdu(bytes: Uint8Array): ResponseApdu {
  if (bytes.length < 2) {
    throw new Error(`Réponse APDU trop courte pour contenir SW1/SW2 (${bytes.length} octet(s))`);
  }
  return {
    data: bytes.subarray(0, bytes.length - 2),
    sw1: bytes[bytes.length - 2],
    sw2: bytes[bytes.length - 1],
  };
}

/** 0x90 0x00 — seul statut de succès ISO 7816-4 (les autres, même "avertissement", sont traités comme des échecs ici). */
export function isSuccess(response: Pick<ResponseApdu, "sw1" | "sw2">): boolean {
  return response.sw1 === 0x90 && response.sw2 === 0x00;
}

export function formatStatusWord(response: Pick<ResponseApdu, "sw1" | "sw2">): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `${hex(response.sw1)}${hex(response.sw2)}`;
}

import type { DataGroupNumber } from "@emrtd-verify/shared-types";

/** Doc 9303 Part 10 — un groupe de données tel que lu sur la puce, avant interprétation métier. */
export interface RawDataGroup {
  number: DataGroupNumber;
  /** Contenu TLV brut du DG, tel que lu sur la puce (non interprété). */
  bytes: Uint8Array;
}

/** DG1 — MRZ telle que stockée sur la puce (doit être identique à la MRZ imprimée). */
export interface DataGroup1 {
  mrzLines: string[];
}

/** DG2 — image du visage (Doc 9303 Part 10 §6), au format biométrique CBEFF/JPEG ou JPEG2000. */
export interface DataGroup2 {
  imageFormat: "JPEG" | "JPEG2000";
  imageBytes: Uint8Array;
}

/** DG14 — infos de sécurité pour Chip Authentication (Doc 9303 Part 11 §5). */
export interface DataGroup14 {
  chipAuthenticationPublicKeyOid: string;
  chipAuthenticationPublicKey: Uint8Array;
}

/** DG15 — clé publique pour Active Authentication (Doc 9303 Part 11 §6). */
export interface DataGroup15 {
  activeAuthenticationPublicKey: Uint8Array;
}

export interface ParsedDataGroups {
  dg1?: DataGroup1;
  dg2?: DataGroup2;
  dg14?: DataGroup14;
  dg15?: DataGroup15;
  /** Autres DG présents mais non interprétés par cette version (voir docs/roadmap.md). */
  raw: RawDataGroup[];
}

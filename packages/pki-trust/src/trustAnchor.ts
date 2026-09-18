import type { Iso3166Alpha3 } from "@emrtd-verify/shared-types";
import type { TrustLevel, TrustSourceKind } from "@emrtd-verify/shared-types";

/** Provenance d'un CSCA ajouté au magasin de confiance étendu — voir docs/pki-trust-model.md. */
export type ExtendedTrustProvenance =
  | "government-website-tls"
  | "diplomatic-exchange"
  | "document-sample-review"
  | "third-party-attestation";

export interface CscaTrustAnchor {
  countryCode: Iso3166Alpha3;
  /** DER-encoded X.509. */
  certificateDer: Uint8Array;
  subject: string;
  serialNumber: string;
  notBefore: string; // ISO 8601
  notAfter: string; // ISO 8601
  source: TrustSourceKind;
  level: TrustLevel;
  /** Renseigné uniquement pour source === "extended-trust-store". */
  extended?: {
    provenance: ExtendedTrustProvenance;
    addedBy: string;
    addedAt: string; // ISO 8601
    evidenceReference: string;
    reviewBeforeDate: string; // ISO 8601 — passé cette date, dégradation automatique (voir trustStore.ts)
  };
}

export function isCscaValidAt(anchor: CscaTrustAnchor, atIso8601: string): boolean {
  return atIso8601 >= anchor.notBefore && atIso8601 <= anchor.notAfter;
}

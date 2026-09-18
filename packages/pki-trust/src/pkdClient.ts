import type { CscaTrustAnchor } from "./trustAnchor";

/**
 * Client vers l'ICAO Public Key Directory (annuaire LDAP officiel).
 * Alimente le magasin de confiance en CSCA Master Lists, Document Signer Certificates et CRL.
 * Voir docs/pki-trust-model.md et docs/roadmap.md Phase 1 pour l'implémentation du décodage
 * CMS/PKCS#7 des Master Lists (Doc 9303 Part 12 §8).
 */
export interface PkdClient {
  /** Récupère tous les CSCA publiés (CSCA Master List la plus récente). */
  fetchCscaMasterList(): Promise<CscaTrustAnchor[]>;

  /** Récupère la CRL courante pour un pays donné, si publiée. */
  fetchRevocationList(countryCode: string): Promise<RevocationList>;
}

export interface RevocationList {
  countryCode: string;
  issuedAt: string; // ISO 8601
  revokedSerialNumbers: string[];
}

export interface PkdClientConfig {
  ldapUrl: string;
  bindDn?: string;
  bindPassword?: string;
}

export function createIcaoPkdClient(_config: PkdClientConfig): PkdClient {
  return {
    async fetchCscaMasterList() {
      throw new Error(
        "Non implémenté : décodage LDAP + CMS des CSCA Master Lists ICAO PKD. Voir docs/roadmap.md Phase 1.",
      );
    },
    async fetchRevocationList() {
      throw new Error("Non implémenté : récupération de CRL ICAO PKD. Voir docs/roadmap.md Phase 1.");
    },
  };
}

import type { CscaTrustAnchor } from "./trustAnchor";
import type { RevocationList } from "./pkdClient";

/**
 * Interface pour brancher une PKD nationale accessible par échange bilatéral,
 * hors ICAO PKD (voir docs/pki-trust-model.md). Chaque pays partenaire a potentiellement
 * un protocole d'accès différent (API REST, dépôt SFTP signé, etc.) — cette interface
 * abstrait ce détail pour que ChainValidator n'ait pas à en connaître l'implémentation.
 */
export interface NationalPkdAdapter {
  countryCode: string;
  fetchCsca(): Promise<CscaTrustAnchor[]>;
  fetchRevocationList(): Promise<RevocationList | undefined>;
}

export class NationalPkdRegistry {
  private readonly adapters = new Map<string, NationalPkdAdapter>();

  register(adapter: NationalPkdAdapter): void {
    this.adapters.set(adapter.countryCode, adapter);
  }

  get(countryCode: string): NationalPkdAdapter | undefined {
    return this.adapters.get(countryCode);
  }

  has(countryCode: string): boolean {
    return this.adapters.has(countryCode);
  }
}

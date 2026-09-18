import type { CscaTrustAnchor } from "./trustAnchor";

/**
 * Magasin de confiance étendu — pays sans CSCA vérifiable via l'ICAO PKD ni une PKD nationale.
 * Toute entrée doit avoir une provenance tracée et n'obtient jamais le niveau "high" par défaut.
 * Voir docs/pki-trust-model.md pour le processus de revue à deux personnes.
 */
export class ExtendedTrustStore {
  constructor(private anchors: CscaTrustAnchor[]) {
    for (const anchor of anchors) {
      if (anchor.source !== "extended-trust-store") {
        throw new Error(`ExtendedTrustStore ne doit contenir que des ancres "extended-trust-store" (${anchor.countryCode})`);
      }
      if (anchor.level === "high") {
        throw new Error(
          `Un CSCA du magasin de confiance étendu ne peut pas avoir le niveau "high" (${anchor.countryCode}, voir docs/pki-trust-model.md)`,
        );
      }
      if (!anchor.extended) {
        throw new Error(`Métadonnées de provenance manquantes pour ${anchor.countryCode}`);
      }
    }
  }

  /**
   * Retourne les ancres valides pour un pays, en dégradant automatiquement à "low"
   * toute entrée dont la date de revue (reviewBeforeDate) est dépassée.
   */
  findByCountry(countryCode: string, atIso8601: string = new Date().toISOString()): CscaTrustAnchor[] {
    return this.anchors
      .filter((a) => a.countryCode === countryCode)
      .map((a) => {
        if (a.extended && atIso8601 > a.extended.reviewBeforeDate && a.level !== "low") {
          return { ...a, level: "low" as const };
        }
        return a;
      });
  }
}

export function loadExtendedTrustStoreFromJson(json: unknown): ExtendedTrustStore {
  if (!Array.isArray(json)) {
    throw new Error("Le fichier du magasin de confiance étendu doit être un tableau de CscaTrustAnchor");
  }
  return new ExtendedTrustStore(json as CscaTrustAnchor[]);
}

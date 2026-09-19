import ldap, { type SearchOptions } from "ldapjs";

/**
 * Transport pour récupérer la CSCA Master List brute (CMS DER) et les CRL associées — ne fait
 * AUCUNE hypothèse de confiance : un MasterListSource transporte des octets, rien de plus. C'est
 * apps/api's CscaSyncService qui orchestre fetch -> décodage (masterList.ts) -> vérification
 * contre les ancres épinglées -> persistance, avec un point d'observabilité à chaque étape —
 * voir docs/pki-trust-model.md "Synchronisation de la Master List".
 */
export interface MasterListSource {
  fetchMasterList(): Promise<Uint8Array>;
  /** undefined si aucune CRL n'est publiée pour ce pays — ce n'est pas une erreur. */
  fetchRevocationList(countryCode: string): Promise<Uint8Array | undefined>;
}

// ---------------------------------------------------------------------------------------------
// HTTPS — de nombreux opérateurs (PKD nationales, miroirs commerciaux) exposent la Master List
// et les CRL par HTTPS plutôt que par l'annuaire LDAP officiel ; c'est aussi la voie la plus
// simple pour un déploiement qui n'a pas encore d'accès LDAP direct à l'ICAO PKD.
// ---------------------------------------------------------------------------------------------

export interface HttpsMasterListSourceConfig {
  masterListUrl: string;
  /** "{countryCode}" est interpolé, ex. "https://pkd-mirror.example.org/crl/{countryCode}.crl". */
  crlUrlTemplate?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

async function fetchBinary(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Récupération HTTPS échouée (${response.status} ${response.statusText}) pour ${url}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

export function createHttpsMasterListSource(config: HttpsMasterListSourceConfig): MasterListSource {
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    fetchMasterList: () => fetchBinary(config.masterListUrl, timeoutMs, config.headers),
    async fetchRevocationList(countryCode: string) {
      if (!config.crlUrlTemplate) {
        return undefined;
      }
      try {
        return await fetchBinary(config.crlUrlTemplate.replace("{countryCode}", countryCode), timeoutMs, config.headers);
      } catch {
        // Absence de CRL publiée pour ce pays est un cas normal, pas une panne de synchronisation.
        return undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// LDAP — l'annuaire officiel ICAO PKD. La structure exacte du DIT (base DN, filtre, nom de
// l'attribut binaire portant la Master List/les CRL) dépend de l'accès accordé par l'ICAO à
// l'inscription : volontairement configurable plutôt que codée en dur sur une structure supposée.
//
// Note sur ldapjs : ce paquet a été décommissionné par son mainteneur en 2024 (raisons humaines,
// pas un défaut du code — voir github.com/ldapjs/node-ldapjs) ; il reste fonctionnel et largement
// déployé en production, mais ne reçoit plus de correctifs de sécurité. Étant donné qu'aucune
// alternative Node.js activement maintenue n'existe à ce jour pour LDAP, il est utilisé ici avec
// une version épinglée — à réévaluer périodiquement (voir docs/roadmap.md). L'abstraction
// MasterListSource permet de le remplacer sans impact sur le reste du pipeline (ex. par une
// passerelle HTTP dédiée dans un autre langage, comme suggéré par le mainteneur).
// ---------------------------------------------------------------------------------------------

export interface LdapSearchConfig {
  baseDn: string;
  filter: string;
  attribute: string;
}

export interface LdapMasterListSourceConfig {
  url: string;
  bindDn?: string;
  bindPassword?: string;
  connectTimeoutMs?: number;
  masterList: LdapSearchConfig;
  /** "{countryCode}" est interpolé dans `filter` ; omis si les CRL ne sont pas distribuées via LDAP ici. */
  revocationList?: LdapSearchConfig;
}

/** Sous-ensemble de ldap.Client réellement utilisé — permet de tester la logique de recherche avec un client factice, sans dépendre du type complet de ldapjs. */
export interface MinimalLdapClient {
  search(base: string, options: SearchOptions, callback: (err: Error | null, res: ldap.SearchCallbackResponse) => void): void;
}

/**
 * Exécute une recherche LDAP et retourne la première valeur binaire trouvée pour l'attribut
 * demandé. Fonction pure vis-à-vis de la connexion (le client est injecté) — c'est la partie
 * testable sans serveur LDAP réel ; la connexion elle-même (createLdapMasterListSource) ne peut
 * être vérifiée qu'avec de vrais identifiants ICAO PKD.
 */
export function searchSingleBinaryAttribute(
  client: MinimalLdapClient,
  config: LdapSearchConfig,
): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const options: SearchOptions = { scope: "sub", filter: config.filter, attributes: [config.attribute] };

    client.search(config.baseDn, options, (err, res) => {
      if (err) {
        reject(err);
        return;
      }

      let found: Uint8Array | undefined;

      res.on("searchEntry", (entry) => {
        if (found) {
          return;
        }
        const attribute = entry.attributes.find((a) => a.type === config.attribute);
        const buffer = attribute?.buffers?.[0];
        if (buffer) {
          found = new Uint8Array(buffer);
        }
      });
      res.on("error", (searchErr) => reject(searchErr));
      res.on("end", () => resolve(found));
    });
  });
}

export function createLdapMasterListSource(config: LdapMasterListSourceConfig): MasterListSource {
  async function withClient<T>(work: (client: ldap.Client) => Promise<T>): Promise<T> {
    const client = ldap.createClient({ url: config.url, connectTimeout: config.connectTimeoutMs ?? 10_000 });

    try {
      if (config.bindDn) {
        await new Promise<void>((resolve, reject) => {
          client.bind(config.bindDn!, config.bindPassword ?? "", (err) => (err ? reject(err) : resolve()));
        });
      }
      return await work(client);
    } finally {
      client.destroy();
    }
  }

  return {
    async fetchMasterList() {
      const result = await withClient((client) => searchSingleBinaryAttribute(client, config.masterList));
      if (!result) {
        throw new Error(`Aucune Master List trouvée via LDAP (baseDn="${config.masterList.baseDn}")`);
      }
      return result;
    },
    async fetchRevocationList(countryCode: string) {
      if (!config.revocationList) {
        return undefined;
      }
      const searchConfig: LdapSearchConfig = {
        ...config.revocationList,
        filter: config.revocationList.filter.replace("{countryCode}", countryCode),
      };
      return withClient((client) => searchSingleBinaryAttribute(client, searchConfig));
    },
  };
}

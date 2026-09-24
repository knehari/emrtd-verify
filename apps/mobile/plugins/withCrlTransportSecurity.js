// Téléchargement des CRL de CSCA (src/pki/crlCache.ts) : beaucoup de pays ne les publient qu'en
// HTTP (France : http://ants.gouv.fr/csca_crl, Allemagne : http://www.bsi.bund.de/csca_crl…), ce
// qu'App Transport Security bloque par défaut sur iOS. Exception limitée aux hôtes annoncés par les
// CSCA embarqués (src/pki/crlHttpHosts.json, régénéré avec le magasin CSCA par
// apps/api/scripts/build-mobile-default-csca-bundle.ts --crl-hosts-out) : une CRL est signée par
// le CSCA et vérifiée avant usage, HTTP n'en affaiblit pas l'intégrité. Rien d'autre n'est ouvert.
const { withInfoPlist } = require("expo/config-plugins");
const hosts = require("../src/pki/crlHttpHosts.json");

function withCrlTransportSecurity(config) {
  return withInfoPlist(config, (config) => {
    const ats = config.modResults.NSAppTransportSecurity ?? {};
    const exceptions = { ...(ats.NSExceptionDomains ?? {}) };
    for (const host of hosts) {
      exceptions[host] = { ...(exceptions[host] ?? {}), NSExceptionAllowsInsecureHTTPLoads: true };
    }
    config.modResults.NSAppTransportSecurity = { ...ats, NSExceptionDomains: exceptions };
    return config;
  });
}

module.exports = withCrlTransportSecurity;

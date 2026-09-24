/**
 * Génère le bundle CSCA par défaut EMBARQUÉ dans l'app mobile (apps/mobile/src/pki/defaultCscaBundle.json)
 * à partir de sources ICAO PKD obtenues hors bande par l'opérateur — voir apps/mobile/src/pki/cscaBundleSync.ts
 * "ancres par défaut" et docs/pki-trust-model.md "Vérification hors ligne".
 *
 * Ce script ne touche JAMAIS le réseau ni la base de données : c'est un outil de build local, à
 * relancer manuellement quand l'opérateur obtient une Master List ICAO plus récente. Il reproduit
 * EXACTEMENT le modèle de confiance à deux phases déjà implémenté côté serveur
 * (CscaSyncService.sync / syncCountryMasterLists) :
 *
 * - Phase A : la Master List ICAO globale (CMS SignedData) est décodée et son signataire vérifié
 *   contre config/master-list-signer-trust-anchors.json (ancre épinglée hors bande, jamais
 *   auto-bootstrapée) — voir verifyMasterListTrust. Les CSCA qu'elle contient sont acceptés en
 *   confiance "icao-pkd"/"high".
 * - Phase B : chaque Master List NATIONALE (branche LDAP ICAO PKD o=ml,c=XX, typiquement obtenue
 *   via un export LDIF) n'est acceptée QUE si son signataire est relié à une CSCA déjà approuvée
 *   pour CE pays par la Phase A — voir verifyCountryMasterListTrust. Un pays absent de la Master
 *   List globale est ignoré ici, jamais accepté à l'aveugle depuis le LDIF seul.
 * - Phase C : chaque Master List publiée par une autorité nationale hors ICAO PKD (ex. la
 *   GermanMasterList du BSI) suit la même règle que la Phase B — signataire émis par une CSCA déjà
 *   approuvée en Phase A pour son pays — mais tous ses CSCA sont retenus, étrangers compris : c'est
 *   ce qui couvre les pays absents de l'ICAO PKD (Algérie…). Voir le commentaire dans main().
 *
 * Usage (depuis apps/api) :
 *   node -r ts-node/register/transpile-only scripts/build-mobile-default-csca-bundle.ts \
 *     --icao-ml ICAO_ML_<date>.ml [--pkd-ldif icaopkd-002-complete-<n>.ldif] \
 *     [--national-ml DE_ML_<date>.ml] --out ../mobile/src/pki/defaultCscaBundle.json
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
// Repli ECDSA Brainpool (node:crypto) pour les CSCA à courbe explicite qu'un vrai export ICAO PKD
// contient régulièrement — voir apps/api/src/main.ts et packages/pki-trust/src/nodeCryptoFallback.ts.
import "@emrtd-verify/pki-trust/src/nodeCryptoFallback";
import {
  decodeMasterList,
  verifyMasterListTrust,
  verifyCountryMasterListTrust,
  masterListCertificatesToTrustAnchors,
  parsePkdLdifMasterLists,
  verifyRevocationList,
  crlDistributionPointUrls,
  type CscaTrustAnchor,
} from "@emrtd-verify/pki-trust";
import { parseCertificate, certificateCountryCode, certificateSerialNumberHex, certificateValidityIso, distinguishedNameToString, bytesToBase64 } from "@emrtd-verify/emrtd-core";

interface CscaBundleAnchorJson {
  countryCode: string;
  certificateDerBase64: string;
  subject: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  source: "icao-pkd" | "national-pkd";
  level: "high";
}

function loadSignerTrustAnchors(): Uint8Array[] {
  const path = resolve(__dirname, "../../../config/master-list-signer-trust-anchors.json");
  const entries = JSON.parse(readFileSync(path, "utf-8")) as Array<{ certificateDer: string }>;
  return entries.map((entry) => new Uint8Array(Buffer.from(entry.certificateDer, "base64")));
}

function parseCertForAnchor(der: Uint8Array) {
  const cert = parseCertificate(der);
  const { notBefore, notAfter } = certificateValidityIso(cert);
  const rawCountryCode = certificateCountryCode(cert);
  return {
    subject: distinguishedNameToString(cert.subject),
    // Normalisé en majuscules : des CSCA réelles de l'ICAO PKD portent parfois l'attribut C en
    // minuscules (constaté sur ce jeu de données), alors que parsePkdLdifMasterLists() uppercase
    // systématiquement le code pays du DN LDAP — sans cette normalisation, la correspondance
    // Phase A/Phase B (et la recherche par pays côté mobile, toujours en majuscules via la MRZ)
    // manquerait silencieusement des CSCA pourtant présentes.
    countryCode: rawCountryCode?.toUpperCase(),
    serialNumber: certificateSerialNumberHex(cert),
    notBefore,
    notAfter,
  };
}

interface CliArgs {
  icaoMasterList?: string;
  pkdLdif: string[];
  nationalMasterLists: string[];
  output?: string;
  /** Fichiers .crl, dossiers de .crl ou exports LDIF ICAO PKD contenant des CRL. */
  crlSources: string[];
  crlOutput?: string;
  crlHostsOutput?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { pkdLdif: [], nationalMasterLists: [], crlSources: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Valeur manquante pour ${flag}`);
    if (flag === "--icao-ml") args.icaoMasterList = value;
    else if (flag === "--pkd-ldif") args.pkdLdif.push(value);
    else if (flag === "--national-ml") args.nationalMasterLists.push(value);
    else if (flag === "--out") args.output = value;
    else if (flag === "--crl") args.crlSources.push(value);
    else if (flag === "--crl-out") args.crlOutput = value;
    else if (flag === "--crl-hosts-out") args.crlHostsOutput = value;
    else throw new Error(`Option inconnue : ${flag}`);
    i++;
  }
  return args;
}

const USAGE =
  "Usage : build-mobile-default-csca-bundle.ts --icao-ml <master-list-globale.ml> [--pkd-ldif <export.ldif>]... " +
  "[--national-ml <master-list-nationale.ml>]... --out <sortie.json> " +
  "[--crl <fichier.crl|dossier|export.ldif>]... [--crl-out <defaultCrls.json>] [--crl-hosts-out <crlHttpHosts.json>]\n";

/** CRL DER d'un fichier .crl, de tous les .crl d'un dossier, ou des attributs certificateRevocationList d'un LDIF. */
function readCrlSources(source: string): Uint8Array[] {
  if (statSync(source).isDirectory()) {
    return readdirSync(source)
      .filter((name) => name.toLowerCase().endsWith(".crl"))
      .flatMap((name) => readCrlSources(`${source}/${name}`));
  }
  const bytes = readFileSync(source);
  if (!source.toLowerCase().endsWith(".ldif")) return [new Uint8Array(bytes)];
  // LDIF : lignes repliées (continuation = espace initial), valeur binaire en base64 après « :: ».
  const unfolded = bytes.toString("latin1").replace(/\r?\n /g, "");
  return [...unfolded.matchAll(/^certificateRevocationList;binary::\s*([A-Za-z0-9+/=]+)$/gm)].map(
    (m) => new Uint8Array(Buffer.from(m[1], "base64")),
  );
}

function fingerprint(der: Uint8Array): string {
  return createHash("sha256").update(der).digest("hex");
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (!args.icaoMasterList || !args.output) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const signerTrustAnchors = loadSignerTrustAnchors();
  if (signerTrustAnchors.length === 0) {
    throw new Error("config/master-list-signer-trust-anchors.json est vide — voir son README avant de lancer ce script");
  }

  // Phase A : Master List ICAO globale.
  const globalMlDer = new Uint8Array(readFileSync(args.icaoMasterList));
  const decodedGlobal = decodeMasterList(globalMlDer);
  const globalTrust = await verifyMasterListTrust(decodedGlobal, signerTrustAnchors);
  if (!globalTrust.trusted) {
    throw new Error(`Master List ICAO globale non fiable : ${globalTrust.reason}`);
  }
  const phaseAAnchors = masterListCertificatesToTrustAnchors(decodedGlobal.content.certificatesDer, parseCertForAnchor);
  process.stdout.write(
    `Phase A (Master List ICAO globale, signataire "${decodedGlobal.signerCertificate.subject}") : ${phaseAAnchors.length} CSCA extraits.\n`,
  );

  const phaseAByCountry = new Map<string, Uint8Array[]>();
  for (const anchor of phaseAAnchors) {
    const list = phaseAByCountry.get(anchor.countryCode) ?? [];
    list.push(anchor.certificateDer);
    phaseAByCountry.set(anchor.countryCode, list);
  }

  // Phase B : Master Lists nationales de l'ICAO PKD (LDIF), chacune validée contre les CSCA déjà
  // approuvés pour son pays par la Phase A.
  const phaseBAnchors: CscaTrustAnchor[] = [];
  for (const ldifPath of args.pkdLdif) {
    const ldifText = readFileSync(ldifPath, "latin1");
    const nationalEntries = parsePkdLdifMasterLists(ldifText);
    process.stdout.write(`${nationalEntries.length} entrée(s) Master List nationale trouvée(s) dans ${ldifPath}.\n`);

    let validatedCountries = 0;
    let skippedCountries = 0;
    for (const entry of nationalEntries) {
      let decoded;
      try {
        decoded = decodeMasterList(entry.masterListCmsDer);
      } catch (error) {
        process.stdout.write(`  ${entry.countryCode} : ignoré (décodage impossible) : ${String(error)}\n`);
        skippedCountries++;
        continue;
      }

      const alreadyTrusted = phaseAByCountry.get(entry.countryCode) ?? [];
      const trust = await verifyCountryMasterListTrust(decoded, alreadyTrusted);
      if (!trust.trusted) {
        process.stdout.write(`  ${entry.countryCode} : ignoré (${trust.reason})\n`);
        skippedCountries++;
        continue;
      }
      validatedCountries++;

      let addedForCountry = 0;
      for (const certDer of decoded.content.certificatesDer) {
        const parsed = parseCertForAnchor(certDer);
        if (parsed.countryCode !== entry.countryCode) continue; // voir csca-sync.service.ts, même règle
        phaseBAnchors.push({ ...parsed, countryCode: parsed.countryCode, certificateDer: certDer, source: "national-pkd", level: "high" });
        addedForCountry++;
      }
      process.stdout.write(`  ${entry.countryCode} : validé, ${addedForCountry} CSCA supplémentaire(s) exploité(s).\n`);
    }
    process.stdout.write(`Phase B : ${validatedCountries} pays validés, ${skippedCountries} ignorés.\n`);
  }

  // Phase C : Master Lists publiées directement par une autorité nationale (ex. BSI allemand,
  // GermanMasterList.zip). Même règle de confiance que la Phase B — le signataire doit être émis
  // par une CSCA DÉJÀ approuvée en Phase A pour le pays du signataire (attribut C de son sujet),
  // jamais par une CSCA tirée du fichier lui-même. Différence assumée : TOUS les CSCA du fichier
  // sont retenus, y compris étrangers — c'est l'objet même de ces listes (l'autorité émettrice a
  // vérifié chaque CSCA par voie diplomatique avant de le publier), et c'est ce qui comble les pays
  // absents de la Master List ICAO (non-membres du PKD, ex. Algérie).
  const phaseCAnchors: CscaTrustAnchor[] = [];
  for (const mlPath of args.nationalMasterLists) {
    const decoded = decodeMasterList(new Uint8Array(readFileSync(mlPath)));
    const signerCountry = certificateCountryCode(parseCertificate(decoded.signerCertificate.certificateDer))?.toUpperCase();
    if (!signerCountry) throw new Error(`${mlPath} : signataire sans code pays, impossible de le rattacher à une CSCA`);
    const trust = await verifyCountryMasterListTrust(decoded, phaseAByCountry.get(signerCountry) ?? []);
    if (!trust.trusted) {
      throw new Error(`${mlPath} (signataire "${decoded.signerCertificate.subject}") non fiable : ${trust.reason}`);
    }
    const anchors = masterListCertificatesToTrustAnchors(decoded.content.certificatesDer, parseCertForAnchor).map(
      (anchor): CscaTrustAnchor => ({ ...anchor, source: "national-pkd" }),
    );
    phaseCAnchors.push(...anchors);
    const countries = new Set(anchors.map((anchor) => anchor.countryCode));
    process.stdout.write(
      `Phase C (${mlPath}, signataire "${decoded.signerCertificate.subject}", émis par la CSCA ${signerCountry} ` +
        `"${parseCertForAnchor(trust.trustedViaDer!).subject}" de la Phase A) : ${anchors.length} CSCA, ${countries.size} pays.\n`,
    );
  }

  // Fusion, dédoublonnée sur l'empreinte SHA-256 du certificat (deux sources publient souvent le
  // même CSCA ; deux CSCA distincts d'un même pays peuvent en revanche partager un numéro de
  // série) : la première source l'emporte, ICAO avant PKD nationale avant listes nationales.
  const merged = new Map<string, CscaTrustAnchor>();
  const added = { A: 0, B: 0, C: 0 };
  for (const [phase, anchors] of [["A", phaseAAnchors], ["B", phaseBAnchors], ["C", phaseCAnchors]] as const) {
    for (const anchor of anchors) {
      const key = fingerprint(anchor.certificateDer);
      if (merged.has(key)) continue;
      merged.set(key, anchor);
      added[phase]++;
    }
  }
  process.stdout.write(`Apports après dédoublonnage : Phase A ${added.A}, Phase B ${added.B}, Phase C ${added.C}.\n`);

  const output: CscaBundleAnchorJson[] = Array.from(merged.values()).map((anchor) => ({
    countryCode: anchor.countryCode,
    certificateDerBase64: bytesToBase64(anchor.certificateDer),
    subject: anchor.subject,
    serialNumber: anchor.serialNumber,
    notBefore: anchor.notBefore,
    notAfter: anchor.notAfter,
    source: anchor.source as "icao-pkd" | "national-pkd",
    level: "high",
  }));
  output.sort((a, b) =>
    a.countryCode !== b.countryCode
      ? a.countryCode.localeCompare(b.countryCode)
      : a.serialNumber !== b.serialNumber
        ? a.serialNumber.localeCompare(b.serialNumber)
        : a.certificateDerBase64.localeCompare(b.certificateDerBase64),
  );

  writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);
  const countries = new Set(output.map((a) => a.countryCode));
  process.stdout.write(`Écrit ${output.length} ancre(s) CSCA (${countries.size} pays) dans ${args.output}.\n`);

  // CRL embarquées : chacune n'est retenue que si sa signature vérifie sous un CSCA retenu ci-dessus
  // (même règle que sur l'appareil, apps/mobile/src/pki/crlCache.ts), la plus récente par émetteur.
  if (args.crlOutput) {
    const anchors = Array.from(merged.values());
    const bySubject = new Map<string, CscaTrustAnchor[]>();
    for (const anchor of anchors) bySubject.set(anchor.subject, [...(bySubject.get(anchor.subject) ?? []), anchor]);
    const newest = new Map<string, { countryCode: string; derBase64: string; thisUpdate: string }>();
    let rejected = 0;
    for (const der of args.crlSources.flatMap(readCrlSources)) {
      const verified = await verifyRevocationList(der, anchors.map((a) => a.certificateDer));
      const signer = verified && bySubject.get(verified.signerSubject)?.[0];
      if (!verified || !signer) {
        rejected++;
        continue;
      }
      const current = newest.get(verified.signerSubject);
      if (!current || verified.thisUpdate > current.thisUpdate) {
        newest.set(verified.signerSubject, { countryCode: signer.countryCode, derBase64: bytesToBase64(der), thisUpdate: verified.thisUpdate });
      }
    }
    const crls = [...newest.values()]
      .sort((a, b) => a.countryCode.localeCompare(b.countryCode))
      .map(({ countryCode, derBase64 }) => ({ countryCode, derBase64 }));
    writeFileSync(args.crlOutput, `${JSON.stringify(crls, null, 2)}\n`);
    process.stdout.write(`CRL : ${crls.length} retenue(s) (${new Set(crls.map((c) => c.countryCode)).size} pays), ${rejected} rejetée(s) → ${args.crlOutput}.\n`);
  }

  // Hôtes HTTP des points de distribution de CRL : exceptions App Transport Security iOS (plugin
  // apps/mobile/plugins/withCrlTransportSecurity.js). Les CRL sont signées : HTTP n'en affaiblit
  // pas l'intégrité, et ces hôtes ne servent qu'à leur téléchargement.
  if (args.crlHostsOutput) {
    const hosts = new Set<string>();
    for (const anchor of merged.values()) {
      for (const url of crlDistributionPointUrls(anchor.certificateDer)) {
        if (!url.toLowerCase().startsWith("http:")) continue;
        try {
          hosts.add(new URL(url).hostname.toLowerCase());
        } catch {
          process.stdout.write(`  adresse de CRL illisible ignorée : ${url}\n`);
        }
      }
    }
    writeFileSync(args.crlHostsOutput, `${JSON.stringify([...hosts].sort(), null, 2)}\n`);
    process.stdout.write(`${hosts.size} hôte(s) HTTP de CRL → ${args.crlHostsOutput}.\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

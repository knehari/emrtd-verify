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
import { readFileSync, writeFileSync } from "node:fs";
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
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { pkdLdif: [], nationalMasterLists: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Valeur manquante pour ${flag}`);
    if (flag === "--icao-ml") args.icaoMasterList = value;
    else if (flag === "--pkd-ldif") args.pkdLdif.push(value);
    else if (flag === "--national-ml") args.nationalMasterLists.push(value);
    else if (flag === "--out") args.output = value;
    else throw new Error(`Option inconnue : ${flag}`);
    i++;
  }
  return args;
}

const USAGE =
  "Usage : build-mobile-default-csca-bundle.ts --icao-ml <master-list-globale.ml> [--pkd-ldif <export.ldif>]... " +
  "[--national-ml <master-list-nationale.ml>]... --out <sortie.json>\n";

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
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

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
 *
 * Usage :
 *   node -r ts-node/register/transpile-only scripts/build-mobile-default-csca-bundle.ts \
 *     <chemin-vers-master-list-globale.ml> <chemin-vers-export-ldif-national> <chemin-de-sortie.json>
 */
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

async function main(): Promise<void> {
  const [globalMlPath, nationalLdifPath, outputPath] = process.argv.slice(2);
  if (!globalMlPath || !nationalLdifPath || !outputPath) {
    process.stderr.write(
      "Usage : build-mobile-default-csca-bundle.ts <master-list-globale.ml> <export-ldif-national> <sortie.json>\n",
    );
    process.exitCode = 1;
    return;
  }

  const signerTrustAnchors = loadSignerTrustAnchors();
  if (signerTrustAnchors.length === 0) {
    throw new Error("config/master-list-signer-trust-anchors.json est vide — voir son README avant de lancer ce script");
  }

  // Phase A : Master List ICAO globale.
  const globalMlDer = new Uint8Array(readFileSync(globalMlPath));
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

  // Phase B : Master Lists nationales (LDIF), chacune validée contre les CSCA déjà approuvés
  // pour son pays par la Phase A.
  const ldifText = readFileSync(nationalLdifPath, "latin1");
  const nationalEntries = parsePkdLdifMasterLists(ldifText);
  process.stdout.write(`${nationalEntries.length} entrée(s) Master List nationale trouvée(s) dans le LDIF.\n`);

  const phaseBAnchors: CscaTrustAnchor[] = [];
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
      phaseBAnchors.push({
        countryCode: parsed.countryCode,
        certificateDer: certDer,
        subject: parsed.subject,
        serialNumber: parsed.serialNumber,
        notBefore: parsed.notBefore,
        notAfter: parsed.notAfter,
        source: "national-pkd",
        level: "high",
      });
      addedForCountry++;
    }
    process.stdout.write(`  ${entry.countryCode} : validé, ${addedForCountry} CSCA supplémentaire(s) exploité(s).\n`);
  }
  process.stdout.write(`Phase B : ${validatedCountries} pays validés, ${skippedCountries} ignorés.\n`);

  // Fusion (comme CscaSyncService.persistMergedBatch) : une entrée Phase B remplace/complète la
  // Phase A pour la même clé countryCode+serialNumber.
  const merged = new Map<string, CscaTrustAnchor>();
  for (const anchor of phaseAAnchors) merged.set(`${anchor.countryCode}:${anchor.serialNumber}`, anchor);
  for (const anchor of phaseBAnchors) merged.set(`${anchor.countryCode}:${anchor.serialNumber}`, anchor);

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
  output.sort((a, b) => (a.countryCode === b.countryCode ? a.serialNumber.localeCompare(b.serialNumber) : a.countryCode.localeCompare(b.countryCode)));

  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  const countries = new Set(output.map((a) => a.countryCode));
  process.stdout.write(`Écrit ${output.length} ancre(s) CSCA (${countries.size} pays) dans ${outputPath}.\n`);
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

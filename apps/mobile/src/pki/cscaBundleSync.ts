import * as FileSystem from "expo-file-system";
import { verifyJsonPayloadSignatureWithSpki, base64ToBytes, sameCountry } from "@emrtd-verify/emrtd-core";
import type { CscaBundle, CscaBundleAnchor } from "@emrtd-verify/shared-types";
import type { CscaTrustAnchor } from "@emrtd-verify/pki-trust";
import { loadBackendSettings } from "../backend/backendClient";
// Ancres CSCA par défaut, EMBARQUÉES à la compilation (jamais récupérées sur le réseau) — générées
// hors ligne par apps/api/scripts/build-mobile-default-csca-bundle.ts à partir d'une Master List
// ICAO globale (signataire vérifié contre config/master-list-signer-trust-anchors.json) et de
// Master Lists nationales (PKD ICAO, BSI allemand…) dont le signataire doit être émis par une CSCA
// déjà approuvée par la première (voir ce script pour le détail du modèle de confiance). Même
// principe de confiance que appConfig.cscaBundleSigningPublicKeyBase64 ou ce même fichier de config : une donnée compilée dans l'app n'a pas besoin d'être re-signée
// pour être fiable, elle l'est déjà par construction (contrairement à un bundle récupéré au runtime
// via syncCscaBundle(), qui DOIT être signé et vérifié, voir verifyAndPersistBundle ci-dessous).
// Permet à la vérification locale (src/verification/localVerification.ts) d'avoir un magasin de
// confiance non vide dès le premier lancement, avant toute synchronisation backend réussie.
import defaultCscaAnchorsJson from "./defaultCscaBundle.json";

const defaultCscaAnchors = defaultCscaAnchorsJson as CscaBundleAnchor[];

export class CscaBundleSyncError extends Error {}

const BUNDLE_FILE_NAME = "csca-bundle.json";

function bundleFileUri(): string {
  const dir = FileSystem.documentDirectory;
  if (!dir) {
    // N'arrive pas sur iOS/Android réels (toujours défini) — seulement en environnement web non
    // configuré, voir docs Expo FileSystem.
    throw new CscaBundleSyncError("documentDirectory indisponible sur cette plateforme");
  }
  return dir + BUNDLE_FILE_NAME;
}

/**
 * Récupère GET /v1/pki-trust/csca-bundle, vérifie sa signature ECDSA contre la clé épinglée
 * (Réglages › Serveur KYC, après confirmation de son empreinte par l'opérateur — voir
 * backend/backendClient.ts — ou, à défaut, celle compilée dans src/config.ts ; jamais une clé
 * acceptée silencieusement depuis le réseau) et ne persiste localement que si elle est valide —
 * un bundle non signé ou dont la signature ne vérifie pas est rejeté sans toucher au magasin local
 * existant, voir docs/pki-trust-model.md "Vérification hors ligne".
 */
export async function syncCscaBundle(): Promise<CscaBundle> {
  const settings = await loadBackendSettings();
  if (!settings) throw new CscaBundleSyncError("Aucun serveur configuré (Réglages)");
  const response = await fetch(`${settings.apiBaseUrl}/v1/pki-trust/csca-bundle`, {
    headers: { Authorization: `Bearer ${settings.apiKey}` },
  });
  if (!response.ok) {
    throw new CscaBundleSyncError(`Synchronisation du bundle CSCA échouée (HTTP ${response.status})`);
  }
  const bundle = (await response.json()) as CscaBundle;
  await verifyAndPersistBundle(bundle, settings.cscaBundleSigningKeySpkiBase64);
  return bundle;
}

async function verifyAndPersistBundle(bundle: CscaBundle, signingKeySpkiBase64: string | undefined): Promise<void> {
  if (!signingKeySpkiBase64) {
    throw new CscaBundleSyncError(
      "Aucune clé publique de signature du bundle CSCA épinglée (Réglages › Serveur KYC) — synchronisation refusée",
    );
  }
  if (!bundle.signature) {
    throw new CscaBundleSyncError("Bundle CSCA reçu sans signature — rejeté (voir CSCA_BUNDLE_SIGNING_PRIVATE_KEY côté serveur)");
  }

  const { signature, ...bundleWithoutSignature } = bundle;
  // JavaScript pur : Hermes n'a pas Web Crypto (voir emrtd-core jsonSigning.ts).
  const valid = verifyJsonPayloadSignatureWithSpki(bundleWithoutSignature, signature, signingKeySpkiBase64);
  if (!valid) {
    throw new CscaBundleSyncError("Signature du bundle CSCA invalide — rejeté, magasin de confiance local inchangé");
  }

  await FileSystem.writeAsStringAsync(bundleFileUri(), JSON.stringify(bundle));
}

/** Bundle CSCA persisté localement (signature déjà vérifiée lors de la synchronisation) — undefined si aucune synchronisation n'a encore réussi. */
export async function readCachedCscaBundle(): Promise<CscaBundle | undefined> {
  const uri = bundleFileUri();
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    return undefined;
  }
  const content = await FileSystem.readAsStringAsync(uri);
  return JSON.parse(content) as CscaBundle;
}

function toTrustAnchor(anchor: CscaBundleAnchor): CscaTrustAnchor {
  return {
    countryCode: anchor.countryCode,
    certificateDer: base64ToBytes(anchor.certificateDerBase64),
    subject: anchor.subject,
    serialNumber: anchor.serialNumber,
    notBefore: anchor.notBefore,
    notAfter: anchor.notAfter,
    source: anchor.source,
    level: anchor.level,
  };
}

/**
 * Ancres CSCA disponibles localement, décodées (base64 -> Uint8Array), prêtes pour
 * `validateTrustChain` (packages/pki-trust) : fusion des ancres par défaut EMBARQUÉES
 * (`defaultCscaBundle.json`, toujours disponibles, y compris avant toute synchronisation) et de
 * celles du bundle signé éventuellement synchronisé (`syncCscaBundle`), dédupliquées par
 * certificat (le bundle synchronisé l'emporte en cas de doublon — plus susceptible
 * d'être à jour sur une éventuelle révocation). N'est jamais vide en pratique, contrairement à
 * avant l'ajout du bundle par défaut.
 */
export async function getLocalCscaAnchors(countryCode?: string): Promise<CscaTrustAnchor[]> {
  const bundle = await readCachedCscaBundle();
  const syncedAnchors = bundle?.anchors ?? [];

  const merged = new Map<string, CscaBundleAnchor>();
  // Clé = le certificat lui-même : deux CSCA distincts d'un même pays partagent parfois un numéro
  // de série (csca-germany n° 01 de 2011 et de 2013, CN, CH, KZ… dans les Master Lists réelles).
  for (const anchor of defaultCscaAnchors) merged.set(anchor.certificateDerBase64, anchor);
  for (const anchor of syncedAnchors) merged.set(anchor.certificateDerBase64, anchor);

  const anchors = countryCode
    ? Array.from(merged.values()).filter((a) => sameCountry(a.countryCode, countryCode)) // MRZ "FRA" ↔ certificat C=FR
    : Array.from(merged.values());
  return anchors.map(toTrustAnchor);
}

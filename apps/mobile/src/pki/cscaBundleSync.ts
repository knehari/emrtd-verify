import * as FileSystem from "expo-file-system";
import { verifyJsonPayloadSignature, importEcdsaP256PublicKeyFromSpkiBase64, base64ToBytes } from "@emrtd-verify/emrtd-core";
import type { CscaBundle, CscaBundleAnchor } from "@emrtd-verify/shared-types";
import type { CscaTrustAnchor } from "@emrtd-verify/pki-trust";
import { appConfig } from "../config";

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
 * Récupère GET /v1/pki-trust/csca-bundle, vérifie sa signature ECDSA contre la clé embarquée à la
 * compilation (appConfig.cscaBundleSigningPublicKeyBase64 — voir src/config.ts pour pourquoi elle
 * ne doit JAMAIS être récupérée dynamiquement) et ne persiste localement que si elle est valide —
 * un bundle non signé ou dont la signature ne vérifie pas est rejeté sans toucher au magasin local
 * existant, voir docs/pki-trust-model.md "Vérification hors ligne".
 */
export async function syncCscaBundle(): Promise<CscaBundle> {
  const response = await fetch(`${appConfig.apiBaseUrl}/v1/pki-trust/csca-bundle`, {
    headers: { Authorization: `Bearer ${appConfig.apiKey}` },
  });
  if (!response.ok) {
    throw new CscaBundleSyncError(`Synchronisation du bundle CSCA échouée (HTTP ${response.status})`);
  }
  const bundle = (await response.json()) as CscaBundle;
  await verifyAndPersistBundle(bundle);
  return bundle;
}

async function verifyAndPersistBundle(bundle: CscaBundle): Promise<void> {
  if (!appConfig.cscaBundleSigningPublicKeyBase64) {
    throw new CscaBundleSyncError(
      "Aucune clé publique de signature du bundle CSCA configurée (appConfig.cscaBundleSigningPublicKeyBase64) — synchronisation refusée",
    );
  }
  if (!bundle.signature) {
    throw new CscaBundleSyncError("Bundle CSCA reçu sans signature — rejeté (voir CSCA_BUNDLE_SIGNING_PRIVATE_KEY côté serveur)");
  }

  const { signature, ...bundleWithoutSignature } = bundle;
  const publicKey = await importEcdsaP256PublicKeyFromSpkiBase64(appConfig.cscaBundleSigningPublicKeyBase64);
  const valid = await verifyJsonPayloadSignature(bundleWithoutSignature, signature, publicKey);
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
 * Ancres CSCA du bundle en cache, décodées (base64 -> Uint8Array), prêtes pour `validateTrustChain`
 * (packages/pki-trust) — tableau vide si aucun bundle n'a encore été synchronisé avec succès.
 */
export async function getLocalCscaAnchors(countryCode?: string): Promise<CscaTrustAnchor[]> {
  const bundle = await readCachedCscaBundle();
  if (!bundle) {
    return [];
  }
  const anchors = countryCode ? bundle.anchors.filter((a) => a.countryCode === countryCode) : bundle.anchors;
  return anchors.map(toTrustAnchor);
}

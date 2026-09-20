import { generate, generateSecret, generateURI, verify } from "otplib";
import { toDataURL } from "qrcode";

/**
 * 2FA (TOTP, RFC 6238) pour AdminUser/TenantUser — voir docs/admin-web.md et
 * docs/tenant-portal.md "Authentification à deux facteurs". Implémenté via `otplib` (algorithme
 * HMAC-SHA1 standard, comparaison en temps constant) plutôt qu'une réimplémentation maison :
 * contrairement à la dérivation de clé BAC ou au décodage CMS/SOD (packages/emrtd-core,
 * packages/pki-trust), aucune structure de données propriétaire ICAO n'est en jeu ici — TOTP est
 * un protocole standard largement outillé, et une bibliothèque mature réduit le risque sur le
 * contrôle de sécurité lui-même (génération de secret, calcul HMAC, comparaison résistante aux
 * attaques temporelles) par rapport à une implémentation ad hoc non éprouvée.
 */
const ISSUER = "emrtd-verify";

/** Tolérance d'une période (±30s) de part et d'autre de l'horloge serveur — dérive d'horloge côté client usuelle. */
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildTotpOtpauthUrl(accountEmail: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: accountEmail, secret });
}

export async function generateTotpQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return toDataURL(otpauthUrl);
}

export async function generateTotpCode(secret: string): Promise<string> {
  return generate({ secret });
}

export async function verifyTotpCode(code: string, secret: string): Promise<boolean> {
  const result = await verify({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS });
  return result.valid;
}

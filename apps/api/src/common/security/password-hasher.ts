import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Hachage de mot de passe humain (AdminUser/TenantUser) via scrypt (node:crypto) — pas de
 * dépendance native (argon2/bcrypt nécessiteraient une compilation node-gyp, fragile sur les
 * images Alpine du Dockerfile), cohérent avec le reste du projet (KycClientService.hashApiKey,
 * ResultSignerService). Contrairement à un secret API haute entropie, un mot de passe humain
 * PEUT être faible : scrypt est un KDF volontairement coûteux en mémoire (résistant au
 * craquage GPU/ASIC), le choix correct ici — voir OWASP Password Storage Cheat Sheet.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/** Comparaison en temps constant (timingSafeEqual) pour ne jamais fuiter d'information via le timing. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  const derivedKey = (await scryptAsync(password, salt, expectedKey.length)) as Buffer;
  if (derivedKey.length !== expectedKey.length) {
    return false;
  }
  return timingSafeEqual(derivedKey, expectedKey);
}

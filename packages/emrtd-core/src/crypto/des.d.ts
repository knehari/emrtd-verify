/**
 * Déclaration de types minimale pour `des.js` (aucun `@types/des.js` publié) — ne couvre que la
 * surface d'API réellement utilisée par tripleDes.ts/retailMac.ts, vérifiée contre le code source
 * réel du paquet (lib/des/{cipher,des,cbc,ede}.js, des.js@1.1.0) plutôt que devinée.
 */
declare module "des.js" {
  export type DesCipherType = "encrypt" | "decrypt";

  export interface DesCipherOptions {
    type: DesCipherType;
    key: number[] | Uint8Array;
    /** false désactive le padding PKCS implicite — obligatoire ici : le padding ISO/IEC 9797-1
     * méthode 2 est appliqué manuellement en amont (voir retailMac.ts/secureMessaging.ts). */
    padding: false;
  }

  export interface DesCbcCipherOptions extends DesCipherOptions {
    iv: number[] | Uint8Array;
  }

  export interface DesCipherInstance {
    update(data: number[] | Uint8Array): number[];
    final(): number[];
  }

  export const DES: {
    create(options: DesCipherOptions): DesCipherInstance;
  };

  export const EDE: {
    /** Clé de 24 octets (K1||K2||K3) — un 3DES à 2 clés (Doc 9303) doit être étendu en K1||K2||K1. */
    create(options: DesCipherOptions): DesCipherInstance;
  };

  export const CBC: {
    instantiate(base: typeof DES | typeof EDE): {
      create(options: DesCbcCipherOptions): DesCipherInstance;
    };
  };
}

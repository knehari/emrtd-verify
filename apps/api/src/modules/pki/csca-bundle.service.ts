import { Injectable } from "@nestjs/common";
import type { CscaBundle, CscaBundleAnchor } from "@emrtd-verify/shared-types";
import { CscaStoreService } from "./csca-store.service";
import { CscaBundleSignerService } from "./csca-bundle-signer.service";

/**
 * Construit le `CscaBundle` signé distribué au mobile pour la vérification hors ligne — voir
 * docs/pki-trust-model.md "Vérification hors ligne" et packages/shared-types/src/cscaBundle.ts.
 * Lecture pure (CscaStoreService) + signature (CscaBundleSignerService), jamais de réseau ici :
 * ce service ne fait que refléter l'état déjà synchronisé par CscaSyncService.
 */
@Injectable()
export class CscaBundleService {
  constructor(
    private readonly cscaStore: CscaStoreService,
    private readonly bundleSigner: CscaBundleSignerService,
  ) {}

  /** `undefined` si aucune synchronisation Master List n'a encore réussi (pas de lot actif à distribuer). */
  async buildBundle(): Promise<CscaBundle | undefined> {
    const batchId = await this.cscaStore.getActiveBatchId();
    if (!batchId) {
      return undefined;
    }

    const anchors = await this.cscaStore.getAllAnchors();
    const bundleWithoutSignature: Omit<CscaBundle, "signature"> = {
      bundleFormatVersion: 1,
      batchId,
      generatedAt: new Date().toISOString(),
      anchors: anchors.map(toBundleAnchor),
      algorithm: "ECDSA-P256-SHA256",
    };

    const signature = await this.bundleSigner.sign(bundleWithoutSignature);
    return { ...bundleWithoutSignature, signature };
  }
}

function toBundleAnchor(anchor: {
  countryCode: string;
  certificateDer: Uint8Array;
  subject: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  source: CscaBundleAnchor["source"];
  level: CscaBundleAnchor["level"];
}): CscaBundleAnchor {
  return {
    countryCode: anchor.countryCode,
    certificateDerBase64: Buffer.from(anchor.certificateDer).toString("base64"),
    subject: anchor.subject,
    serialNumber: anchor.serialNumber,
    notBefore: anchor.notBefore,
    notAfter: anchor.notAfter,
    source: anchor.source,
    level: anchor.level,
  };
}

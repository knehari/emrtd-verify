/**
 * Interrogation d'un registre de statut de documents d'identité perdus/volés — bonne pratique
 * ENISA la plus citée après la lecture NFC (voir "Remote ID Proofing Good Practices", nov. 2024,
 * et docs/pvid-compliance.md). C'est un mécanisme DISTINCT de la révocation CSCA/DSC (crl.ts) :
 * une CRL révoque un CERTIFICAT (compromission/erreur d'émission), un registre perdu/volé
 * signale un DOCUMENT PHYSIQUE (déclaration du titulaire/de l'autorité émettrice) — un document
 * parfaitement valide cryptographiquement peut très bien avoir été volé.
 *
 * Suit le même principe que MasterListSource (packages/pki-trust/src/pkdClient.ts) : ce module
 * transporte un statut, sans aucune hypothèse de confiance/décision — c'est
 * AnomalyDetectionService qui interprète le résultat.
 */

export interface LostStolenCheckResult {
  /**
   * false si le statut n'a pas pu être vérifié (registre non configuré, indisponible, ou
   * timeout) — ne JAMAIS interpréter comme "non signalé" (voir
   * AnomalyDetectionService.LOST_STOLEN_STATUS_NOT_CHECKED, qui dégrade le verdict plutôt que de
   * traiter le silence comme une absence de signalement, même principe que REVOCATION_NOT_CHECKED).
   */
  checked: boolean;
  /** N'a de sens que si checked === true. */
  reported: boolean;
}

export interface LostStolenDocumentRegistry {
  checkStatus(input: { issuingState: string; documentNumber: string }): Promise<LostStolenCheckResult>;
}

/**
 * Comportement par défaut, honnête, tant qu'aucun registre n'est configuré : aucune plateforme
 * de vérification d'identité à distance n'a un accès direct par défaut à un registre comme
 * INTERPOL SLTD (Stolen and Lost Travel Documents) — cet accès nécessite un enregistrement/accord
 * spécifique (programme I-Checkit ou accès national), pas seulement une URL à configurer. `checked:
 * false` déclenche systématiquement l'avertissement explicite côté AnomalyDetectionService plutôt
 * que de faire silencieusement comme si le document n'était pas signalé.
 */
export const notConfiguredLostStolenRegistry: LostStolenDocumentRegistry = {
  async checkStatus(): Promise<LostStolenCheckResult> {
    return { checked: false, reported: false };
  },
};

export interface HttpsLostStolenRegistryConfig {
  /**
   * "{issuingState}"/"{documentNumber}" interpolés, ex.
   * "https://registry.example.org/v1/status?country={issuingState}&document={documentNumber}".
   *
   * AVERTISSEMENT : ce client HTTP est générique (requête GET authentifiée par Bearer token,
   * réponse JSON `{ "reported": boolean }`) — il n'a été vérifié contre AUCUN registre réel
   * (ex. INTERPOL SLTD, dont le contrat d'API exact n'est pas public et nécessite un accès
   * négocié). Le contrat exact (méthode, forme de la réponse, authentification) devra être
   * adapté au registre effectivement choisi avant tout déploiement — voir docs/pvid-compliance.md.
   */
  checkUrlTemplate: string;
  apiKey?: string;
  timeoutMs?: number;
}

export function createHttpsLostStolenRegistry(config: HttpsLostStolenRegistryConfig): LostStolenDocumentRegistry {
  const timeoutMs = config.timeoutMs ?? 5000;

  return {
    async checkStatus({ issuingState, documentNumber }): Promise<LostStolenCheckResult> {
      const url = config.checkUrlTemplate
        .replace("{issuingState}", encodeURIComponent(issuingState))
        .replace("{documentNumber}", encodeURIComponent(documentNumber));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
          signal: controller.signal,
        });
        if (!response.ok) {
          // Panne/erreur du registre externe : jamais interprétée comme "non signalé".
          return { checked: false, reported: false };
        }
        const body = (await response.json()) as { reported: unknown };
        return { checked: true, reported: body.reported === true };
      } catch {
        // Timeout, DNS, réseau : même principe — un échec de vérification n'est pas une
        // vérification négative.
        return { checked: false, reported: false };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

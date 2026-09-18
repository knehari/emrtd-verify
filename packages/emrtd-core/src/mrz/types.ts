import type { DocumentFormat, DocumentIdentity } from "@emrtd-verify/shared-types";

export interface MrzFieldValidation {
  documentNumberValid: boolean;
  dateOfBirthValid: boolean;
  dateOfExpiryValid: boolean;
  compositeValid: boolean;
  /** TD3 uniquement — les documents TD1/TD2 n'ont pas de chiffre de contrôle sur la nationalité. */
  personalNumberValid?: boolean;
}

export interface ParsedMrz {
  format: DocumentFormat;
  identity: DocumentIdentity;
  rawLines: string[];
  validation: MrzFieldValidation;
}

export class MrzParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MrzParseError";
  }
}

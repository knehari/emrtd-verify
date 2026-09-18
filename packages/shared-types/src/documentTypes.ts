/** ICAO Doc 9303 — formats de document et types de document couverts. */

export type DocumentFormat = "TD1" | "TD2" | "TD3";

export type DocumentType = "eID" | "ePassport" | "eResidenceCard";

/** ISO 3166-1 alpha-3, tel qu'utilisé dans la MRZ (Doc 9303 Part 3 §5). */
export type Iso3166Alpha3 = string;

export interface DocumentIdentity {
  documentType: DocumentType;
  documentFormat: DocumentFormat;
  documentNumber: string;
  issuingState: Iso3166Alpha3;
  nationality: Iso3166Alpha3;
  dateOfBirth: string; // ISO 8601 (YYYY-MM-DD)
  dateOfExpiry: string; // ISO 8601 (YYYY-MM-DD)
  dateOfIssue?: string; // ISO 8601 (YYYY-MM-DD), pas toujours présent en MRZ
  sex: "M" | "F" | "X" | "unspecified";
  primaryIdentifier: string;
  secondaryIdentifier?: string;
}

/** Doc 9303 Part 10 — groupes de données présents dans la LDS. */
export type DataGroupNumber =
  | 1 // MRZ
  | 2 // Photo du visage
  | 3 // Empreintes digitales (EAC)
  | 4 // Iris (EAC)
  | 5
  | 6
  | 7 // Image de signature
  | 8
  | 9
  | 10
  | 11 // Détails personnels additionnels
  | 12 // Détails du document additionnels
  | 13
  | 14 // Infos de sécurité (Chip Authentication)
  | 15 // Clé publique Active Authentication
  | 16;

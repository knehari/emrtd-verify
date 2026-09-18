import type { DocumentType } from "@emrtd-verify/shared-types";
import { verifyCheckDigit, computeCompositeCheckDigitTD3 } from "./checkDigit";
import { MrzParseError, type ParsedMrz } from "./types";

function mrzDateToIso(mrzDate: string): string {
  // YYMMDD — Doc 9303 ne code pas le siècle ; convention usuelle : YY >= 50 -> 19xx, sinon 20xx.
  // Le siècle réel doit être confirmé par ailleurs (ex. date d'émission connue) quand l'ambiguïté compte.
  const yy = Number(mrzDate.slice(0, 2));
  const mm = mrzDate.slice(2, 4);
  const dd = mrzDate.slice(4, 6);
  const century = yy >= 50 ? 1900 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

function stripFiller(field: string): string {
  return field.replace(/</g, " ").trim();
}

/**
 * Parse une MRZ TD3 (passeport, 2 lignes de 44 caractères — Doc 9303 Part 4 §4.2).
 */
export function parseMrzTd3(line1: string, line2: string, documentType: DocumentType = "ePassport"): ParsedMrz {
  if (line1.length !== 44 || line2.length !== 44) {
    throw new MrzParseError("MRZ TD3 invalide : chaque ligne doit faire 44 caractères");
  }

  const documentCode = line1.slice(0, 2);
  const issuingState = line1.slice(2, 5);
  const nameField = line1.slice(5, 44);

  const documentNumberField = line2.slice(0, 9);
  const documentNumberCheck = line2[9];
  const nationality = line2.slice(10, 13);
  const dateOfBirthField = line2.slice(13, 19);
  const dateOfBirthCheck = line2[19];
  const sexChar = line2[20];
  const dateOfExpiryField = line2.slice(21, 27);
  const dateOfExpiryCheck = line2[27];
  const optionalDataField = line2.slice(28, 42);
  const optionalDataCheck = line2[42];
  const compositeCheck = line2[43];

  const [primary, secondary = ""] = nameField.split("<<").map(stripFiller);

  const documentNumberValid = verifyCheckDigit(documentNumberField, documentNumberCheck);
  const dateOfBirthValid = verifyCheckDigit(dateOfBirthField, dateOfBirthCheck);
  const dateOfExpiryValid = verifyCheckDigit(dateOfExpiryField, dateOfExpiryCheck);
  const personalNumberValid = verifyCheckDigit(optionalDataField, optionalDataCheck);

  const expectedComposite = computeCompositeCheckDigitTD3({
    documentNumberField: documentNumberField + documentNumberCheck,
    dateOfBirthField: dateOfBirthField + dateOfBirthCheck,
    dateOfExpiryField: dateOfExpiryField + dateOfExpiryCheck,
    optionalDataField: optionalDataField + optionalDataCheck,
  });
  const compositeValid =
    compositeCheck === String(expectedComposite) || (compositeCheck === "<" && expectedComposite === 0);

  return {
    format: "TD3",
    rawLines: [line1, line2],
    identity: {
      documentType,
      documentFormat: "TD3",
      documentNumber: documentNumberField.replace(/</g, ""),
      issuingState,
      nationality,
      dateOfBirth: mrzDateToIso(dateOfBirthField),
      dateOfExpiry: mrzDateToIso(dateOfExpiryField),
      sex: sexChar === "M" ? "M" : sexChar === "F" ? "F" : sexChar === "<" ? "unspecified" : "X",
      primaryIdentifier: primary,
      secondaryIdentifier: secondary || undefined,
    },
    validation: {
      documentNumberValid,
      dateOfBirthValid,
      dateOfExpiryValid,
      compositeValid,
      personalNumberValid,
    },
  };
}

/**
 * Parse une MRZ TD1 (carte format ID-1 — eID, eResidence — 3 lignes de 30 caractères,
 * Doc 9303 Part 5 §4.2). La ligne 3 porte les noms ; les chiffres de contrôle
 * sont répartis différemment de TD3.
 */
export function parseMrzTd1(
  line1: string,
  line2: string,
  line3: string,
  documentType: DocumentType = "eID",
): ParsedMrz {
  if (line1.length !== 30 || line2.length !== 30 || line3.length !== 30) {
    throw new MrzParseError("MRZ TD1 invalide : chaque ligne doit faire 30 caractères");
  }

  const issuingState = line1.slice(2, 5);
  const documentNumberField = line1.slice(5, 14);
  const documentNumberCheck = line1[14];
  const optionalDataField1 = line1.slice(15, 30);

  const dateOfBirthField = line2.slice(0, 6);
  const dateOfBirthCheck = line2[6];
  const sexChar = line2[7];
  const dateOfExpiryField = line2.slice(8, 14);
  const dateOfExpiryCheck = line2[14];
  const nationality = line2.slice(15, 18);
  const optionalDataField2 = line2.slice(18, 29);
  const compositeCheck = line2[29];

  const [primary, secondary = ""] = line3.split("<<").map(stripFiller);

  const composite =
    documentNumberField +
    documentNumberCheck +
    optionalDataField1 +
    dateOfBirthField +
    dateOfBirthCheck +
    dateOfExpiryField +
    dateOfExpiryCheck +
    optionalDataField2;

  return {
    format: "TD1",
    rawLines: [line1, line2, line3],
    identity: {
      documentType,
      documentFormat: "TD1",
      documentNumber: documentNumberField.replace(/</g, ""),
      issuingState,
      nationality,
      dateOfBirth: mrzDateToIso(dateOfBirthField),
      dateOfExpiry: mrzDateToIso(dateOfExpiryField),
      sex: sexChar === "M" ? "M" : sexChar === "F" ? "F" : sexChar === "<" ? "unspecified" : "X",
      primaryIdentifier: primary,
      secondaryIdentifier: secondary || undefined,
    },
    validation: {
      documentNumberValid: verifyCheckDigit(documentNumberField, documentNumberCheck),
      dateOfBirthValid: verifyCheckDigit(dateOfBirthField, dateOfBirthCheck),
      dateOfExpiryValid: verifyCheckDigit(dateOfExpiryField, dateOfExpiryCheck),
      compositeValid: verifyCheckDigit(composite, compositeCheck),
    },
  };
}

/**
 * Chiffre de contrôle MRZ — ICAO Doc 9303 Part 3 §4.9.
 * Poids répétés 7-3-1 sur chaque caractère ; chiffre = sa valeur, lettre = position alphabétique
 * + 9 (A=10 ... Z=35), '<' = 0. Somme pondérée mod 10.
 */

const WEIGHTS = [7, 3, 1];

function charValue(char: string): number {
  if (char >= "0" && char <= "9") {
    return char.charCodeAt(0) - "0".charCodeAt(0);
  }
  if (char >= "A" && char <= "Z") {
    return char.charCodeAt(0) - "A".charCodeAt(0) + 10;
  }
  if (char === "<") {
    return 0;
  }
  throw new Error(`Caractère MRZ invalide pour le calcul du chiffre de contrôle: "${char}"`);
}

export function computeCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    sum += charValue(field[i]) * WEIGHTS[i % 3];
  }
  return sum % 10;
}

export function verifyCheckDigit(field: string, expectedDigit: string): boolean {
  if (expectedDigit === "<") {
    // Certains émetteurs utilisent '<' pour un chiffre de contrôle non renseigné (champ optionnel vide).
    return field.replace(/</g, "").length === 0;
  }
  if (!/^[0-9]$/.test(expectedDigit)) {
    return false;
  }
  return computeCheckDigit(field) === Number(expectedDigit);
}

/**
 * Chiffre de contrôle composite TD3 (Doc 9303 Part 4 §4.2.2) :
 * numéro de document + son chiffre, date de naissance + son chiffre,
 * date d'expiration + son chiffre, champ optionnel + son chiffre.
 */
export function computeCompositeCheckDigitTD3(fields: {
  documentNumberField: string; // 9 caractères + 1 chiffre de contrôle
  dateOfBirthField: string; // 6 caractères + 1 chiffre de contrôle
  dateOfExpiryField: string; // 6 caractères + 1 chiffre de contrôle
  optionalDataField: string; // 14 caractères + 1 chiffre de contrôle (peut être vide/bourré de '<')
}): number {
  const composite =
    fields.documentNumberField + fields.dateOfBirthField + fields.dateOfExpiryField + fields.optionalDataField;
  return computeCheckDigit(composite);
}

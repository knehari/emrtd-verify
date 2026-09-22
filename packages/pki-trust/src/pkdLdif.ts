/**
 * Parseur LDIF (RFC 2849) minimal, scopé aux besoins de l'ingestion PKD : extrait uniquement les
 * entrées `pkdMasterList` (Master Lists nationales, branche LDAP ICAO PKD `o=ml,c=XX`) d'un export
 * complet — ce format est ce que produit un export/synchronisation LDAP complet de l'annuaire ICAO
 * PKD, et c'est la voie réaliste pour ingérer en masse les Master Lists de nombreux pays sans faire
 * des milliers de requêtes LDAP live (voir docs/pki-trust-model.md "Ingestion LDIF").
 *
 * Validé contre un vrai export LDIF ICAO PKD (28 pays, tous décodés et vérifiés avec succès) —
 * voir packages/pki-trust/test/pkdLdif.test.ts pour la couverture avec des données synthétiques
 * (aucune donnée ICAO PKD réelle n'est committée dans ce dépôt).
 */
import { base64ToBytes } from "@emrtd-verify/emrtd-core";

export interface PkdLdifMasterListEntry {
  /** DN complet de l'entrée LDAP (utile pour le diagnostic/l'audit). */
  dn: string;
  /** Code pays ISO 3166-1 alpha-2 extrait du DN (attribut `c=XX`). */
  countryCode: string;
  /** CMS SignedData (ContentInfo) brut, tel que porté par l'attribut `pkdMasterListContent;binary`. */
  masterListCmsDer: Uint8Array;
}

const PKD_MASTER_LIST_CONTENT_ATTRIBUTE = "pkdMasterListContent";
const COUNTRY_CODE_PATTERN = /(?:^|,)c=([A-Za-z]{2})(?:,|$)/;

interface RawLdifEntry {
  dn: string;
  attributes: Map<string, string[]>;
}

/**
 * Défait le "line folding" LDIF (RFC 2849 §2) : une ligne de continuation commence par exactement
 * un espace et doit être concaténée à la ligne précédente sans ce préfixe.
 */
function unfoldLines(ldifText: string): string[] {
  const lines = ldifText.split(/\r?\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if (line.startsWith(" ") && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function parseEntries(ldifText: string): RawLdifEntry[] {
  const entries: RawLdifEntry[] = [];
  let current: RawLdifEntry | null = null;

  for (const line of unfoldLines(ldifText)) {
    if (line === "") {
      if (current) entries.push(current);
      current = null;
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex);
    let value = line.slice(separatorIndex + 1);
    if (value.startsWith(":")) {
      value = value.slice(1); // valeur base64 (RFC 2849 "::") — décodée par l'appelant selon l'attribut
    }
    value = value.trim();

    if (key === "dn") {
      if (current) entries.push(current);
      current = { dn: value, attributes: new Map() };
      continue;
    }
    if (!current) continue;

    const attributeName = key.replace(/;binary$/, "");
    const values = current.attributes.get(attributeName) ?? [];
    values.push(value);
    current.attributes.set(attributeName, values);
  }
  if (current) entries.push(current);

  return entries;
}

/**
 * Extrait toutes les entrées Master List nationale (`pkdMasterListContent` non vide) d'un export
 * LDIF ICAO PKD. Ignore silencieusement toute entrée structurelle (pays, organisation, domaine)
 * qui n'en porte pas — ce n'est pas une erreur, la majorité des entrées d'un export complet sont
 * structurelles. Une entrée AVEC contenu mais sans code pays exploitable dans son DN est en
 * revanche une anomalie de données et lève une erreur plutôt que d'être silencieusement ignorée.
 */
export function parsePkdLdifMasterLists(ldifText: string): PkdLdifMasterListEntry[] {
  const entries: PkdLdifMasterListEntry[] = [];

  for (const rawEntry of parseEntries(ldifText)) {
    const contentValues = rawEntry.attributes.get(PKD_MASTER_LIST_CONTENT_ATTRIBUTE);
    if (!contentValues || contentValues.length === 0) continue;

    const countryMatch = rawEntry.dn.match(COUNTRY_CODE_PATTERN);
    if (!countryMatch) {
      throw new Error(`Entrée LDIF pkdMasterList sans code pays exploitable dans le DN : ${rawEntry.dn}`);
    }

    entries.push({
      dn: rawEntry.dn,
      countryCode: countryMatch[1].toUpperCase(),
      masterListCmsDer: base64ToBytes(contentValues[0]),
    });
  }

  return entries;
}

import { describe, it, expect } from "vitest";
import { parsePkdLdifMasterLists } from "../src/pkdLdif";

// Structure représentative d'un export LDIF ICAO PKD (voir docs/pki-trust-model.md "Ingestion
// LDIF") — synthétique, aucune donnée réelle. Le contenu base64 est du texte arbitraire ("test
// content") : ce test vérifie uniquement l'extraction LDIF (DN, code pays, décodage base64), pas
// le décodage CMS (couvert par masterList.test.ts).
const SAMPLE_LDIF = `version: 1

dn: dc=data,dc=download,dc=pkd,dc=icao,dc=int
dc: data
objectclass: top
objectclass: domain

dn: c=FR,dc=data,dc=download,dc=pkd,dc=icao,dc=int
c: FR
objectclass: country
objectclass: top

dn: o=ml,c=FR,dc=data,dc=download,dc=pkd,dc=icao,dc=int
o: ml
objectclass: organization
objectclass: top

dn: cn=CN=CSCA-FRANCE,O=Gouv,C=FR,o=ml,c=FR,dc=data,dc=download,dc=pkd,dc=icao,dc=int
sn: 1
cn: CN=CSCA-FRANCE,O=Gouv,C=FR
pkdVersion: 522
objectclass: pkdDownload
objectclass: top
objectclass: pkdMasterList
objectclass: person
pkdMasterListContent;binary:: dGVzdCBjb250ZW50IEZS

dn: o=ml,c=DE,dc=data,dc=download,dc=pkd,dc=icao,dc=int
o: ml
objectclass: organization
objectclass: top

dn: cn=csca-germany,o=ml,c=DE,dc=data,dc=download,dc=pkd,dc=icao,dc=int
sn: 1
cn: csca-germany
pkdVersion: 522
objectclass: pkdDownload
objectclass: top
objectclass: pkdMasterList
objectclass: person
pkdMasterListContent;binary:: dGVzdCBjb250ZW50IERF
`;

describe("parsePkdLdifMasterLists", () => {
  it("extrait chaque entrée pkdMasterList avec son code pays et son contenu décodé", () => {
    const entries = parsePkdLdifMasterLists(SAMPLE_LDIF);

    expect(entries).toHaveLength(2);
    expect(entries[0].countryCode).toBe("FR");
    expect(new TextDecoder().decode(entries[0].masterListCmsDer)).toBe("test content FR");
    expect(entries[1].countryCode).toBe("DE");
    expect(new TextDecoder().decode(entries[1].masterListCmsDer)).toBe("test content DE");
  });

  it("ignore silencieusement les entrées structurelles sans contenu Master List", () => {
    const onlyStructural = `dn: dc=data,dc=download,dc=pkd,dc=icao,dc=int
dc: data
objectclass: top
objectclass: domain

dn: c=FR,dc=data,dc=download,dc=pkd,dc=icao,dc=int
c: FR
objectclass: country
`;
    expect(parsePkdLdifMasterLists(onlyStructural)).toEqual([]);
  });

  it("défait correctement le repliement de ligne LDIF (une valeur base64 étalée sur plusieurs lignes)", () => {
    const folded = `dn: cn=CN=CSCA-TEST,O=Gouv,C=ZZ,o=ml,c=ZZ,dc=data,dc=download,dc=pkd,dc=icao,dc
 =int
objectclass: pkdMasterList
pkdMasterListContent;binary:: dGVz
 dCBjb250ZW50IFpa
`;
    const entries = parsePkdLdifMasterLists(folded);
    expect(entries).toHaveLength(1);
    expect(entries[0].countryCode).toBe("ZZ");
    expect(new TextDecoder().decode(entries[0].masterListCmsDer)).toBe("test content ZZ");
  });

  it("lève une erreur explicite pour une entrée avec contenu mais sans code pays exploitable", () => {
    const noCsountry = `dn: cn=orphelin,o=ml,dc=data,dc=download,dc=pkd,dc=icao,dc=int
pkdMasterListContent;binary:: dGVzdA==
`;
    expect(() => parsePkdLdifMasterLists(noCsountry)).toThrow(/code pays/);
  });
});

# config/master-list-signer-trust-anchors.json

Ancres de confiance pour la vérification de la CSCA Master List ICAO PKD (voir `packages/pki-trust/src/masterList.ts` et [`docs/pki-trust-model.md`](../docs/pki-trust-model.md) "Bootstrap de confiance de la Master List").

**Ce fichier ne doit jamais être alimenté automatiquement.** Le certificat du Master List Signer doit être obtenu par un canal sécurisé distinct de celui utilisé pour récupérer la Master List elle-même (ex. remis en main propre lors de l'inscription à l'ICAO PKD, publié sur un site officiel avec empreinte vérifiée indépendamment, ou fourni par l'autorité PKD nationale). L'extraire du fichier téléchargé et l'auto-approuver annulerait toute la protection : un attaquant contrôlant le canal de téléchargement fournirait alors sa propre Master List avec son propre certificat "signataire" embarqué.

## Format

```json
[
  {
    "certificateDer": "<base64 du certificat X.509 DER>",
    "subject": "CN=...,O=ICAO,C=UN",
    "addedBy": "<nom de la personne ayant ajouté cette entrée>",
    "addedAt": "2026-01-01T00:00:00.000Z",
    "evidenceReference": "<référence vers la preuve d'obtention hors bande>"
  }
]
```

## Processus

Même discipline que `config/extended-trust-store.json` : revue à deux personnes avant tout ajout ou modification, provenance tracée, jamais de commit direct sans revue.

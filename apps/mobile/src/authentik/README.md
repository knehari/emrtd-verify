# Authentik — UI (premier PoC)

Implémentation React Native de l'UX "Authentik" livrée par Claude Design, transcrite depuis le
handoff `design_handoff_authentik/` (fourni par l'utilisateur, non versionné dans ce dépôt — voir
son propre `README.md` pour la spécification complète : machine à états, tokens de design, copie
FR/EN, décisions de design à ne pas défaire).

## Ce qui est fait

- Les 12 écrans du parcours (`screens/`), la barre d'onglets flottante et la modale de partage
  (`components/`), fidèles au handoff : mêmes couleurs/typographies/espacements/rayons/ombres,
  mêmes icônes (chemins SVG transcrits verbatim depuis le prototype), même copie FR/EN verbatim
  (`copy.ts`), même machine à états et mêmes minuteurs exacts (`state.ts`).
- Tourne plein écran sur un vrai appareil (barre d'état/notch/île dynamique/indicateur d'accueil
  du système, via `react-native-safe-area-context`/`expo-status-bar`) plutôt que dans le mockup de
  téléphone dessiné en CSS du prototype HTML.

## Ce qui est simulé (comme le prototype de design lui-même)

Le handoff est explicite (§2 de son README) : "Le prototype HTML simule la lecture NFC, la caméra
et la biométrie par des minuteurs." Ce premier PoC fait de même — `state.ts` avance `step`/`pct`/
`livePhase` par `setTimeout`/`setInterval`, pas par de vrais événements NFC/caméra. Le reste de
`apps/mobile/src` contient déjà une lecture NFC/BAC réelle (`src/nfc/`), une vérification locale
complète (`src/verification/localVerification.ts`), une reconnaissance faciale on-device vérifiée
(`src/faceMatch/`) et une liveness active (`src/liveness/`) — voir docs/pki-trust-model.md et
docs/facial-recognition.md à la racine du dépôt. Brancher ce moteur réel à la place des minuteurs
de `state.ts` est le prochain incrément, pas ce premier PoC.

Les commutateurs de démonstration (langue/scénario/réinitialisation, `components/DemoControls.tsx`)
n'ont pas d'équivalent en production — voir leur propre commentaire.

## Fidélité connue, limites de ce premier PoC

- Flous (`expo-blur` `BlurView`) : intensité approchée, pas garantie pixel-identique au
  `backdrop-filter` CSS du prototype.
- Drapeaux emoji plutôt que les dégradés CSS générés du prototype (alternative explicitement
  documentée par le handoff, §3/§11).
- Icônes système autres que NFC : redessinées en SVG (chemins transcrits du prototype), pas
  mappées vers SF Symbols (le handoff recommande ce mapping en SwiftUI — ici React Native).

Les trois dégradés/glows radiaux du prototype (bouton d'accueil, halo NFC, fond du viseur de
vivacité) sont désormais reproduits fidèlement via `react-native-svg` `RadialGradient`
(`expo-linear-gradient` ne fait pas de radial) — corrigé après un premier passage qui les
approximait ou les aplatissait.

## Capture caméra MRZ (ajoutée, hors handoff original)

Le handoff simule la caméra par un aplat texturé (son README §2/§3) ; l'écran MRZ (`screens/
MrzScreen.tsx`) proposait donc jusqu'ici seulement une saisie manuelle des trois champs (numéro de
document, dates de naissance/expiration) servant de clé d'accès NFC/BAC. Une lecture caméra en direct
a été ajoutée sur demande (`components/MrzCameraScanner.tsx`, `../mrz/mrzFromLines.ts`,
`../../modules/mrz-scanner`) :

- **Module natif Expo local, iOS** (`apps/mobile/modules/mrz-scanner`, Swift) : session
  AVFoundation dont chaque image vidéo (jusqu'à ~10 par seconde) passe par `VNRecognizeTextRequest`
  d'Apple Vision, limité à la zone du cadre élargie, correction linguistique désactivée (la MRZ n'est
  pas du langage naturel). Aucune photo n'est prise, rien ne quitte l'appareil. Mise au point
  rapprochée et zoom calculé d'après la distance minimale de mise au point de l'appareil (méthode de
  l'exemple AVCamBarcode d'Apple) pour que la carte reste nette sur les iPhone Pro récents. Le
  module renvoie au JS les lignes reconnues avec leur position dans la vue.
- **Validation en JS** (`../mrz/mrzFromLines.ts`, testée dans `test/mrz/mrzFromLines.test.ts`) :
  regroupement des morceaux de texte par ligne, corrections guidées par le format MRZ (`«`→`<<`,
  O/0, I/1, S/5… selon que la position attend un chiffre ou une lettre ; variantes ambiguës du
  numéro de document départagées par son chiffre de contrôle), puis vrai parseur ICAO 9303 de
  `@emrtd-verify/emrtd-core` — une lecture n'est jamais acceptée sans chiffres de contrôle corrects
  pour le numéro, la naissance et l'expiration. Elle n'est retenue qu'une fois lue à l'identique sur
  deux images, ce qui écarte les confusions OCR ponctuelles.
- Les lignes de forme MRZ sont surlignées en vert en direct, le cadre verdit quand une lecture
  valide apparaît, puis l'écran avance seul (retour haptique) sans bouton à appuyer.
- L'ancienne CNI française (avant août 2021, MRZ non ICAO sur 2 × 36 caractères) est reconnue et
  signalée : elle n'a pas de puce, la vérification NFC est impossible.
- Android : pas encore de scanner en direct (le module est iOS uniquement) — l'écran s'ouvre sur la
  saisie manuelle.
- Après une lecture réussie, les champs sont pré-remplis mais restent visibles et modifiables (écran
  de saisie manuelle, avec un bandeau de confirmation) avant de continuer — pas d'avance automatique
  sans confirmation visuelle.

## Lecture NFC réelle (PACE, repli BAC)

`beginNfc` lance une vraie lecture (`../nfc/emrtdReader.ts`) : lecture d'EF.CardAccess, PACE avec
la clé MRZ quand la puce l'annonce (CNI françaises depuis 2021, passeports récents), sinon BAC ;
puis EF.SOD, DG1, DG2, DG14, DG15 sous messagerie sécurisée (3DES ou AES). La jauge de l'écran NFC
suit la progression réelle (canal établi, puis chaque fichier lu) et la feuille système iOS affiche
les mêmes étapes. Une clé refusée par la puce (MRZ mal lue) renvoie vers l'écran MRZ ; une session
interrompue renvoie vers l'écran « Placez le document ».

Prérequis iOS : compte Apple Developer payant, capacité *NFC Tag Reading* (ajoutée par `expo
prebuild` via le plugin de `react-native-nfc-manager` dans `app.json` et `plugins/withNfcPaceFormat.js` :
formats `TAG` + `PACE`, AID
eMRTD A0000002471001 seul dans `select-identifiers`, comme ReadID — les AID supplémentaires
A0000002472001 et 00000000000000 n'apportaient rien). Les CNI françaises depuis 2021 n'acceptent que PACE : iOS 16+ ne les signale
qu'avec l'option d'interrogation `NFCPollingPACE` (ajoutée par `patches/react-native-nfc-manager@3.17.2.patch`)
et le format `PACE` dans l'entitlement — sans lui, la session NFC ne voit jamais la carte.

Vérification après lecture : Passive Authentication complète sur l'appareil — signature du SOD,
DSC signé par le CSCA du pays (le magasin embarqué est indexé par le code X.509 à 2 lettres `FR`, la
MRZ donne `FRA` : les deux formes sont rapprochées, et parmi les CSCA valides du pays on retient celui
qui a réellement signé le DSC), empreintes des DG lus (un DG déclaré mais non lu, comme DG3 protégé
par EAC, n'est pas une divergence). Tout en JavaScript pur (`emrtd-core/src/crypto/pureVerify.ts`) :
Hermes n'a pas Web Crypto. L'écran « Chaîne » détaille le CSCA et le DSC (sujet, émetteur, n° de
série, validité) ; la photo DG2 (JPEG ou JPEG 2000) s'affiche sur le verdict. Le commutateur de
scénario de démonstration a été retiré.

Réglages › Contrôles exigés : révocation (CRL) et registre perdus/volés, **désactivés par défaut**
car ni l'un ni l'autre n'est joignable hors ligne. Désactivé, un contrôle non réalisé devient une
anomalie « info » (visible, sans effet sur le verdict) au lieu d'un avertissement qui plafonne le
verdict à « À vérifier » ; un résultat positif (DSC révoqué, document signalé) reste critique. Le
verdict présente l'identité au format carte d'identité (drapeau, photo DG2, date de naissance…).

## Design v2 — mode sombre, transitions, retours, Réglages

Deuxième livraison de Claude Design (`Authentik Mobile v2 Dark.dc.html`, non versionné ici non
plus). Ce qu'elle change, et comment c'est transcrit :

- **Sombre par défaut** — `theme.ts` `darkColors` reprend la palette "noir pur iOS" du design (fond
  #000, surfaces #1C1C1E, encre rgba(235,235,245,…), rouge #FF453A, washs de verdict du design). Le
  mode clair (palette v1) reste accessible : la bascule a quitté l'en-tête de l'accueil pour la
  section Apparence des Réglages (ajout hors design, le design v2 est sombre uniquement).
- **Nom provisoire "BaynID"** (`copy.ts` `appName`, `app.json` `name`) — le design proposait
  ClearID/PuceID/IDSure/VeraID/TrueID ; l'utilisateur teste BaynID. Les identifiants de code
  (`authentik/`, `useAuthentikDemo`) ne changent pas. L'identifiant de bundle iOS est `com.nehari.baynid`
  (`com.authentik.mobile` restait enregistré par l'équipe de développement gratuite et bloquait la
  capacité NFC Tag Reading une fois passé au compte Apple Developer payant).
- **Accueil** (`screens/HomeScreen.tsx`) — logo flat, nom, mode hors ligne/en ligne et état du
  magasin CSCA dans un seul cadre ; bouton Vérifier en anneau de verre (176 px) autour d'un disque
  plein (132 px) qui occupe l'espace central. L'illustration d'en-tête
  (`assets/authentik/header-illustration.png`) n'est plus affichée.
- **Onglet Réglages** (`screens/SettingsScreen.tsx`, étape `settings`) — remplace l'onglet "À
  propos" inactif : version, magasin CSCA (→ magasin de confiance), sons et retours haptiques,
  apparence, confidentialité, informations légales (lignes décoratives, comme dans le prototype).
- **Transitions** (`components/ScreenTransition.tsx`) — table `ANIM` du design : push iOS entre
  écrans, retour, montée modale au lancement du parcours, fondu entre onglets et vers le
  traitement, fondu + léger zoom vers le verdict, dont les cinq contrôles apparaissent l'un après
  l'autre. Seul l'écran entrant est animé, comme dans le prototype.
- **Retours haptiques et sonores** (`feedback.ts`) — mêmes déclencheurs que `fb()` du design : tap
  au lancement, tick à chaque palier NFC / phase de vivacité / MRZ validée, "live" en fin de
  lecture et à la vivacité confirmée, succès/avertissement/erreur au verdict (et erreur sur un
  échec de lecture réelle). Haptique via `expo-haptics` ; sons via `expo-av` (nouvelle dépendance
  native : **recompiler le dev client**), tonalités du design pré-rendues en WAV par
  `scripts/generate-feedback-tones.js`. Coupables dans Réglages. La bulle "Haptique · …" du
  prototype n'est pas reprise : elle ne servait qu'à montrer les vibrations dans un navigateur.
- **Dock** (`components/TabBar.tsx`) — géométrie v2 (64 px, rayon 32, marges 16), pilule
  rgba(255,255,255,.13) en sombre, trois onglets actifs.

Corrigé au passage : le journal DG de l'écran NFC et l'écran de traitement écrivaient l'étape en
cours en `#000` codé en dur, invisible sur fond noir — ils suivent désormais la palette.

Toujours valable depuis la v1 : chaque écran calcule ses styles via
`useMemo(() => makeStyles(demo.colors), [demo.colors])` pour suivre la palette active, et chaque
`Pressable` passe par `components/PressableFX.tsx` (léger retrait d'échelle + opacité au contact,
état "pressed" absent du design).

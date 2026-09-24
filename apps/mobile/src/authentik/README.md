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
document, dates de naissance/expiration) servant de clé d'accès NFC/BAC. Une vraie capture caméra a
été ajoutée sur demande (`components/MrzCameraScanner.tsx`, `../mrz/scanMrz.ts`) :

- `expo-camera` pour l'aperçu et la prise de vue, `expo-image-manipulator` pour recadrer la photo
  sur le cadre-guide affiché à l'écran avant OCR.
- OCR on-device (`@react-native-ml-kit/text-recognition`, Google ML Kit, aucun appel réseau —
  cohérent avec le reste du pipeline hors ligne) sur la zone recadrée.
- Le texte reconnu est filtré aux lignes de forme MRZ (alphabet `[A-Z0-9<]`, longueur exacte 44 ou
  30 après suppression des espaces), puis une lecture n'est acceptée que si elle passe le vrai
  parseur/chiffres de contrôle ICAO 9303 déjà existant (`@emrtd-verify/emrtd-core`, `mrzParser.ts`)
  — jamais l'OCR seul.
- Détection automatique par sondage plutôt qu'un bouton à appuyer : une photo est prise et analysée
  toutes les 700 ms tant que l'écran est ouvert ; dès qu'une lecture valide est trouvée, le cadre
  passe au vert et l'écran avance seul. Un vrai suivi image par image (rectangle qui suit le texte
  en continu) demanderait de remplacer `expo-camera` par `react-native-vision-camera` + un plugin
  d'analyse par frame — nouveaux modules natifs non vérifiables dans cet environnement de
  développement (pas d'Xcode/simulateur ici), écarté pour cette raison après discussion. Le bouton
  au centre des contrôles force une tentative immédiate plutôt que d'attendre le prochain sondage ;
  la saisie manuelle reste toujours accessible en repli (document mal aligné, lumière insuffisante,
  etc.).
- Le mappage du cadre-guide (fraction de l'aperçu écran) vers un rectangle de recadrage en pixels
  de la photo capturée est une approximation (suppose que l'aperçu remplit son conteneur sans
  letterboxing) — acceptable ici car un recadrage trop généreux n'affecte que le nombre de lignes
  candidates à filtrer, pas la validité de la lecture retenue (toujours vérifiée par chiffres de
  contrôle).
- Après une lecture réussie, les champs sont pré-remplis mais restent visibles et modifiables (écran
  de saisie manuelle, avec un bandeau de confirmation) avant de continuer — pas d'avance automatique
  sans confirmation visuelle.

## Design v2 — mode sombre, transitions, retours, Réglages

Deuxième livraison de Claude Design (`Authentik Mobile v2 Dark.dc.html`, non versionné ici non
plus). Ce qu'elle change, et comment c'est transcrit :

- **Sombre par défaut** — `theme.ts` `darkColors` reprend la palette "noir pur iOS" du design (fond
  #000, surfaces #1C1C1E, encre rgba(235,235,245,…), rouge #FF453A, washs de verdict du design). Le
  mode clair (palette v1) reste accessible : la bascule a quitté l'en-tête de l'accueil pour la
  section Apparence des Réglages (ajout hors design, le design v2 est sombre uniquement).
- **Nom provisoire "BaynID"** (`copy.ts` `appName`, `app.json` `name`) — le design proposait
  ClearID/PuceID/IDSure/VeraID/TrueID ; l'utilisateur teste BaynID. Les identifiants de code
  (`authentik/`, `useAuthentikDemo`) et l'identifiant de bundle iOS ne changent pas.
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

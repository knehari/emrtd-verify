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
  — jamais l'OCR seul. En cas d'échec (document mal aligné, lumière insuffisante, etc.), l'écran
  invite à réessayer et propose toujours la saisie manuelle en repli.
- Le mappage du cadre-guide (fraction de l'aperçu écran) vers un rectangle de recadrage en pixels
  de la photo capturée est une approximation (suppose que l'aperçu remplit son conteneur sans
  letterboxing) — acceptable ici car un recadrage trop généreux n'affecte que le nombre de lignes
  candidates à filtrer, pas la validité de la lecture retenue (toujours vérifiée par chiffres de
  contrôle).
- Après une lecture réussie, les champs sont pré-remplis mais restent visibles et modifiables (écran
  de saisie manuelle, avec un bandeau de confirmation) avant de continuer — pas d'avance automatique
  sans confirmation visuelle.

## Mode Dark (ajouté, hors handoff original)

Le handoff de design ne livre aucune maquette sombre (§9 "Design tokens" ne documente qu'une
palette claire, plus les surfaces sombres des écrans caméra Mrz/Selfie qui restent volontairement
sombres quel que soit le mode). Un bascule clair/sombre a été ajouté sur demande, sur le même
principe que le mode hors ligne/en ligne déjà présent :

- `theme.ts` : `darkColors`, une approximation raisonnable des conventions système iOS en mode
  sombre (labelColor blanc à opacité dégressive, systemBackground/secondarySystemBackground) pour
  les tokens qui doivent s'adapter au fond — `accent`, les dégradés et les couleurs sémantiques
  (succès/avertissement/erreur) restent identiques dans les deux modes.
- `state.ts` : `scheme`/`toggleScheme`, initialisé depuis `Appearance.getColorScheme()` puis
  bascule manuelle via l'icône soleil/lune de l'écran d'accueil.
- Chaque écran calcule ses styles via `useMemo(() => makeStyles(demo.colors), [demo.colors])`
  plutôt qu'un `StyleSheet.create` statique au chargement du module, pour réagir au changement de
  palette.
- Les écrans caméra (Mrz, Selfie) restent sombres dans les deux modes — c'est déjà leur traitement
  dans le handoff, pas une conséquence du bascule.

## Retour tactile (ajouté)

Chaque `Pressable` de `authentik/` passe par `components/PressableFX.tsx` (léger retrait
d'échelle + baisse d'opacité au contact) — le handoff ne spécifie aucun état "pressed" (prototype
HTML statique). `expo-haptics` déclenche une vibration unique (`impactAsync`, style `Medium`) au
tout début d'une lecture NFC (`state.ts`, `runVerification`/`runNfcDemo`) — recommandé par le
handoff (§7 "Interactions, animations, états" : "Retour tactile : recommandé sur franchissement de
palier NFC...") mais implémenté ici seulement au démarrage de la lecture, comme demandé.

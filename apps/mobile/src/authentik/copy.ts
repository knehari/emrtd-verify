/**
 * Copie FR/EN — transcrite verbatim depuis le handoff de design
 * (`design_handoff_authentik/eMRTD Verify Mobile.dc.html`, objets `const FR`/`const EN`, §1a
 * "Parcours complet, interactif", seul écran retenu du handoff — voir son README §12). Aucune
 * reformulation : le README du handoff demande explicitement de reprendre ce texte tel quel.
 */

export interface Copy {
  appName: string;
  homeSub: string;
  homeSubOnline: string;
  tabVerify: string;
  tabTrust: string;
  tabAbout: string;
  verifyBtn: string;
  supportedTitle: string;
  autoDetect: string;
  decisionAuth: string;
  decisionSusp: string;
  decisionAuthSub: string;
  decisionSuspSub: string;
  decisionSuspSubOnline: string;
  decisionAlert: string;
  decisionAlertSub: string;
  passedLine: string;
  types3: [string, string][];
  modeTitle: string;
  modeOffline: string;
  modeOnline: string;
  modeOfflineDesc: string;
  modeOnlineDesc: string;
  trustLineOnline: string;
  offlineTitle: string;
  trustLine: string;
  scanCta: string;
  scanSub: string;
  typesTitle: string;
  ephemeral: string;
  cancel: string;
  close: string;
  back: string;
  share: string;
  mrzTitle: string;
  mrzHead: string;
  mrzHint: string;
  mrzHintPassport: string;
  mrzHintCard: string;
  mrzFormatPassport: string;
  mrzFormatCard: string;
  mrzReading: string;
  // Capture caméra réelle de la MRZ — absente du handoff (qui simule la caméra par un aplat,
  // voir son README §2/§3) : copie ajoutée, pas transcrite verbatim, comme le mode Dark plus bas.
  mrzCameraManual: string;
  mrzCameraHold: string;
  mrzCameraLegacy: string;
  mrzCameraSuccess: string;
  mrzCameraPermission: string;
  mrzCameraOpenSettings: string;
  mrzScanCamera: string;
  placeNav: string;
  placeHead: string;
  placeHint: string;
  placeTip1: string;
  placeTip2: string;
  placeCta: string;
  nfcNav: string;
  nfcProtocol: string;
  nfcHead: string;
  nfcHint: string;
  livePhases: string[];
  livePhaseSub: string[];
  selfieNav: string;
  selfieHead: string;
  selfieHint: string;
  selfieNote: string;
  selfieSkip: string;
  selfieBlinkNudge: string;
  selfieHints: Record<"no-face" | "multiple" | "closer" | "farther" | "center" | "face-camera" | "hold", string>;
  /** Vivacité active (caméra TrueDepth, défi émis par le serveur) — SelfieScreen.tsx › ActiveSelfie. */
  active: {
    nav: string;
    align: string;
    alignSub: string;
    fetching: string;
    ready: string;
    firstAction: string;
    actions: Record<"blink" | "turn_head_left" | "turn_head_right" | "open_mouth" | "smile", string>;
    actionSub: string;
    back: string;
    nextAction: string;
    lightSub: string;
    capture: string;
    captureSub: string;
    passed: string;
    passedSub: string;
    failed: string;
    retry: string;
    continueWithout: string;
    unavailable: string;
    simpleSelfie: string;
    note: string;
    noteFailed: string;
    noteSkipped: string;
    noteUnavailable: string;
    interrupted: string;
  };
  aboutFace: string;
  aboutFaceDesc: string;
  procHead: string;
  procNote: string;
  procNoteOnline: string;
  procSteps: string[];
  expLabel: string;
  tabFields: string;
  tabChain: string;
  tabAnomalies: string;
  fieldsSub: string;
  chainSub: string;
  anomSub: string;
  trustTitle: string;
  trustSub: string;
  syncNow: string;
  trustNote: string;
  shareTitle: string;
  shareSub: string;
  sharePdf: string;
  verdicts: { authentic: string; suspicious: string; alert: string };
  types: { name: string; format: string }[];
  dgs: { id: string; label: string }[];
  checks: {
    passive: [string, string];
    pkiOk: [string, string];
    pkiWarn: [string, string];
    chip: [string, string];
    fields: [string, string];
    faceWarn: [string, string];
    faceNone: [string, string];
    passiveFail: [string, string];
    pkiFail: [string, string];
    chipWarn: [string, string];
    faceFail: [string, string];
  };
  fields: [string, string, string][];
  chain: [string, string, string, string][];
  chainAlert: [string, string, string, string][];
  anomalies: {
    liveness: [string, string, string];
    revocation: [string, string, string];
    csca: [string, string, string];
    sodHash: [string, string, string];
    dscUnknown: [string, string, string];
    faceMismatch: [string, string, string];
  };
  countriesTitle: string;
  countriesSub: string;
  searchPh: string;
  anchorsWord: string;
  countriesEmpty: string;
  cscaValidCount: string;
  cscaStatus: { valid: string; future: string; expired: string };
  cscaLink: string;
  cscaKey: string;
  cscaSignature: string;
  cscaSource: string;
  cscaSources: Record<string, string>;
  cscaSerial: string;
  cscaSubject: string;
  cscaIssuer: string;
  cscaMore: string;
  countries: [string, string, string, number][];
  verifiedLine: string;
  verifiedLineOnline: string;
  // Onglet Réglages — design v2 (`Authentik Mobile v2 Dark.dc.html`, `Object.assign(FR/EN, {about…})`).
  aboutVersion: string;
  aboutTagline: string;
  aboutAppTitle: string;
  aboutApp: [string, string][];
  aboutStoreTitle: string;
  aboutStoreCta: string;
  aboutFbTitle: string;
  aboutFb: string;
  aboutFbDesc: string;
  aboutChecksTitle: string;
  aboutCrl: string;
  aboutCrlDesc: string;
  aboutCrlCache: string;
  aboutCrlCacheNone: string;
  aboutLostStolen: string;
  aboutLostStolenDesc: string;
  aboutServerTitle: string;
  aboutServer: string;
  aboutServerNone: string;
  modeServerMissing: string;
  srv: {
    title: string;
    sub: string;
    url: string;
    urlPh: string;
    key: string;
    keyPh: string;
    test: string;
    testing: string;
    reachable: string;
    resultKey: string;
    bundleKey: string;
    noBundleKey: string;
    keyChanged: string;
    pinHint: string;
    pin: string;
    pinned: string;
    forget: string;
    queueTitle: string;
    queueEmpty: string;
    syncNow: string;
    syncing: string;
    cscaSync: string;
    cscaSyncing: string;
  };
  idCardLabels: { surname: string; givenNames: string; birth: string; sex: string; nationality: string; number: string; expiry: string };
  idDocTypes: { ePassport: string; eID: string; eResidenceCard: string };
  // Bascule clair/sombre : absente du design v2 (sombre uniquement), conservée à la demande de
  // l'utilisateur et déplacée ici depuis l'en-tête de l'accueil — copie ajoutée, pas transcrite.
  aboutAppearanceTitle: string;
  aboutDarkMode: string;
  aboutDarkModeDesc: string;
  aboutDock: string;
  dockGlass: { native: string; noModule: string; oldSdk: string; oldIos: string };
  aboutPrivacyTitle: string;
  aboutPrivacy: string;
  aboutLegalTitle: string;
  aboutLegal: string[];
  aboutFooter: string;
}

export const FR: Copy = {
  appName: "BaynID",
  homeSub: "Contrôle autonome, hors ligne",
  homeSubOnline: "Contrôle connecté au service KYC",
  tabVerify: "Vérifier",
  tabTrust: "Confiance",
  tabAbout: "Réglages",
  verifyBtn: "Vérifier",
  supportedTitle: "Documents pris en charge",
  autoDetect: "Le type est reconnu automatiquement à la lecture.",
  decisionAuth: "Document authentique",
  decisionSusp: "Revue manuelle recommandée",
  decisionAuthSub: "Tous les contrôles cryptographiques sont concluants.",
  decisionSuspSub: "Le document est cryptographiquement intact. Deux signaux empêchent un verdict automatique.",
  decisionSuspSubOnline: "Le document est cryptographiquement intact. Un signal empêche un verdict automatique.",
  decisionAlert: "Document non authentifiable",
  decisionAlertSub: "Deux contrôles cryptographiques ont échoué. Ne pas accepter ce document en l'état.",
  passedLine: "contrôles réussis sur",
  types3: [
    ["Passeport", "TD3"],
    ["Carte d'identité", "TD1"],
    ["Titre de séjour", "TD1/TD2"],
  ],
  modeTitle: "Mode de vérification",
  modeOffline: "Hors ligne",
  modeOnline: "En ligne · KYC",
  modeOfflineDesc: "Tout est calculé sur l'appareil, avec le magasin CSCA embarqué.",
  modeOnlineDesc: "Résultat signé par le serveur KYC : révocation, registre perdus/volés et trace d'audit.",
  trustLineOnline: "Magasin CSCA embarqué · {countries} pays · {anchors} ancres",
  offlineTitle: "Hors ligne",
  trustLine: "Magasin CSCA embarqué · {countries} pays · {anchors} ancres",
  scanCta: "Vérifier un document",
  scanSub: "Lecture NFC + authentification passive",
  typesTitle: "Type de document",
  ephemeral: "Session éphémère : aucun dossier n'est créé, aucune donnée n'est conservée après le verdict.",
  cancel: "Annuler",
  close: "Fermer",
  back: "Retour",
  share: "Partager",
  mrzTitle: "Zone lisible",
  mrzHead: "Cadrez la zone lisible par machine",
  mrzHint:
    "Les lignes imprimées au bas du document : 2 sur la page photo d'un passeport, 3 au dos d'une carte d'identité. Elles servent de clé d'accès à la puce.",
  mrzHintPassport: "Page photo ouverte : cadrez seulement les 2 lignes du bas, pas toute la page.",
  mrzHintCard: "Au dos de la carte : cadrez les 3 lignes du bas.",
  mrzFormatPassport: "Passeport",
  mrzFormatCard: "Carte / titre",
  mrzReading: "Lecture de la MRZ…",
  mrzCameraManual: "Saisir manuellement",
  mrzCameraHold: "Zone lisible détectée — ne bougez plus…",
  mrzCameraLegacy:
    "Ancienne carte d'identité (avant 2021) : elle n'a pas de puce, la vérification est impossible. Utilisez un passeport ou une carte d'identité récente.",
  mrzCameraSuccess: "Lu automatiquement — vérifiez les informations avant de continuer.",
  mrzCameraPermission: "Autorisez l'accès à l'appareil photo pour scanner le document.",
  mrzCameraOpenSettings: "Ouvrir les réglages",
  mrzScanCamera: "Scanner avec l'appareil photo",
  placeNav: "Positionnement",
  placeHead: "Placez le document derrière le téléphone",
  placeHint: "L'antenne NFC se trouve dans le haut du dos de l'iPhone. Posez la page de la photo contre cette zone.",
  placeTip1: "Retirez la coque si elle est épaisse ou métallique.",
  placeTip2: "Posez l'ensemble à plat, sur une table de préférence.",
  placeCta: "Commencer la lecture",
  nfcNav: "Lecture NFC",
  nfcProtocol: "PACE",
  nfcHead: "Maintenez le document contre le téléphone",
  nfcHint: "Ne bougez plus — la lecture s'interrompt si le contact est perdu.",
  livePhases: ["Cadrez votre visage", "Tournez lentement la tête", "Clignez des yeux", "Vivacité confirmée"],
  livePhaseSub: ["Placez-vous dans le cadre, bien éclairé.", "Un mouvement lent suffit.", "Une seule fois.", "Comparaison avec la photo de la puce…"],
  selfieNav: "Capture vivante",
  selfieHead: "Regardez l'objectif",
  selfieHint: "Comparaison avec la photo DG2 lue dans la puce.",
  selfieNote: "La capture ne quitte jamais le téléphone. Elle est effacée après la comparaison.",
  selfieSkip: "Passer",
  selfieBlinkNudge: "Fermez franchement les yeux une fois, puis rouvrez-les.",
  selfieHints: {
    "no-face": "Aucun visage détecté : placez-vous face à l'écran.",
    multiple: "Une seule personne dans le cadre.",
    closer: "Rapprochez-vous un peu.",
    farther: "Reculez un peu.",
    center: "Centrez votre visage dans le cadre.",
    "face-camera": "Regardez l'écran, tête droite.",
    hold: "Ne bougez plus…",
  },
  active: {
    nav: "Vivacité active",
    align: "Placez votre visage dans le cadre",
    alignSub: "De face, bien éclairé. Un défi aléatoire du serveur va suivre.",
    fetching: "Préparation du défi…",
    ready: "Préparez-vous",
    firstAction: "Première consigne : {action}",
    actions: {
      blink: "Clignez des yeux",
      turn_head_left: "Tournez la tête à gauche",
      turn_head_right: "Tournez la tête à droite",
      open_mouth: "Ouvrez la bouche",
      smile: "Souriez",
    },
    actionSub: "Maintenant, franchement, puis revenez de face.",
    back: "Revenez de face",
    nextAction: "Ensuite : {action}",
    lightSub: "L'écran change de couleur : gardez le visage face à lui.",
    capture: "Regardez l'écran",
    captureSub: "Visage détendu, tête droite.",
    passed: "Vivacité confirmée",
    passedSub: "Comparaison avec la photo de la puce…",
    failed: "Défi non validé",
    retry: "Recommencer",
    continueWithout: "Continuer sans",
    unavailable: "Défi indisponible",
    simpleSelfie: "Selfie simple",
    note: "Caméra TrueDepth",
    noteFailed: "défi actif échoué, poursuivi sans",
    noteSkipped: "défi actif passé",
    noteUnavailable: "défi actif indisponible",
    interrupted: "Suivi du visage interrompu pendant le défi.",
  },
  aboutFace: "Comparaison faciale",
  aboutFaceDesc: "Après la lecture de la puce, un selfie guidé est comparé à la photo du document (SFace, sur l'appareil).",
  procHead: "Vérification en cours",
  procNote: "Tout est calculé sur l'appareil, avec le magasin CSCA embarqué.",
  procNoteOnline: "Calculé sur l'appareil, puis confirmé par le serveur KYC (résultat signé).",
  procSteps: ["Hashs DG ↔ SOD", "Signature du SOD (DSC)", "Chaîne DSC ↔ CSCA", "Cohérence des champs", "Correspondance faciale"],
  expLabel: "Expire le",
  tabFields: "Champs vérifiés",
  tabChain: "Chaîne de confiance PKI",
  tabAnomalies: "Anomalies",
  fieldsSub: "Cohérence MRZ ↔ DG1 ↔ zone visuelle, chiffres de contrôle et dates.",
  chainSub: "Du SOD signé jusqu'au CSCA de confiance.",
  anomSub: "Le système n'oppose pas un blocage : il explique, avec une sévérité par signal.",
  trustTitle: "Magasin de confiance",
  trustSub: "Ancres CSCA embarquées pour le fonctionnement hors ligne.",
  syncNow: "Synchroniser maintenant",
  trustNote: "Les Master Lists nationales sont vérifiées contre des CSCA déjà approuvées — jamais d'auto-amorçage.",
  shareTitle: "Résultat signé",
  shareSub: "PDF et JSON signés ECDSA P-256. Aucune donnée biométrique n'est incluse.",
  sharePdf: "Exporter",
  verdicts: { authentic: "Authentique", suspicious: "À vérifier", alert: "Rejeté" },
  types: [
    { name: "Passeport (ePassport)", format: "TD3" },
    { name: "Carte d'identité (eID)", format: "TD1" },
    { name: "Titre de séjour", format: "TD1 / TD2" },
  ],
  dgs: [
    { id: "DG1", label: "MRZ" },
    { id: "DG2", label: "Photo du visage" },
    { id: "DG14", label: "Infos de sécurité" },
    { id: "DG15", label: "Clé Active Auth." },
    { id: "SOD", label: "Objet de sécurité" },
  ],
  checks: {
    passive: ["Authentification passive", "Hashs DG ↔ SOD · signature valide"],
    pkiOk: ["Chaîne de confiance PKI", "ICAO PKD · confiance élevée"],
    pkiWarn: ["Chaîne de confiance PKI", "ICAO PKD · révocation non vérifiée hors ligne"],
    chip: ["Authenticité de la puce", "Active Authentication (ECDSA) valide"],
    fields: ["Cohérence des champs", "12 contrôles · MRZ ↔ DG1 ↔ VIZ"],
    faceWarn: ["Correspondance faciale", "Similarité 0,91 · vivacité passive uniquement"],
    faceNone: ["Correspondance faciale", "Non demandée — contrôle document seul"],
    passiveFail: ["Authentification passive", "Hash DG2 ↔ SOD non concordant"],
    pkiFail: ["Chaîne de confiance PKI", "DSC absent du magasin CSCA"],
    chipWarn: ["Authenticité de la puce", "Active Authentication indisponible (DG15 absent)"],
    faceFail: ["Correspondance faciale", "Similarité 0,41 · en dessous du seuil"],
  },
  fields: [
    ["Nom", "MARTIN", "MRZ ↔ DG1 ↔ VIZ"],
    ["Prénoms", "CAMILLE ELISE", "MRZ ↔ DG1"],
    ["Nationalité", "FRA", "cohérente avec le pays émetteur"],
    ["Date de naissance", "12/04/1991", "chiffre de contrôle · antérieure à l'émission"],
    ["N° de document", "21FR34567", "chiffre de contrôle · format TD3"],
    ["Date d'expiration", "30/08/2031", "chiffre de contrôle · document non expiré"],
    ["Sexe", "F", "format attendu"],
  ],
  chain: [
    ["SOD", "valide", "LDSSecurityObject · SHA-256", "Chaque hash de DG lu correspond à l'empreinte signée."],
    ["DSC", "valide", "CN=DS France 04, O=ANTS, C=FR", "Signé par le CSCA ci-dessous. Valide jusqu'au 14/02/2028."],
    ["CSCA", "confiance élevée", "CN=CSCA France, C=FR", "Ancre ICAO PKD, épinglée lors de la dernière synchronisation."],
  ],
  chainAlert: [
    ["SOD", "invalide", "LDSSecurityObject · SHA-256", "L'empreinte du groupe DG2 lue dans la puce ne correspond pas à celle signée."],
    ["DSC", "non approuvé", "CN=DS France 04, O=ANTS, C=FR", "Ne remonte à aucune ancre CSCA du magasin embarqué."],
    ["CSCA", "introuvable", "—", "Aucune ancre correspondante : l'origine de la signature n'est pas établie."],
  ],
  anomalies: {
    liveness: ["LIVENESS_PASSIVE_ONLY", "warning", "Vivacité passive uniquement : jamais suffisante seule pour un verdict « authentique » automatisé. Le verdict est dégradé vers « à vérifier »."],
    revocation: ["REVOCATION_NOT_CHECKED", "warning", "Aucune CRL récupérée en mode hors ligne : le statut de révocation du CSCA et du DSC est inconnu."],
    csca: ["CSCA_EXPIRING_SOON", "info", "Le CSCA FRA arrive à expiration dans 74 jours. Prévoir une synchronisation du magasin."],
    sodHash: ["SOD_HASH_MISMATCH", "critical", "L'empreinte du groupe DG2 lue dans la puce ne correspond pas à celle signée dans le SOD : la photo a été altérée après émission."],
    dscUnknown: ["DSC_NOT_TRUSTED", "critical", "Le certificat signataire ne remonte à aucune ancre CSCA du magasin. Origine de la signature non établie."],
    faceMismatch: ["FACE_MATCH_BELOW_THRESHOLD", "warning", "Similarité 0,41 contre un seuil de 0,75 : le porteur ne correspond pas à la photo de la puce."],
  },
  countriesTitle: "Pays pris en charge",
  countriesSub: "Ancres CSCA présentes dans le magasin embarqué.",
  searchPh: "Rechercher un pays",
  anchorsWord: "ancres",
  countriesEmpty: "Aucun pays ne correspond à cette recherche.",
  cscaValidCount: "valides",
  cscaStatus: { valid: "Valide", future: "Pas encore valide", expired: "Expiré" },
  cscaLink: "certificat de lien",
  cscaKey: "Clé",
  cscaSignature: "Signature",
  cscaSource: "Source",
  cscaSources: { "icao-pkd": "Master List ICAO", "national-pkd": "Master List nationale", "extended-trust-store": "Magasin étendu" },
  cscaSerial: "N° de série",
  cscaSubject: "Sujet",
  cscaIssuer: "Émetteur",
  cscaMore: "Toucher pour le sujet, l'émetteur et l'empreinte",
  countries: [
    ["FR", "🇫🇷", "France", 14],
    ["DE", "🇩🇪", "Allemagne", 12],
    ["BE", "🇧🇪", "Belgique", 9],
    ["ES", "🇪🇸", "Espagne", 11],
    ["IT", "🇮🇹", "Italie", 10],
    ["PT", "🇵🇹", "Portugal", 8],
    ["NL", "🇳🇱", "Pays-Bas", 9],
    ["CH", "🇨🇭", "Suisse", 7],
    ["GB", "🇬🇧", "Royaume-Uni", 13],
    ["MA", "🇲🇦", "Maroc", 6],
    ["DZ", "🇩🇿", "Algérie", 5],
    ["TN", "🇹🇳", "Tunisie", 5],
    ["SN", "🇸🇳", "Sénégal", 4],
    ["CI", "🇨🇮", "Côte d'Ivoire", 4],
    ["CA", "🇨🇦", "Canada", 12],
    ["US", "🇺🇸", "États-Unis", 15],
    ["AT", "🇦🇹", "Autriche", 8],
    ["PL", "🇵🇱", "Pologne", 9],
    ["SE", "🇸🇪", "Suède", 8],
    ["NO", "🇳🇴", "Norvège", 7],
    ["DK", "🇩🇰", "Danemark", 7],
    ["FI", "🇫🇮", "Finlande", 6],
    ["IE", "🇮🇪", "Irlande", 7],
    ["LU", "🇱🇺", "Luxembourg", 5],
    ["CZ", "🇨🇿", "Tchéquie", 7],
    ["RO", "🇷🇴", "Roumanie", 8],
    ["GR", "🇬🇷", "Grèce", 8],
    ["TR", "🇹🇷", "Turquie", 10],
  ],
  verifiedLine: "Vérifié le 21/09/2026 à 09:41 · hors ligne · résultat signé ECDSA P-256 · rien n'est conservé",
  verifiedLineOnline: "Vérifié le 21/09/2026 à 09:41 · en ligne · KYC · révocation vérifiée · résultat signé ECDSA P-256 · rien n'est conservé",
  aboutVersion: "Version 2.0 (214)",
  aboutTagline: "Vérification autonome des documents d'identité électroniques.",
  aboutAppTitle: "Application",
  aboutApp: [
    ["Version", "2.0 (214)"],
    ["Moteur de vérification", "ICAO Doc 9303"],
    ["Protocoles", "BAC · PACE · AA"],
  ],
  aboutStoreTitle: "Magasin CSCA",
  aboutStoreCta: "Voir le magasin de confiance",
  aboutFbTitle: "Retours",
  aboutFb: "Sons et retours haptiques",
  aboutFbDesc: "Paliers de lecture NFC, vivacité et verdict.",
  aboutChecksTitle: "Contrôles exigés",
  aboutCrl: "Révocation des certificats (CRL)",
  aboutCrlDesc:
    "La CRL du pays est téléchargée à chaque vérification si besoin (miroir ICAO, puis adresse du pays), vérifiée contre le CSCA et gardée pour le hors ligne. Activé, l'absence de CRL à jour donne « À vérifier ».",
  aboutCrlCache: "CRL en cache",
  aboutCrlCacheNone: "aucune pour l'instant",
  aboutLostStolen: "Registre des documents perdus/volés",
  aboutLostStolenDesc: "Exiger l'interrogation du registre (en ligne uniquement). Activé sans accès au registre, le résultat sera « À vérifier ».",
  aboutServerTitle: "Serveur KYC",
  aboutServer: "Serveur",
  aboutServerNone: "non configuré",
  modeServerMissing: "Aucun serveur KYC configuré — touchez pour le régler.",
  srv: {
    title: "Serveur KYC",
    sub: "En ligne, la puce lue et le selfie sont envoyés à ce serveur, qui renvoie un résultat signé : chaîne de confiance, révocation, registre des documents perdus/volés et comparaison faciale côté serveur, avec trace d'audit. Sa clé de signature est épinglée après vérification de son empreinte.",
    url: "Adresse du serveur",
    urlPh: "https://kyc.exemple.fr",
    key: "Clé API du client KYC",
    keyPh: "kyc_…",
    test: "Tester la connexion",
    testing: "Connexion…",
    reachable: "Serveur joignable, clé API acceptée",
    resultKey: "Clé qui signe les résultats",
    bundleKey: "Clé qui signe le magasin CSCA",
    noBundleKey: "non publiée (le magasin embarqué reste utilisé)",
    keyChanged: "Cette clé diffère de celle épinglée : ne l'acceptez que si l'opérateur du serveur confirme ce changement.",
    pinHint: "Comparez ces empreintes avec celles communiquées par l'opérateur du serveur avant d'épingler.",
    pin: "Empreintes vérifiées : épingler et enregistrer",
    pinned: "Épinglée le",
    forget: "Oublier ce serveur",
    queueTitle: "File d'attente",
    queueEmpty: "Aucune vérification en attente",
    syncNow: "Synchroniser maintenant",
    syncing: "Synchronisation…",
    cscaSync: "Mettre à jour le magasin CSCA",
    cscaSyncing: "Mise à jour…",
  },
  idCardLabels: { surname: "Nom", givenNames: "Prénoms", birth: "Né(e) le", sex: "Sexe", nationality: "Nationalité", number: "N° du document", expiry: "Expire le" },
  idDocTypes: { ePassport: "Passeport", eID: "Carte nationale d'identité", eResidenceCard: "Titre de séjour" },
  aboutAppearanceTitle: "Apparence",
  aboutDarkMode: "Mode sombre",
  aboutDarkModeDesc: "Activé par défaut. Les écrans caméra restent sombres.",
  aboutDock: "Effet du dock",
  dockGlass: {
    native: "Liquid Glass natif (iOS 26)",
    noModule: "Verre imité : module natif absent de cette compilation (pod install, puis recompiler dans Xcode)",
    oldSdk: "Verre imité : app compilée avec un Xcode antérieur à Xcode 26",
    oldIos: "Verre imité : l'iPhone est sous iOS {v}, le Liquid Glass demande iOS 26",
  },
  aboutPrivacyTitle: "Confidentialité",
  aboutPrivacy:
    "Hors ligne, tout est traité sur l'appareil : aucune donnée d'identité ni biométrique n'est conservée ou transmise (seules les CRL publiques sont téléchargées). En ligne · KYC, les données de la puce et le selfie sont envoyés au serveur KYC configuré dans ces Réglages.",
  aboutLegalTitle: "Informations légales",
  aboutLegal: ["Conditions d'utilisation", "Politique de confidentialité", "Licences open source", "Mentions légales"],
  aboutFooter: "© 2026 BaynID",
};

export const EN: Copy = {
  ...FR,
  homeSub: "Standalone check, offline",
  homeSubOnline: "Connected check · KYC service",
  tabVerify: "Verify",
  tabTrust: "Trust",
  tabAbout: "Settings",
  verifyBtn: "Verify",
  supportedTitle: "Supported documents",
  autoDetect: "The type is recognised automatically on read.",
  decisionAuth: "Authentic document",
  decisionSusp: "Manual review recommended",
  decisionAuthSub: "Every cryptographic check passed.",
  decisionSuspSub: "The document is cryptographically intact. Two signals prevent an automatic verdict.",
  decisionSuspSubOnline: "The document is cryptographically intact. One signal prevents an automatic verdict.",
  decisionAlert: "Document cannot be authenticated",
  decisionAlertSub: "Two cryptographic checks failed. Do not accept this document as is.",
  passedLine: "checks passed out of",
  types3: [
    ["Passport", "TD3"],
    ["ID card", "TD1"],
    ["Residence permit", "TD1/TD2"],
  ],
  modeTitle: "Verification mode",
  modeOffline: "Offline",
  modeOnline: "Online · KYC",
  modeOfflineDesc: "Everything is computed on device, against the embedded CSCA store.",
  modeOnlineDesc: "Signed result from the KYC server: revocation, lost/stolen registry and audit trail.",
  trustLineOnline: "Embedded CSCA store · {countries} countries · {anchors} anchors",
  offlineTitle: "Offline",
  trustLine: "Embedded CSCA store · {countries} countries · {anchors} anchors",
  scanCta: "Verify a document",
  scanSub: "NFC read + passive authentication",
  typesTitle: "Document type",
  ephemeral: "Ephemeral session: no case file is created and no data is kept after the verdict.",
  cancel: "Cancel",
  close: "Close",
  back: "Back",
  share: "Share",
  mrzTitle: "Machine-readable zone",
  mrzHead: "Frame the machine-readable zone",
  mrzHint:
    "The lines printed at the bottom of the document: 2 on a passport photo page, 3 on the back of an ID card. They are the chip access key.",
  mrzHintPassport: "Photo page open: frame only the 2 bottom lines, not the whole page.",
  mrzHintCard: "On the back of the card: frame the 3 bottom lines.",
  mrzFormatPassport: "Passport",
  mrzFormatCard: "Card / permit",
  mrzReading: "Reading the MRZ…",
  mrzCameraManual: "Enter manually",
  mrzCameraHold: "Machine-readable zone detected — hold still…",
  mrzCameraLegacy:
    "Old French ID card (before 2021): it has no chip, so it cannot be verified. Use a passport or a recent ID card.",
  mrzCameraSuccess: "Read automatically — check the details before continuing.",
  mrzCameraPermission: "Allow camera access to scan the document.",
  mrzCameraOpenSettings: "Open Settings",
  mrzScanCamera: "Scan with the camera",
  placeNav: "Positioning",
  placeHead: "Place the document behind the phone",
  placeHint: "The NFC antenna sits in the upper back of the iPhone. Hold the photo page against that area.",
  placeTip1: "Remove thick or metallic cases.",
  placeTip2: "Lay both flat, on a table if you can.",
  placeCta: "Start reading",
  nfcNav: "NFC read",
  nfcProtocol: "PACE",
  nfcHead: "Hold the document against the phone",
  nfcHint: "Keep still — the read stops if contact is lost.",
  livePhases: ["Frame your face", "Slowly turn your head", "Blink once", "Liveness confirmed"],
  livePhaseSub: ["Stand in the frame, well lit.", "A slow movement is enough.", "Just once.", "Comparing with the chip photo…"],
  selfieNav: "Live capture",
  selfieHead: "Look at the camera",
  selfieHint: "Compared with the DG2 photo read from the chip.",
  selfieNote: "The capture never leaves the phone. It is erased after the comparison.",
  selfieSkip: "Skip",
  selfieBlinkNudge: "Close your eyes firmly once, then open them.",
  selfieHints: {
    "no-face": "No face detected: face the screen.",
    multiple: "Only one person in the frame.",
    closer: "Move a little closer.",
    farther: "Move back a little.",
    center: "Center your face in the frame.",
    "face-camera": "Look at the screen, head straight.",
    hold: "Hold still…",
  },
  active: {
    nav: "Active liveness",
    align: "Place your face in the frame",
    alignSub: "Facing the screen, well lit. A random challenge from the server follows.",
    fetching: "Preparing the challenge…",
    ready: "Get ready",
    firstAction: "First: {action}",
    actions: {
      blink: "Blink",
      turn_head_left: "Turn your head left",
      turn_head_right: "Turn your head right",
      open_mouth: "Open your mouth",
      smile: "Smile",
    },
    actionSub: "Now, clearly, then face the screen again.",
    back: "Face the screen",
    nextAction: "Next: {action}",
    lightSub: "The screen changes colour: keep your face towards it.",
    capture: "Look at the screen",
    captureSub: "Relaxed face, head straight.",
    passed: "Liveness confirmed",
    passedSub: "Comparing with the chip photo…",
    failed: "Challenge not passed",
    retry: "Try again",
    continueWithout: "Continue without",
    unavailable: "Challenge unavailable",
    simpleSelfie: "Simple selfie",
    note: "TrueDepth camera",
    noteFailed: "active challenge failed, continued without",
    noteSkipped: "active challenge skipped",
    noteUnavailable: "active challenge unavailable",
    interrupted: "Face tracking was interrupted during the challenge.",
  },
  aboutFace: "Face comparison",
  aboutFaceDesc: "After the chip is read, a guided selfie is compared with the document photo (SFace, on the device).",
  procHead: "Verification in progress",
  procNote: "Everything is computed on device, against the embedded CSCA store.",
  procNoteOnline: "Computed on device, then confirmed by the KYC server (signed result).",
  procSteps: ["DG hashes ↔ SOD", "SOD signature (DSC)", "DSC ↔ CSCA chain", "Field consistency", "Face match"],
  expLabel: "Expires",
  tabFields: "Verified fields",
  tabChain: "PKI trust chain",
  tabAnomalies: "Anomalies",
  fieldsSub: "MRZ ↔ DG1 ↔ visual zone consistency, check digits and dates.",
  chainSub: "From the signed SOD up to the trusted CSCA.",
  anomSub: "The system does not simply block: it explains, with a severity per signal.",
  trustTitle: "Trust store",
  trustSub: "CSCA anchors embedded for offline operation.",
  syncNow: "Sync now",
  trustNote: "National Master Lists are verified against already-approved CSCAs — never self-bootstrapped.",
  shareTitle: "Signed result",
  shareSub: "PDF and JSON signed with ECDSA P-256. No biometric data is included.",
  sharePdf: "Export",
  verdicts: { authentic: "Authentic", suspicious: "Needs review", alert: "Rejected" },
  types: [
    { name: "Passport (ePassport)", format: "TD3" },
    { name: "ID card (eID)", format: "TD1" },
    { name: "Residence permit", format: "TD1 / TD2" },
  ],
  dgs: [
    { id: "DG1", label: "MRZ" },
    { id: "DG2", label: "Facial image" },
    { id: "DG14", label: "Security infos" },
    { id: "DG15", label: "Active Auth. key" },
    { id: "SOD", label: "Security object" },
  ],
  checks: {
    passive: ["Passive authentication", "DG hashes ↔ SOD · valid signature"],
    pkiOk: ["PKI trust chain", "ICAO PKD · high trust"],
    pkiWarn: ["PKI trust chain", "ICAO PKD · revocation not checked offline"],
    chip: ["Chip authenticity", "Active Authentication (ECDSA) valid"],
    fields: ["Field consistency", "12 checks · MRZ ↔ DG1 ↔ VIZ"],
    faceWarn: ["Face match", "Similarity 0.91 · passive liveness only"],
    faceNone: ["Face match", "Not requested — document-only check"],
    passiveFail: ["Passive authentication", "DG2 hash ↔ SOD mismatch"],
    pkiFail: ["PKI trust chain", "DSC absent from the CSCA store"],
    chipWarn: ["Chip authenticity", "Active Authentication unavailable (DG15 missing)"],
    faceFail: ["Face match", "Similarity 0.41 · below threshold"],
  },
  fields: [
    ["Surname", "MARTIN", "MRZ ↔ DG1 ↔ VIZ"],
    ["Given names", "CAMILLE ELISE", "MRZ ↔ DG1"],
    ["Nationality", "FRA", "consistent with issuing state"],
    ["Date of birth", "12/04/1991", "check digit · before issue date"],
    ["Document no.", "21FR34567", "check digit · TD3 format"],
    ["Date of expiry", "30/08/2031", "check digit · not expired"],
    ["Sex", "F", "expected format"],
  ],
  chain: [
    ["SOD", "valid", "LDSSecurityObject · SHA-256", "Every DG hash read matches the signed digest."],
    ["DSC", "valid", "CN=DS France 04, O=ANTS, C=FR", "Signed by the CSCA below. Valid until 14/02/2028."],
    ["CSCA", "high trust", "CN=CSCA France, C=FR", "ICAO PKD anchor, pinned at the last synchronisation."],
  ],
  chainAlert: [
    ["SOD", "invalid", "LDSSecurityObject · SHA-256", "The DG2 digest read from the chip does not match the signed one."],
    ["DSC", "not trusted", "CN=DS France 04, O=ANTS, C=FR", "Chains to no CSCA anchor in the embedded store."],
    ["CSCA", "not found", "—", "No matching anchor: the signature's origin is not established."],
  ],
  anomalies: {
    liveness: ["LIVENESS_PASSIVE_ONLY", "warning", 'Passive liveness only: never sufficient on its own for an automated "authentic" verdict. The verdict is downgraded to "needs review".'],
    revocation: ["REVOCATION_NOT_CHECKED", "warning", "No CRL retrieved in offline mode: the revocation status of the CSCA and DSC is unknown."],
    csca: ["CSCA_EXPIRING_SOON", "info", "The FRA CSCA expires in 74 days. Plan a trust store sync."],
    sodHash: ["SOD_HASH_MISMATCH", "critical", "The DG2 digest read from the chip does not match the one signed in the SOD: the photo was altered after issuance."],
    dscUnknown: ["DSC_NOT_TRUSTED", "critical", "The signing certificate chains to no CSCA anchor in the store. The signature's origin cannot be established."],
    faceMismatch: ["FACE_MATCH_BELOW_THRESHOLD", "warning", "Similarity 0.41 against a 0.75 threshold: the bearer does not match the chip photo."],
  },
  countriesTitle: "Supported countries",
  countriesSub: "CSCA anchors present in the embedded store.",
  searchPh: "Search a country",
  anchorsWord: "anchors",
  countriesEmpty: "No country matches this search.",
  cscaValidCount: "valid",
  cscaStatus: { valid: "Valid", future: "Not yet valid", expired: "Expired" },
  cscaLink: "link certificate",
  cscaKey: "Key",
  cscaSignature: "Signature",
  cscaSource: "Source",
  cscaSources: { "icao-pkd": "ICAO Master List", "national-pkd": "National Master List", "extended-trust-store": "Extended store" },
  cscaSerial: "Serial no.",
  cscaSubject: "Subject",
  cscaIssuer: "Issuer",
  cscaMore: "Tap for subject, issuer and fingerprint",
  countries: [
    ["FR", "🇫🇷", "France", 14],
    ["DE", "🇩🇪", "Germany", 12],
    ["BE", "🇧🇪", "Belgium", 9],
    ["ES", "🇪🇸", "Spain", 11],
    ["IT", "🇮🇹", "Italy", 10],
    ["PT", "🇵🇹", "Portugal", 8],
    ["NL", "🇳🇱", "Netherlands", 9],
    ["CH", "🇨🇭", "Switzerland", 7],
    ["GB", "🇬🇧", "United Kingdom", 13],
    ["MA", "🇲🇦", "Morocco", 6],
    ["DZ", "🇩🇿", "Algeria", 5],
    ["TN", "🇹🇳", "Tunisia", 5],
    ["SN", "🇸🇳", "Senegal", 4],
    ["CI", "🇨🇮", "Côte d'Ivoire", 4],
    ["CA", "🇨🇦", "Canada", 12],
    ["US", "🇺🇸", "United States", 15],
    ["AT", "🇦🇹", "Austria", 8],
    ["PL", "🇵🇱", "Poland", 9],
    ["SE", "🇸🇪", "Sweden", 8],
    ["NO", "🇳🇴", "Norway", 7],
    ["DK", "🇩🇰", "Denmark", 7],
    ["FI", "🇫🇮", "Finland", 6],
    ["IE", "🇮🇪", "Ireland", 7],
    ["LU", "🇱🇺", "Luxembourg", 5],
    ["CZ", "🇨🇿", "Czechia", 7],
    ["RO", "🇷🇴", "Romania", 8],
    ["GR", "🇬🇷", "Greece", 8],
    ["TR", "🇹🇷", "Türkiye", 10],
  ],
  verifiedLine: "Verified 21/09/2026 at 09:41 · offline · result signed ECDSA P-256 · nothing retained",
  verifiedLineOnline: "Verified 21/09/2026 at 09:41 · online · KYC · revocation checked · result signed ECDSA P-256 · nothing retained",
  aboutTagline: "Standalone verification of electronic identity documents.",
  aboutApp: [
    ["Version", "2.0 (214)"],
    ["Verification engine", "ICAO Doc 9303"],
    ["Protocols", "BAC · PACE · AA"],
  ],
  aboutStoreTitle: "CSCA store",
  aboutStoreCta: "Open the trust store",
  aboutFbTitle: "Feedback",
  aboutFb: "Sounds and haptics",
  aboutFbDesc: "NFC read steps, liveness and verdict.",
  aboutChecksTitle: "Required checks",
  aboutCrl: "Certificate revocation (CRL)",
  aboutCrlDesc:
    "The country's CRL is downloaded during a verification when needed (ICAO mirror, then the country's address), checked against the CSCA and kept for offline use. When on, no up-to-date CRL means “Needs review”.",
  aboutCrlCache: "Cached CRLs",
  aboutCrlCacheNone: "none yet",
  aboutLostStolen: "Lost/stolen documents registry",
  aboutLostStolenDesc: "Require a registry lookup (online only). When on without registry access, the result will be “Needs review”.",
  aboutServerTitle: "KYC server",
  aboutServer: "Server",
  aboutServerNone: "not configured",
  modeServerMissing: "No KYC server configured — tap to set one up.",
  srv: {
    title: "KYC server",
    sub: "Online, the chip data and the selfie are sent to this server, which returns a signed result: trust chain, revocation, lost/stolen registry and server-side face match, with an audit trail. Its signing key is pinned once you have checked its fingerprint.",
    url: "Server address",
    urlPh: "https://kyc.example.com",
    key: "KYC client API key",
    keyPh: "kyc_…",
    test: "Test connection",
    testing: "Connecting…",
    reachable: "Server reachable, API key accepted",
    resultKey: "Result signing key",
    bundleKey: "CSCA store signing key",
    noBundleKey: "not published (the embedded store stays in use)",
    keyChanged: "This key differs from the pinned one: accept it only if the server operator confirms the change.",
    pinHint: "Compare these fingerprints with the ones given by the server operator before pinning.",
    pin: "Fingerprints checked: pin and save",
    pinned: "Pinned on",
    forget: "Forget this server",
    queueTitle: "Queue",
    queueEmpty: "No verification waiting",
    syncNow: "Sync now",
    syncing: "Syncing…",
    cscaSync: "Update the CSCA store",
    cscaSyncing: "Updating…",
  },
  idCardLabels: { surname: "Surname", givenNames: "Given names", birth: "Date of birth", sex: "Sex", nationality: "Nationality", number: "Document no.", expiry: "Expires" },
  idDocTypes: { ePassport: "Passport", eID: "National identity card", eResidenceCard: "Residence permit" },
  aboutAppearanceTitle: "Appearance",
  aboutDarkMode: "Dark mode",
  aboutDarkModeDesc: "On by default. Camera screens stay dark.",
  aboutDock: "Dock effect",
  dockGlass: {
    native: "Native Liquid Glass (iOS 26)",
    noModule: "Imitation glass: native module missing from this build (pod install, then rebuild in Xcode)",
    oldSdk: "Imitation glass: app built with an Xcode older than Xcode 26",
    oldIos: "Imitation glass: this iPhone runs iOS {v}, Liquid Glass needs iOS 26",
  },
  aboutPrivacyTitle: "Privacy",
  aboutPrivacy:
    "Offline, everything is processed on device: no identity or biometric data is kept or transmitted (only public CRLs are downloaded). Online · KYC, the chip data and the selfie are sent to the KYC server configured in these Settings.",
  aboutLegalTitle: "Legal",
  aboutLegal: ["Terms of use", "Privacy policy", "Open source licences", "Legal notice"],
};

export type Lang = "fr" | "en";
export function copyFor(lang: Lang): Copy {
  return lang === "en" ? EN : FR;
}

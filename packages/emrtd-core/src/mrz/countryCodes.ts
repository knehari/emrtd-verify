/**
 * Codes pays : la MRZ et DG1 portent le code à 3 lettres de Doc 9303 Part 3 §5 (ISO 3166-1 alpha-3
 * plus quelques codes ICAO propres), alors que les certificats CSCA/DSC portent l'attribut X.509
 * C= à 2 lettres (ISO 3166-1 alpha-2). Sans normalisation, une CNI "FRA" ne retrouve jamais ses
 * CSCA "FR" (constaté sur une vraie carte). Table ISO générée depuis iso-codes (Debian), 249 pays.
 */
const ISO_ALPHA3_TO_ALPHA2: Record<string, string> = {
  ABW:"AW", AFG:"AF", AGO:"AO", AIA:"AI", ALA:"AX", ALB:"AL", AND:"AD", ARE:"AE", ARG:"AR", ARM:"AM",
  ASM:"AS", ATA:"AQ", ATF:"TF", ATG:"AG", AUS:"AU", AUT:"AT", AZE:"AZ", BDI:"BI", BEL:"BE", BEN:"BJ",
  BES:"BQ", BFA:"BF", BGD:"BD", BGR:"BG", BHR:"BH", BHS:"BS", BIH:"BA", BLM:"BL", BLR:"BY", BLZ:"BZ",
  BMU:"BM", BOL:"BO", BRA:"BR", BRB:"BB", BRN:"BN", BTN:"BT", BVT:"BV", BWA:"BW", CAF:"CF", CAN:"CA",
  CCK:"CC", CHE:"CH", CHL:"CL", CHN:"CN", CIV:"CI", CMR:"CM", COD:"CD", COG:"CG", COK:"CK", COL:"CO",
  COM:"KM", CPV:"CV", CRI:"CR", CUB:"CU", CUW:"CW", CXR:"CX", CYM:"KY", CYP:"CY", CZE:"CZ", DEU:"DE",
  DJI:"DJ", DMA:"DM", DNK:"DK", DOM:"DO", DZA:"DZ", ECU:"EC", EGY:"EG", ERI:"ER", ESH:"EH", ESP:"ES",
  EST:"EE", ETH:"ET", FIN:"FI", FJI:"FJ", FLK:"FK", FRA:"FR", FRO:"FO", FSM:"FM", GAB:"GA", GBR:"GB",
  GEO:"GE", GGY:"GG", GHA:"GH", GIB:"GI", GIN:"GN", GLP:"GP", GMB:"GM", GNB:"GW", GNQ:"GQ", GRC:"GR",
  GRD:"GD", GRL:"GL", GTM:"GT", GUF:"GF", GUM:"GU", GUY:"GY", HKG:"HK", HMD:"HM", HND:"HN", HRV:"HR",
  HTI:"HT", HUN:"HU", IDN:"ID", IMN:"IM", IND:"IN", IOT:"IO", IRL:"IE", IRN:"IR", IRQ:"IQ", ISL:"IS",
  ISR:"IL", ITA:"IT", JAM:"JM", JEY:"JE", JOR:"JO", JPN:"JP", KAZ:"KZ", KEN:"KE", KGZ:"KG", KHM:"KH",
  KIR:"KI", KNA:"KN", KOR:"KR", KWT:"KW", LAO:"LA", LBN:"LB", LBR:"LR", LBY:"LY", LCA:"LC", LIE:"LI",
  LKA:"LK", LSO:"LS", LTU:"LT", LUX:"LU", LVA:"LV", MAC:"MO", MAF:"MF", MAR:"MA", MCO:"MC", MDA:"MD",
  MDG:"MG", MDV:"MV", MEX:"MX", MHL:"MH", MKD:"MK", MLI:"ML", MLT:"MT", MMR:"MM", MNE:"ME", MNG:"MN",
  MNP:"MP", MOZ:"MZ", MRT:"MR", MSR:"MS", MTQ:"MQ", MUS:"MU", MWI:"MW", MYS:"MY", MYT:"YT", NAM:"NA",
  NCL:"NC", NER:"NE", NFK:"NF", NGA:"NG", NIC:"NI", NIU:"NU", NLD:"NL", NOR:"NO", NPL:"NP", NRU:"NR",
  NZL:"NZ", OMN:"OM", PAK:"PK", PAN:"PA", PCN:"PN", PER:"PE", PHL:"PH", PLW:"PW", PNG:"PG", POL:"PL",
  PRI:"PR", PRK:"KP", PRT:"PT", PRY:"PY", PSE:"PS", PYF:"PF", QAT:"QA", REU:"RE", ROU:"RO", RUS:"RU",
  RWA:"RW", SAU:"SA", SDN:"SD", SEN:"SN", SGP:"SG", SGS:"GS", SHN:"SH", SJM:"SJ", SLB:"SB", SLE:"SL",
  SLV:"SV", SMR:"SM", SOM:"SO", SPM:"PM", SRB:"RS", SSD:"SS", STP:"ST", SUR:"SR", SVK:"SK", SVN:"SI",
  SWE:"SE", SWZ:"SZ", SXM:"SX", SYC:"SC", SYR:"SY", TCA:"TC", TCD:"TD", TGO:"TG", THA:"TH", TJK:"TJ",
  TKL:"TK", TKM:"TM", TLS:"TL", TON:"TO", TTO:"TT", TUN:"TN", TUR:"TR", TUV:"TV", TWN:"TW", TZA:"TZ",
  UGA:"UG", UKR:"UA", UMI:"UM", URY:"UY", USA:"US", UZB:"UZ", VAT:"VA", VCT:"VC", VEN:"VE", VGB:"VG",
  VIR:"VI", VNM:"VN", VUT:"VU", WLF:"WF", WSM:"WS", YEM:"YE", ZAF:"ZA", ZMB:"ZM", ZWE:"ZW",
};

/** Codes propres à Doc 9303 (Part 3 §5) qui ne sont pas des alpha-3 ISO. */
const ICAO_SPECIAL_CODES: Record<string, string> = {
  D: "DE", // Allemagne (code historique d'une lettre)
  GBD: "GB", GBN: "GB", GBO: "GB", GBP: "GB", GBS: "GB", // catégories de nationalité britannique
  RKS: "XK", // Kosovo
  EUE: "EU", // Union européenne (laissez-passer)
};

/**
 * Alpha-2 non ISO rencontrés dans l'attribut C de CSCA réels : le Kosovo signe avec C=KS (Master
 * Lists ICAO et BSI) alors que XK est le code d'usage (RKS en MRZ).
 */
const ALPHA2_ALIASES: Record<string, string> = { KS: "XK" };

/**
 * Code pays à 2 lettres (clé de rapprochement avec les CSCA) depuis un code MRZ (alpha-3, "D", …),
 * un alpha-2 déjà normalisé, ou `undefined` si inconnu (organisations internationales : UNO, XOM…).
 * Insensible aux '<' de bourrage MRZ et à la casse.
 */
export function toAlpha2CountryCode(code: string): string | undefined {
  const normalized = code.replace(/</g, "").trim().toUpperCase();
  if (normalized.length === 2) return ALPHA2_ALIASES[normalized] ?? normalized;
  return ICAO_SPECIAL_CODES[normalized] ?? ISO_ALPHA3_TO_ALPHA2[normalized];
}

/** Vrai si deux codes (MRZ ou X.509, 2 ou 3 lettres) désignent le même État. */
export function sameCountry(a: string, b: string): boolean {
  const clean = (code: string) => code.replace(/</g, "").trim().toUpperCase();
  if (clean(a) === clean(b)) return true; // y compris les codes sans équivalent alpha-2 (UTO de Doc 9303…)
  const a2 = toAlpha2CountryCode(a);
  return a2 !== undefined && a2 === toAlpha2CountryCode(b);
}

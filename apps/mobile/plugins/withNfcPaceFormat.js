// Les CNI françaises émises depuis 2021 (et d'autres cartes d'identité européennes) n'acceptent que
// PACE : sur iOS 16+, Core NFC ne les signale à l'app que si la session interroge avec l'option
// `NFCPollingPACE` (voir patches/react-native-nfc-manager@3.17.2.patch), ce qui exige la valeur
// "PACE" dans l'entitlement com.apple.developer.nfc.readersession.formats — sinon la session est
// refusée ("Missing required entitlement"). Le profil de provisionnement de la capacité "NFC Tag
// Reading" l'autorise déjà (formats = NDEF, TAG, PACE) ; le plugin de react-native-nfc-manager
// n'ajoute que TAG. Constaté sur l'appareil de l'utilisateur : une CNI lisible par ReadID Me
// n'était jamais détectée sans ce format.
const { withEntitlementsPlist } = require("expo/config-plugins");

const KEY = "com.apple.developer.nfc.readersession.formats";

function withNfcPaceFormat(config) {
  return withEntitlementsPlist(config, (config) => {
    const formats = new Set(config.modResults[KEY] ?? []);
    formats.add("TAG");
    formats.add("PACE");
    config.modResults[KEY] = [...formats];
    return config;
  });
}

module.exports = withNfcPaceFormat;

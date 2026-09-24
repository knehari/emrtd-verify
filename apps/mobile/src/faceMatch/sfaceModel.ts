/**
 * Chargement unique du modèle SFace (`services/face-match/models/sface.onnx`, le même fichier que le
 * service serveur, empreinte dans son README) dans onnxruntime-react-native. Metro l'embarque comme
 * ressource (`assetExts` += "onnx", voir metro.config.js) ; expo-asset en donne le chemin local —
 * en build de développement, il est d'abord téléchargé depuis Metro (~37 Mo, une fois).
 */
import { Asset } from "expo-asset";
import { createSfaceSession } from "./sfaceSession";
import type { OnnxSessionLike } from "./embedding";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SFACE_MODEL = require("../../../../services/face-match/models/sface.onnx");

let sessionPromise: Promise<OnnxSessionLike> | null = null;

export function getSfaceSession(): Promise<OnnxSessionLike> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const [asset] = await Asset.loadAsync(SFACE_MODEL);
      const uri = asset.localUri ?? asset.uri;
      // onnxruntime attend un chemin de fichier, pas une URI.
      const path = decodeURIComponent(uri.replace(/^file:\/\//, ""));
      return createSfaceSession(path);
    })();
    // Un échec (réseau Metro coupé…) ne doit pas bloquer les tentatives suivantes.
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

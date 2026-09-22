/**
 * Adaptateur de production pour `embedding.ts` : passe-plat trivial autour d'`onnxruntime-react-native`
 * (bibliothèque déjà publiée, largement utilisée, dont l'API `InferenceSession`/`Tensor` implémente
 * `onnxruntime-common` — même interface que `onnxruntime-node`, utilisé dans les tests pour exécuter
 * le VRAI modèle `sface.onnx`, voir test/faceMatch/embedding.test.ts) — même discipline que
 * `nfc/emrtdReader.ts` `isoDepHandler.transceive` (passe-plat autour de `react-native-nfc-manager`).
 * N'ajoute AUCUNE logique propre : `embedding.ts` reste le seul endroit où le prétraitement/la
 * lecture de sortie sont définis et vérifiés.
 */
import { InferenceSession, Tensor } from "onnxruntime-react-native";
import type { OnnxSessionLike, TensorConstructorLike } from "./embedding";

export async function createSfaceSession(modelPath: string): Promise<OnnxSessionLike> {
  const session = await InferenceSession.create(modelPath);
  return {
    run: async (feeds) => (await session.run(feeds as Record<string, InstanceType<typeof Tensor>>)) as never,
  };
}

export const SfaceTensor = Tensor as unknown as TensorConstructorLike;

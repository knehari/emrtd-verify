"""Moteur partagé de détection et d'extraction de caractéristiques faciales.

Utilisé par `app/matcher.py` (comparaison) et `app/liveness.py` (vérification qu'une
image contient exactement un visage). Enveloppe fine autour de deux modèles ONNX
exécutés localement via `cv2.dnn` (OpenCV) — aucun appel réseau, aucune donnée
envoyée à un tiers :

- **Détection** : YuNet (`models/yunet.onnx`), détecteur de visages léger.
- **Embedding** : SFace (`models/sface.onnx`), extraction d'un vecteur de
  caractéristiques (128 dimensions) pour la reconnaissance faciale.

Les deux modèles proviennent du dépôt OpenCV Zoo (Apache License 2.0) — voir
`models/README.md` pour la provenance exacte et les empreintes SHA-256, et
`docs/facial-recognition.md` pour les limites connues du modèle.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
YUNET_MODEL_PATH = _MODELS_DIR / "yunet.onnx"
SFACE_MODEL_PATH = _MODELS_DIR / "sface.onnx"

# Seuil de confiance de détection appliqué par YuNet lui-même (avant tout usage
# de la détection par le matcher ou le module de liveness).
DETECTION_SCORE_THRESHOLD = 0.8


@dataclass
class DetectedFace:
    embedding: np.ndarray  # vecteur (128,) float32 issu de SFace
    confidence: float


def _pil_to_bgr(image: Image.Image) -> np.ndarray:
    """Convertit une image PIL (n'importe quel mode) en tableau BGR uint8, format
    attendu par les modèles OpenCV utilisés ici."""
    rgb = np.array(image.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


class FaceEngine:
    """Charge les modèles ONNX une seule fois et les réutilise pour chaque requête."""

    def __init__(self) -> None:
        if not YUNET_MODEL_PATH.exists() or not SFACE_MODEL_PATH.exists():
            raise FileNotFoundError(
                "Modèles de visage introuvables sous services/face-match/models/ "
                "(yunet.onnx / sface.onnx) — voir docs/facial-recognition.md et "
                "models/README.md pour se les procurer."
            )
        self._detector = cv2.FaceDetectorYN_create(
            str(YUNET_MODEL_PATH), "", (0, 0), score_threshold=DETECTION_SCORE_THRESHOLD
        )
        self._recognizer = cv2.FaceRecognizerSF_create(str(SFACE_MODEL_PATH), "")

    def detect_faces(self, image: Image.Image) -> list[DetectedFace]:
        """Détecte les visages présents dans `image` et retourne, pour chacun,
        son embedding SFace et le score de confiance de la détection.

        Retourne une liste vide si aucun visage n'est détecté (image illisible,
        pas de visage, image trop dégradée) — ce n'est jamais une erreur en soi,
        c'est à l'appelant (matcher / liveness) de décider comment le traiter.
        """
        bgr = _pil_to_bgr(image)
        height, width = bgr.shape[:2]
        if width == 0 or height == 0:
            return []

        self._detector.setInputSize((width, height))
        _, faces = self._detector.detect(bgr)
        if faces is None:
            return []

        detected: list[DetectedFace] = []
        for face_row in faces:
            aligned = self._recognizer.alignCrop(bgr, face_row)
            feature = self._recognizer.feature(aligned)
            detected.append(DetectedFace(embedding=feature.reshape(-1), confidence=float(face_row[-1])))
        return detected


_engine: FaceEngine | None = None


def get_face_engine() -> FaceEngine:
    """Retourne l'instance partagée de `FaceEngine`, en la créant (et donc en
    chargeant les modèles) au premier appel seulement."""
    global _engine
    if _engine is None:
        _engine = FaceEngine()
    return _engine

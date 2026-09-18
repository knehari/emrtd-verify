"""Détection de vivacité (liveness) — voir docs/facial-recognition.md.

Implémentation passive par une seule image, fondée sur des heuristiques de
qualité d'image, PAS sur une détection anti-spoofing au sens propre :

- résolution minimale de l'image ;
- netteté (variance du Laplacien) — une image trop floue est rejetée ;
- exactement un visage détecté avec une confiance suffisante (voir
  `app/face_engine.py`) — zéro visage ou plusieurs visages sont rejetés.

Ce que cette implémentation NE détecte PAS : une photo imprimée de bonne
qualité tenue devant la caméra, un écran rejoué (replay), un masque, une
attaque par deepfake. Un mode de liveness active (challenge de mouvement ou de
clignement) reste nécessaire pour les clients KYC à politique de risque plus
stricte — voir docs/facial-recognition.md et docs/threat-model.md #6. Ne pas
présenter ce module comme une protection anti-spoofing forte.
"""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

from .face_engine import get_face_engine

MIN_WIDTH_PX = 80
MIN_HEIGHT_PX = 80
# Variance du Laplacien en dessous de laquelle une image est considérée trop
# floue pour être exploitable. Valeur de départ empirique (voir
# docs/facial-recognition.md) — à recalibrer sur des captures réelles du
# parcours KYC visé avant tout déploiement en production.
BLUR_VARIANCE_THRESHOLD = 15.0


class LivenessResult:
    def __init__(self, passed: bool, warnings: list[str]):
        self.passed = passed
        self.warnings = warnings


def _blur_variance(probe_image: Image.Image) -> float | None:
    """Variance du Laplacien de l'image en niveaux de gris — plus la valeur est
    basse, plus l'image est floue. Retourne None si la variance ne peut pas être
    calculée (image dégénérée, ex. 0 pixel)."""
    grayscale = np.array(probe_image.convert("L"))
    if grayscale.size == 0:
        return None
    return float(cv2.Laplacian(grayscale, cv2.CV_64F).var())


def check_liveness(probe_image: Image.Image) -> LivenessResult:
    warnings: list[str] = []

    width, height = probe_image.size
    if width < MIN_WIDTH_PX or height < MIN_HEIGHT_PX:
        warnings.append("image_resolution_too_low")

    variance = _blur_variance(probe_image)
    if variance is None or variance < BLUR_VARIANCE_THRESHOLD:
        warnings.append("image_too_blurry")

    faces = get_face_engine().detect_faces(probe_image)
    if not faces:
        warnings.append("no_face_detected")
    elif len(faces) > 1:
        warnings.append("multiple_faces_detected")

    return LivenessResult(passed=not warnings, warnings=warnings)

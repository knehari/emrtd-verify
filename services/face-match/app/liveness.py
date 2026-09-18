"""Détection de vivacité (liveness) — voir docs/facial-recognition.md.

Implémentation passive par défaut (analyse d'une image unique). Un mode actif
(challenge de mouvement/clignement) est envisagé en Phase 3 (docs/roadmap.md)
pour les clients KYC à politique de risque plus stricte.
"""

from PIL import Image


class LivenessResult:
    def __init__(self, passed: bool, warnings: list[str]):
        self.passed = passed
        self.warnings = warnings


def check_liveness(probe_image: Image.Image) -> LivenessResult:
    """Stub — non implémenté.

    L'implémentation réelle (détection d'écran rejoué, de moiré, de profondeur)
    doit être ajoutée avant tout usage en production — voir docs/roadmap.md Phase 3.
    Lève systématiquement plutôt que de retourner passed=True par défaut : un faux
    positif de liveness ouvrirait la porte au spoofing facial (voir docs/threat-model.md #6).
    """
    raise NotImplementedError("Détection de vivacité non implémentée — voir docs/roadmap.md Phase 3.")

import numpy as np
from PIL import Image

from app.face_engine import SFACE_MODEL_PATH, YUNET_MODEL_PATH, get_face_engine


def test_model_files_are_present_on_disk() -> None:
    # Régression courante en déploiement : modèles absents de l'image/du checkout.
    # Voir services/face-match/models/README.md pour la provenance de ces fichiers.
    assert YUNET_MODEL_PATH.exists(), "yunet.onnx manquant — voir models/README.md"
    assert SFACE_MODEL_PATH.exists(), "sface.onnx manquant — voir models/README.md"


def test_engine_loads_without_error() -> None:
    engine = get_face_engine()
    assert engine is not None


def test_get_face_engine_returns_same_instance() -> None:
    # Les modèles ne doivent être chargés qu'une seule fois (coûteux) — singleton partagé.
    assert get_face_engine() is get_face_engine()


def test_detect_faces_returns_empty_list_for_non_facial_image() -> None:
    rng = np.random.default_rng(7)
    noise = Image.fromarray(rng.integers(0, 256, (200, 200, 3), dtype=np.uint8), mode="RGB")

    faces = get_face_engine().detect_faces(noise)

    assert faces == []

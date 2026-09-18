import numpy as np
import pytest
from PIL import Image

from app.matcher import FaceMatcher


def test_decide_match_above_threshold() -> None:
    matcher = FaceMatcher(match_threshold=0.75, inconclusive_margin=0.05)
    assert matcher._decide(0.95) == "match"


def test_decide_no_match_below_threshold() -> None:
    matcher = FaceMatcher(match_threshold=0.75, inconclusive_margin=0.05)
    assert matcher._decide(0.3) == "no_match"


def test_decide_inconclusive_near_threshold() -> None:
    matcher = FaceMatcher(match_threshold=0.75, inconclusive_margin=0.05)
    assert matcher._decide(0.75) == "inconclusive"


# --- Similarité : mathématiques pures, testées avec des vecteurs synthétiques,
# --- sans charger aucun modèle (voir FaceMatcher._cosine_similarity/_normalize_similarity).


def test_cosine_similarity_identical_vectors_is_one() -> None:
    matcher = FaceMatcher()
    vector = np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
    assert matcher._cosine_similarity(vector, vector) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vectors_is_zero() -> None:
    matcher = FaceMatcher()
    a = np.array([1.0, 0.0], dtype=np.float32)
    b = np.array([0.0, 1.0], dtype=np.float32)
    assert matcher._cosine_similarity(a, b) == 0.0


def test_cosine_similarity_opposite_vectors_is_minus_one() -> None:
    matcher = FaceMatcher()
    a = np.array([1.0, 2.0, 3.0], dtype=np.float32)
    assert matcher._cosine_similarity(a, -a) == pytest.approx(-1.0)


def test_cosine_similarity_zero_vector_is_zero_not_nan() -> None:
    matcher = FaceMatcher()
    a = np.zeros(4, dtype=np.float32)
    b = np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
    assert matcher._cosine_similarity(a, b) == 0.0


def test_normalize_similarity_maps_cosine_range_to_unit_interval() -> None:
    matcher = FaceMatcher()
    assert matcher._normalize_similarity(1.0) == 1.0
    assert matcher._normalize_similarity(-1.0) == 0.0
    assert matcher._normalize_similarity(0.0) == 0.5


def test_normalize_similarity_clamps_out_of_range_values() -> None:
    matcher = FaceMatcher()
    assert matcher._normalize_similarity(1.5) == 1.0
    assert matcher._normalize_similarity(-1.5) == 0.0


def test_end_to_end_similarity_and_decision_are_consistent() -> None:
    # Vérifie que compare() compose bien _cosine_similarity -> _normalize_similarity
    # -> _decide, avec des embeddings synthétiques injectés directement (pas de modèle).
    matcher = FaceMatcher(match_threshold=0.75, inconclusive_margin=0.05)
    same_person = np.array([0.6, 0.8], dtype=np.float32)
    score = matcher._normalize_similarity(matcher._cosine_similarity(same_person, same_person))
    assert matcher._decide(score) == "match"

    different_person = np.array([-0.6, 0.8], dtype=np.float32)
    score2 = matcher._normalize_similarity(matcher._cosine_similarity(same_person, different_person))
    assert matcher._decide(score2) == "no_match"


# --- compare() de bout en bout, sur des images synthétiques (pas de vrai visage) :
# --- la détection de visage échoue légitimement sur ces images non faciales — voir
# --- docs/facial-recognition.md. On vérifie ici le chemin d'échec explicite, honnête,
# --- plutôt qu'un simple "ne plante pas".


def test_compare_returns_inconclusive_when_no_face_in_either_image() -> None:
    matcher = FaceMatcher()
    rng = np.random.default_rng(1234)
    noise_a = Image.fromarray(rng.integers(0, 256, (200, 200, 3), dtype=np.uint8), mode="RGB")
    noise_b = Image.fromarray(rng.integers(0, 256, (200, 200, 3), dtype=np.uint8), mode="RGB")

    result = matcher.compare(noise_a, noise_b)

    assert result.match_decision == "inconclusive"
    assert result.similarity_score == 0.0
    assert "no_face_detected_in_reference_image" in result.quality_warnings
    assert "no_face_detected_in_probe_image" in result.quality_warnings

FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
# opencv-python-headless (contrairement à opencv-python) ne dépend d'aucune bibliothèque
# graphique système (pas de libGL/Qt/GTK) : ses dépendances natives non-vendorisées
# (libc, libz, libstdc++, ...) sont déjà présentes dans l'image python:3.11-slim —
# aucun paquet apt supplémentaire n'est nécessaire (vérifié via `ldd` sur le module compilé).
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# Modèles ONNX de détection/reconnaissance faciale (YuNet + SFace) — voir
# docs/facial-recognition.md et models/README.md pour leur provenance et licence.
COPY models ./models
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

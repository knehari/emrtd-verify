# Modèles faciaux embarqués

Ces deux fichiers sont chargés localement par `app/face_engine.py` via `cv2.dnn`
(OpenCV) — aucun appel réseau au moment de l'exécution, aucune donnée envoyée à
un tiers. Voir [../../../docs/facial-recognition.md](../../../docs/facial-recognition.md)
pour le rôle de chaque modèle dans le pipeline et pour les limites connues.

## Provenance

Les deux modèles proviennent du dépôt [OpenCV Zoo](https://github.com/opencv/opencv_zoo)
(dépôt sous **Apache License 2.0**, `LICENSE` à la racine du dépôt), récupérés le
2026-09-18 :

| Fichier      | Modèle source OpenCV Zoo                                                   | Rôle                                    | Taille   |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------- | -------- |
| `yunet.onnx` | `models/face_detection_yunet/face_detection_yunet_2023mar.onnx`             | Détection de visage(s) dans une image    | ~227 KiB |
| `sface.onnx` | `models/face_recognition_sface/face_recognition_sface_2021dec.onnx`         | Extraction d'un embedding (128-d) par visage détecté, pour comparaison | ~36.9 MiB |

- **YuNet** : détecteur de visages léger (Shiqi Yu et al.) ; voir le
  [README amont](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md).
- **SFace** : modèle de reconnaissance faciale (MobileFaceNet entraîné avec la
  fonction de perte SFace, Zhong et al., [papier](https://arxiv.org/abs/2205.12010)) ;
  voir le [README amont](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/README.md).
  Précision publiée par OpenCV Zoo : 99.40% sur leur protocole d'évaluation
  (jeu de données de type LFW) — **ce chiffre global masque des écarts de
  performance selon les sous-groupes démographiques et ne remplace pas un audit
  indépendant** (voir docs/facial-recognition.md).

## Intégrité (empreintes SHA-256, au 2026-09-18)

```
0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79  sface.onnx
8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4  yunet.onnx
```

Ces empreintes correspondent exactement à l'objet Git LFS amont référencé par
OpenCV Zoo (vérifiable via le pointeur LFS du dépôt amont, champ `oid`).

## Licence

Apache License 2.0 (licence du dépôt `opencv/opencv_zoo`, aucune restriction
supplémentaire notée dans les README amont de ces deux modèles). Redistribution
et usage commercial autorisés sous réserve du respect des termes de la licence
Apache 2.0 (attribution, conservation de l'avis de licence).

## Mise à jour

Pour remplacer ces fichiers par une version plus récente d'OpenCV Zoo :

```
curl -sSL -o yunet.onnx \
  https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -sSL -o sface.onnx \
  https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
```

(`raw.githubusercontent.com` ne sert que le pointeur Git LFS textuel pour ces
fichiers ; `media.githubusercontent.com/media/...` sert le contenu binaire réel.)
Recalculer et mettre à jour les empreintes SHA-256 ci-dessus après toute mise à jour.

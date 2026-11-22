"""Server-side face registration for uploaded People Information images.

Uses the same OpenCV YuNet (detection) and SFace (recognition) models as the camera
station, with the same alignment and L2 normalisation, so encodings created here are
interchangeable with the ones the station creates.

Run `python backend/face_enrollment.py` during server setup to download and validate the models.
"""

import math
import os
import shutil
import threading
import urllib.request
from pathlib import Path

MODEL_DIRECTORY = Path(
    os.environ.get("SMART_LIBRARY_MODEL_DIR") or (Path(__file__).resolve().parent / "models")
)
MODEL_URLS = {
    "face_detection_yunet_2023mar.onnx": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx"
    ),
    "face_recognition_sface_2021dec.onnx": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
        "face_recognition_sface/face_recognition_sface_2021dec.onnx"
    ),
}
MIN_MODEL_BYTES = {
    "face_detection_yunet_2023mar.onnx": 200_000,
    "face_recognition_sface_2021dec.onnx": 30_000_000,
}
MAX_SIDE = 1280  # keeps memory use low on small servers
ENCODING_SIZE = 128


class FaceImageError(ValueError):
    """The image itself cannot be registered (no face, several faces, unreadable)."""


class FaceEngineUnavailable(RuntimeError):
    """OpenCV or the models are not available on this server."""


_lock = threading.Lock()
_engine = None


def _is_valid_model(path, minimum_size):
    if not path.is_file() or path.stat().st_size < minimum_size:
        return False
    with path.open("rb") as model_file:
        return not model_file.read(64).startswith(b"version https://git-lfs.github.com/spec/v1")


def ensure_models(download=True, force_download=False):
    MODEL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, url in MODEL_URLS.items():
        path = MODEL_DIRECTORY / name
        if force_download or not _is_valid_model(path, MIN_MODEL_BYTES[name]):
            if not download:
                raise FaceEngineUnavailable(f"Face model {name} is missing.")
            temporary = path.with_suffix(".download")
            try:
                request = urllib.request.Request(
                    url, headers={"User-Agent": "SmartLibraryFaceEnrollment/1.0"}
                )
                with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
                    shutil.copyfileobj(response, output)
                if not _is_valid_model(temporary, MIN_MODEL_BYTES[name]):
                    raise FaceEngineUnavailable(f"Downloaded {name} is incomplete.")
                temporary.replace(path)
            except FaceEngineUnavailable:
                temporary.unlink(missing_ok=True)
                raise
            except Exception as error:  # network, DNS, disk
                temporary.unlink(missing_ok=True)
                raise FaceEngineUnavailable(f"Could not download {name}: {error}") from error
        paths[name] = path
    return paths


def _create_engine(cv2, paths):
    try:
        detector = cv2.FaceDetectorYN.create(
            str(paths["face_detection_yunet_2023mar.onnx"]), "", (320, 320), 0.7, 0.3, 5000
        )
        recognizer = cv2.FaceRecognizerSF.create(
            str(paths["face_recognition_sface_2021dec.onnx"]), ""
        )
    except cv2.error as error:
        raise FaceEngineUnavailable("The face-recognition models could not be loaded.") from error
    if detector is None or recognizer is None:
        raise FaceEngineUnavailable("OpenCV could not initialize the face-recognition models.")
    return cv2, detector, recognizer


def _load_engine():
    global _engine
    if _engine is not None:
        return _engine
    try:
        import cv2
        import numpy  # noqa: F401
    except ImportError as error:
        raise FaceEngineUnavailable("OpenCV is not installed on the server.") from error
    paths = ensure_models()
    try:
        _engine = _create_engine(cv2, paths)
    except FaceEngineUnavailable:
        paths = ensure_models(force_download=True)
        _engine = _create_engine(cv2, paths)
    return _engine


def engine_available():
    try:
        with _lock:
            _load_engine()
        return True
    except FaceEngineUnavailable:
        return False


def encode_face_image(image_bytes):
    """Return a normalised 128-value face encoding for an image containing one face."""
    with _lock:
        cv2, detector, recognizer = _load_engine()
        import numpy as np

        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise FaceImageError("The image could not be read. Choose a valid PNG, JPEG, GIF, or WebP image.")
        height, width = image.shape[:2]
        largest = max(height, width)
        if largest > MAX_SIDE:
            scale = MAX_SIDE / largest
            image = cv2.resize(
                image, (max(1, int(width * scale)), max(1, int(height * scale))), interpolation=cv2.INTER_AREA
            )
            height, width = image.shape[:2]

        detector.setInputSize((width, height))
        _, faces = detector.detect(image)
        if faces is None or len(faces) == 0:
            raise FaceImageError(
                "No face was detected. Use a clear, front-facing photo with the face fully visible."
            )
        if len(faces) > 1:
            raise FaceImageError(
                f"Detected {len(faces)} faces. Use a photo containing only one person."
            )
        aligned = recognizer.alignCrop(image, faces[0])
        embedding = recognizer.feature(aligned).reshape(-1).astype(np.float32)

    values = [float(value) for value in embedding]
    if len(values) != ENCODING_SIZE or not all(math.isfinite(value) for value in values):
        raise FaceImageError("The face model returned an invalid encoding. Try a different photo.")
    magnitude = math.sqrt(sum(value * value for value in values))
    if magnitude < 0.000001:
        raise FaceImageError("The face model returned an empty encoding. Try a different photo.")
    return [value / magnitude for value in values]


if __name__ == "__main__":
    # Build-time hook: failing to download must not fail the whole deploy; the backend then
    # falls back to leaving faces pending for the camera station, as before.
    try:
        with _lock:
            _load_engine()
        print("Face models ready in", MODEL_DIRECTORY)
    except FaceEngineUnavailable as error:
        print("WARNING:", error)

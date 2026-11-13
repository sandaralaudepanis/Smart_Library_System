"""Measure how fast this Raspberry Pi can detect and recognize faces with the station's own code.

Run it BEFORE relying on the station (stop the service first so the camera is free):
    sudo systemctl stop smart-library-station
    cd ~/smart-library/face_recognition_iot
    .venv/bin/python raspberry_pi/speedtest.py          # 30 seconds
    .venv/bin/python raspberry_pi/speedtest.py 60       # custom seconds

Stand in front of the camera for the whole test so a face is found in most frames.
Nothing is sent to the server and nothing is saved.
"""

import statistics
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from camera import Camera  # noqa: E402
from face_recognition import FaceRecognizer  # noqa: E402
from models import ensure_models  # noqa: E402


def available_memory_mb():
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except OSError:
        pass
    return None


def cpu_temperature():
    try:
        return subprocess.run(
            ["vcgencmd", "measure_temp"], capture_output=True, text=True, timeout=3
        ).stdout.strip()
    except Exception:
        return "unknown"


def median_ms(values):
    return round(statistics.median(values) * 1000) if values else None


def main():
    seconds = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    models = ensure_models()
    recognizer = FaceRecognizer(
        models["face_detection_yunet_2023mar.onnx"],
        models["face_recognition_sface_2021dec.onnx"],
    )
    camera = Camera(0)
    detect_times, encode_times = [], []
    frames = faces_found = 0
    try:
        time.sleep(1.0)  # let exposure settle
        print(f"Testing for {seconds} seconds. Stand in front of the camera...")
        start = time.monotonic()
        while time.monotonic() - start < seconds:
            frame = camera.read()
            if frame is None:
                continue
            frames += 1
            t0 = time.perf_counter()
            faces = recognizer.detector.detect(frame)
            detect_times.append(time.perf_counter() - t0)
            if faces:
                faces_found += 1
                t1 = time.perf_counter()
                try:
                    recognizer.encode_face(frame, faces[0])
                except ValueError:
                    continue
                encode_times.append(time.perf_counter() - t1)
        elapsed = time.monotonic() - start
    finally:
        camera.close()

    print()
    print(f"Frames processed:       {frames} in {elapsed:.0f} s ({frames / elapsed:.1f} frames/s, detection only)")
    print(f"Frames with a face:     {faces_found}")
    print(f"Detect time (median):   {median_ms(detect_times)} ms")
    print(f"Encode time (median):   {median_ms(encode_times)} ms")
    print(f"Free memory:            {available_memory_mb()} MB")
    print(f"CPU temperature:        {cpu_temperature()}")
    print()
    if not encode_times:
        print("No face was found. Face the camera in good light and run the test again.")
        return
    total = statistics.median(detect_times) + statistics.median(encode_times)
    # The station encodes every 5th frame, so a full recognition costs about this long per attempt.
    print(f"One full recognition:   about {round(total * 1000)} ms")
    # These cut-offs are rough rules of thumb, not measured limits.
    if total < 0.6:
        print("Result: should feel responsive for attendance scanning.")
    elif total < 1.2:
        print("Result: usable, but expect about a second of delay after a person faces the camera.")
    else:
        print("Result: slow. Send me these numbers; the station may need a lighter setup or a Pi 4/5.")


if __name__ == "__main__":
    main()

"""Model format conversion utility.

Converts uploaded ML model files between formats so they can be loaded by the
detector matching the user's hardware. Each conversion runs in a subprocess so
that an exception (segfault, OOM, missing CUDA, etc.) doesn't take down the
FastAPI worker.

Supported source formats are detected from the file extension and magic bytes:
  .pt / .pth  → PyTorch state dict or scripted module
  .onnx       → ONNX
  .h5 / .pb   → TensorFlow / Keras
  .tflite     → TFLite
  .engine     → TensorRT (passthrough only; cannot re-target)

Supported target detector types (mapped to a canonical output format):
  edgetpu  → int8 .tflite with edgetpu_compiler suffix applied if available
  tensorrt → .engine via trtexec
  openvino → IR pair (.xml + .bin) via openvino-dev `mo`
  onnx     → .onnx (used by cpu, rocm, zmq, generic ONNX detectors)
  cpu      → .onnx
  rknn     → .rknn (requires rknn-toolkit2; stubbed)
  hailo8   → .hef (requires Hailo SDK; stubbed)

Any conversion that requires a SDK we cannot ship returns a clear error
explaining which package is missing. The frontend surfaces that error so the
user knows what to install.
"""

from __future__ import annotations

import enum
import logging
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, Optional

from frigate.const import MODEL_CACHE_DIR

logger = logging.getLogger(__name__)

# Magic bytes for source-format detection — extension alone is not trustworthy.
ONNX_MAGIC = b"\x08"  # protobuf field tag; ONNX files start with this
TFLITE_MAGIC = b"TFL3"  # at byte offset 4
HDF5_MAGIC = b"\x89HDF"


class SourceFormat(str, enum.Enum):
    pytorch = "pytorch"
    onnx = "onnx"
    tensorflow_saved = "tf_saved"
    keras_h5 = "keras_h5"
    tflite = "tflite"
    tensorrt_engine = "tensorrt"
    unknown = "unknown"


class TargetFormat(str, enum.Enum):
    onnx = "onnx"
    tflite = "tflite"
    tflite_edgetpu = "tflite_edgetpu"
    tensorrt = "tensorrt"
    openvino = "openvino"
    rknn = "rknn"
    hailo = "hailo"


# Maps the detector `type` field from config.yml → preferred target format.
DETECTOR_TARGET: Dict[str, TargetFormat] = {
    "edgetpu": TargetFormat.tflite_edgetpu,
    "cpu": TargetFormat.tflite,
    "tensorrt": TargetFormat.tensorrt,
    "openvino": TargetFormat.openvino,
    "onnx": TargetFormat.onnx,
    "rocm": TargetFormat.onnx,
    "zmq": TargetFormat.onnx,
    "hailo8": TargetFormat.hailo,
    "hailo8l": TargetFormat.hailo,
    "rknn": TargetFormat.rknn,
}


@dataclass
class ConversionJob:
    job_id: str
    source_filename: str
    source_format: SourceFormat
    target_format: TargetFormat
    status: str = "pending"  # pending | running | done | error
    progress: float = 0.0
    message: str = ""
    output_path: Optional[str] = None
    log_lines: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["source_format"] = self.source_format.value
        d["target_format"] = self.target_format.value
        return d


# Process-wide job registry. Backed by a plain dict — model conversion is
# infrequent and per-admin, so an LRU/persistent store would be overkill.
JOBS: Dict[str, ConversionJob] = {}


def detect_source_format(path: Path) -> SourceFormat:
    """Guess the format from magic bytes first, then extension."""
    with open(path, "rb") as f:
        head = f.read(16)
    ext = path.suffix.lower()
    if ext in (".pt", ".pth") or head[:2] == b"PK":
        # torch.save uses ZIP archive format → starts with PK
        return SourceFormat.pytorch
    if len(head) > 7 and head[4:8] == TFLITE_MAGIC:
        return SourceFormat.tflite
    if head.startswith(HDF5_MAGIC):
        return SourceFormat.keras_h5
    if ext == ".onnx":
        return SourceFormat.onnx
    if ext == ".pb":
        return SourceFormat.tensorflow_saved
    if ext in (".engine", ".plan"):
        return SourceFormat.tensorrt_engine
    if ext == ".tflite":
        return SourceFormat.tflite
    return SourceFormat.unknown


def target_for_detector_type(detector_type: str) -> TargetFormat:
    return DETECTOR_TARGET.get(detector_type, TargetFormat.onnx)


def _run_subprocess(
    job: ConversionJob, cmd: list[str], cwd: Optional[Path] = None
) -> bool:
    """Run a conversion subprocess and stream output lines into the job log."""
    logger.info("Running: %s", " ".join(cmd))
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=cwd,
            text=True,
        )
    except FileNotFoundError as e:
        job.log_lines.append(f"Command not found: {cmd[0]} ({e})")
        return False

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            job.log_lines.append(line)
            if len(job.log_lines) > 500:
                job.log_lines = job.log_lines[-500:]
    proc.wait()
    return proc.returncode == 0


def _convert_pytorch_to_onnx(job: ConversionJob, src: Path, dst: Path) -> bool:
    """torch.onnx.export of a YOLO-style detector. Assumes the .pt has an
    `attempt_load`-compatible structure (ultralytics, yolov5/8) — for arbitrary
    nn.Module subclasses the user has to do the export themselves."""
    script = f"""
import sys, torch
src = r"{src}"
dst = r"{dst}"
try:
    # Path 1: ultralytics YOLO API
    from ultralytics import YOLO  # type: ignore
    YOLO(src).export(format='onnx', imgsz=640, opset=13)
    import shutil, glob, os
    out = glob.glob(os.path.splitext(src)[0] + '.onnx')
    if out:
        shutil.move(out[0], dst)
        print('EXPORTED_VIA_ULTRALYTICS', dst)
        sys.exit(0)
except Exception as e:
    print('ultralytics path failed:', e)

# Path 2: raw torch scripted module
model = torch.load(src, map_location='cpu', weights_only=False)
if hasattr(model, 'eval'):
    model.eval()
dummy = torch.randn(1, 3, 640, 640)
torch.onnx.export(model, dummy, dst, opset_version=13,
                  input_names=['input'], output_names=['output'])
print('EXPORTED_VIA_TORCH', dst)
"""
    return _run_subprocess(job, [sys.executable, "-c", script])


def _convert_onnx_to_tflite(
    job: ConversionJob, src: Path, dst: Path, quantize: bool
) -> bool:
    """ONNX → SavedModel → TFLite. Optionally int8-quantize for EdgeTPU."""
    workdir = src.parent / f".tf_export_{src.stem}"
    workdir.mkdir(exist_ok=True)
    quant_arg = "True" if quantize else "False"
    script = f"""
import onnx
import tensorflow as tf
from onnx_tf.backend import prepare
onnx_model = onnx.load(r"{src}")
tf_rep = prepare(onnx_model)
tf_rep.export_graph(r"{workdir}")
converter = tf.lite.TFLiteConverter.from_saved_model(r"{workdir}")
if {quant_arg}:
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.uint8
    converter.inference_output_type = tf.uint8
tflite_model = converter.convert()
with open(r"{dst}", "wb") as f:
    f.write(tflite_model)
print('EXPORTED_TFLITE', r"{dst}")
"""
    ok = _run_subprocess(job, [sys.executable, "-c", script])
    shutil.rmtree(workdir, ignore_errors=True)
    return ok


def _compile_for_edgetpu(job: ConversionJob, tflite_path: Path) -> Optional[Path]:
    """Run edgetpu_compiler if present. Returns path of the _edgetpu.tflite."""
    if shutil.which("edgetpu_compiler") is None:
        job.log_lines.append(
            "edgetpu_compiler not installed; leaving int8 .tflite as-is. "
            "Install it from https://coral.ai/docs/edgetpu/compiler/"
        )
        return tflite_path
    ok = _run_subprocess(
        job,
        ["edgetpu_compiler", "-s", str(tflite_path)],
        cwd=tflite_path.parent,
    )
    if not ok:
        return None
    compiled = tflite_path.with_name(tflite_path.stem + "_edgetpu.tflite")
    return compiled if compiled.exists() else None


def _convert_onnx_to_tensorrt(job: ConversionJob, src: Path, dst: Path) -> bool:
    """trtexec from NVIDIA TensorRT. Only works in NVIDIA-enabled images."""
    if shutil.which("trtexec") is None:
        job.log_lines.append(
            "trtexec not found. TensorRT conversion requires NVIDIA TensorRT "
            "installed in the container (use the -tensorrt image variant)."
        )
        return False
    return _run_subprocess(
        job,
        [
            "trtexec",
            f"--onnx={src}",
            f"--saveEngine={dst}",
            "--fp16",
            "--workspace=2048",
        ],
    )


def _convert_onnx_to_openvino(job: ConversionJob, src: Path, dst_dir: Path) -> bool:
    """OpenVINO Model Optimizer (mo) → IR (.xml + .bin)."""
    if shutil.which("mo") is None:
        job.log_lines.append(
            "OpenVINO `mo` not found. Install openvino-dev to convert models "
            "to OpenVINO IR (use the -openvino image variant)."
        )
        return False
    dst_dir.mkdir(parents=True, exist_ok=True)
    return _run_subprocess(
        job,
        ["mo", "--input_model", str(src), "--output_dir", str(dst_dir)],
    )


def _passthrough(job: ConversionJob, src: Path, dst: Path) -> bool:
    """The user uploaded a file already in the requested target format."""
    shutil.copy2(src, dst)
    job.log_lines.append(
        f"Source already in target format; copied {src.name} to {dst.name}"
    )
    return True


def run_conversion(job: ConversionJob, source_path: Path) -> None:
    """Top-level dispatch. Mutates `job` with progress/result."""
    job.status = "running"
    job.progress = 0.05
    out_dir = Path(MODEL_CACHE_DIR) / "converted"
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(job.source_filename).stem

    try:
        # Always normalize to ONNX first (when input isn't already in the
        # target shape), since ONNX is the universal hub format.
        if job.source_format == SourceFormat.tensorrt_engine:
            if job.target_format != TargetFormat.tensorrt:
                raise RuntimeError(
                    "TensorRT .engine files are device-specific and cannot be "
                    "converted to other formats. Re-export your source model "
                    "(PyTorch/ONNX) and convert from there."
                )
            dst = out_dir / f"{stem}.engine"
            ok = _passthrough(job, source_path, dst)
            job.output_path = str(dst) if ok else None
            job.status = "done" if ok else "error"
            return

        # Step 1: get an ONNX intermediate.
        if job.source_format == SourceFormat.pytorch:
            onnx_path = out_dir / f"{stem}.onnx"
            job.message = "Exporting PyTorch → ONNX"
            ok = _convert_pytorch_to_onnx(job, source_path, onnx_path)
            if not ok:
                raise RuntimeError("PyTorch → ONNX export failed; see log")
            job.progress = 0.4
        elif job.source_format == SourceFormat.onnx:
            onnx_path = out_dir / f"{stem}.onnx"
            shutil.copy2(source_path, onnx_path)
            job.progress = 0.4
        elif job.source_format == SourceFormat.tflite:
            # If user wants tflite back, passthrough. Otherwise we can't go
            # backwards from tflite to onnx cleanly without significant work.
            if job.target_format in (TargetFormat.tflite, TargetFormat.tflite_edgetpu):
                onnx_path = None  # signal: skip onnx hop
            else:
                raise RuntimeError(
                    "TFLite → other formats is not supported (TFLite is a "
                    "terminal format). Re-export from the original model."
                )
        else:
            raise RuntimeError(
                f"Source format '{job.source_format.value}' is not supported. "
                "Upload a .pt/.pth, .onnx, or .tflite file."
            )

        # Step 2: ONNX → target.
        if job.target_format == TargetFormat.onnx:
            assert onnx_path is not None
            job.output_path = str(onnx_path)
            job.message = "Done"
            job.progress = 1.0
            job.status = "done"
            return

        if job.target_format in (TargetFormat.tflite, TargetFormat.tflite_edgetpu):
            quantize = job.target_format == TargetFormat.tflite_edgetpu
            tflite_path = out_dir / f"{stem}.tflite"
            if job.source_format == SourceFormat.tflite:
                shutil.copy2(source_path, tflite_path)
            else:
                assert onnx_path is not None
                job.message = "Converting ONNX → TFLite" + (
                    " (int8 quant)" if quantize else ""
                )
                ok = _convert_onnx_to_tflite(job, onnx_path, tflite_path, quantize)
                if not ok:
                    raise RuntimeError("ONNX → TFLite conversion failed; see log")
            job.progress = 0.8
            if job.target_format == TargetFormat.tflite_edgetpu:
                job.message = "Compiling for EdgeTPU"
                compiled = _compile_for_edgetpu(job, tflite_path)
                if compiled is None:
                    raise RuntimeError("edgetpu_compiler failed; see log")
                job.output_path = str(compiled)
            else:
                job.output_path = str(tflite_path)
            job.status = "done"
            job.progress = 1.0
            return

        if job.target_format == TargetFormat.tensorrt:
            assert onnx_path is not None
            engine_path = out_dir / f"{stem}.engine"
            job.message = "Building TensorRT engine"
            ok = _convert_onnx_to_tensorrt(job, onnx_path, engine_path)
            if not ok:
                raise RuntimeError("TensorRT conversion failed; see log")
            job.output_path = str(engine_path)
            job.status = "done"
            job.progress = 1.0
            return

        if job.target_format == TargetFormat.openvino:
            assert onnx_path is not None
            ov_dir = out_dir / f"{stem}_openvino"
            job.message = "Generating OpenVINO IR"
            ok = _convert_onnx_to_openvino(job, onnx_path, ov_dir)
            if not ok:
                raise RuntimeError("OpenVINO conversion failed; see log")
            job.output_path = str(ov_dir / f"{stem}.xml")
            job.status = "done"
            job.progress = 1.0
            return

        if job.target_format in (TargetFormat.hailo, TargetFormat.rknn):
            sdk_name = (
                "Hailo Dataflow Compiler"
                if job.target_format == TargetFormat.hailo
                else "rknn-toolkit2"
            )
            raise RuntimeError(
                f"{job.target_format.value.upper()} conversion requires the "
                f"proprietary {sdk_name}, which cannot ship with Argus. "
                "Install the SDK from the vendor and re-run conversion."
            )

        raise RuntimeError(f"Unknown target format: {job.target_format}")

    except Exception as e:
        logger.exception("Model conversion failed")
        job.status = "error"
        job.message = str(e)


def stage_upload(file_bytes: bytes, original_name: str) -> Path:
    """Write an uploaded file to a tempdir for processing."""
    tmpdir = Path(tempfile.mkdtemp(prefix="argus_model_"))
    # Avoid path traversal — keep only the filename.
    safe_name = Path(original_name).name or f"upload_{uuid.uuid4().hex}"
    dst = tmpdir / safe_name
    dst.write_bytes(file_bytes)
    return dst


def cleanup_stage(staged_path: Path) -> None:
    try:
        shutil.rmtree(staged_path.parent, ignore_errors=True)
    except Exception:
        pass

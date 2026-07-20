# Phase 0 Runbook — Manual Pipeline on a RunPod GPU Pod

Goal: photos → COLMAP → LichtFeld training → web-viewable scene, done once by hand.
Fill in `phase0-notes.md` as you go — the timings/sizes you record there design Phases 1–3.

Everything below runs **on the pod over SSH** unless marked LOCAL.

---

## 1. Rent the pod (RunPod web UI)

- Sign up at runpod.io, add ~$15 credit.
- Storage → create a **Network Volume**, 100 GB, in a datacenter that offers RTX 4090s. This survives pod termination — your build and data live here.
- Pods → Deploy: **RTX 4090** (Community Cloud, ~$0.40–0.70/hr).
  - Template/image: custom image `nvidia/cuda:12.8.1-devel-ubuntu24.04`
  - Attach the network volume at `/workspace`
  - Enable SSH; note the connect command (`ssh root@<ip> -p <port>` or via RunPod proxy)
- **When you stop for the day: Terminate the pod, keep the volume.** Idle pods bill by the hour.

## 2. System packages (once per fresh pod, ~5 min)

```bash
apt update && apt install -y \
  git curl unzip zip tar pkg-config build-essential ninja-build ccache \
  gcc-14 g++-14 nasm autoconf autoconf-archive automake libtool \
  python3 python3-dev python3-pip \
  libxinerama-dev libxcursor-dev xorg-dev libglu1-mesa-dev \
  libwayland-dev libxkbcommon-dev libegl-dev libdecor-0-dev \
  libibus-1.0-dev libdbus-1-dev libsystemd-dev

# Ubuntu 24.04's apt cmake is 3.28 — LichtFeld needs >= 3.30
pip3 install --break-system-packages cmake
cmake --version   # expect >= 3.30

export CC=gcc-14 CXX=g++-14
```

(The X11/Wayland dev packages look GUI-ish but are required — the build enforces SDL3 windowing backends even for headless use.)

## 3. vcpkg (once, persists on the volume)

```bash
cd /workspace
git clone https://github.com/microsoft/vcpkg.git
./vcpkg/bootstrap-vcpkg.sh -disableMetrics
export VCPKG_ROOT=/workspace/vcpkg
```

## 4. Build LichtFeld — portable build (once; SLOW first time, possibly 1–2 h)

```bash
cd /workspace
git clone --recurse-submodules https://github.com/MrNeRF/LichtFeld-Studio.git
cd LichtFeld-Studio
cmake -B build -DBUILD_PORTABLE=ON
time cmake --build build -j$(nproc)          # RECORD this time
cmake --install build --prefix /workspace/dist
/workspace/dist/bin/run_lichtfeld.sh --help  # sanity check
```

`BUILD_PORTABLE=ON` matters: it produces a PTX/JIT binary that runs on any Turing+ GPU — the same artifact the Phase 1 Docker image will ship.

## 5. COLMAP

```bash
apt install -y colmap
colmap -h | head -3
```

Note: Ubuntu's colmap package may be CPU-only (no CUDA SIFT). That's acceptable for ≤150 photos — just slower. Try GPU first in step 7; if it errors, set the `use_gpu` flags to 0 and RECORD that the Phase 1 image needs a CUDA COLMAP build.

## 6. LOCAL: shoot and upload photos

- 40–150 photos of ONE place. Orbit the subject, ~60–80% overlap between shots, no motion blur, consistent lighting, avoid mirrors/glass/textureless walls.
- Upload from your PC (Git Bash):

```bash
scp -P <port> -r ./my_photos root@<pod-ip>:/workspace/project/images
```

(`runpodctl send/receive` is an alternative if scp is awkward.)

## 7. COLMAP structure-from-motion (RECORD each stage's time)

```bash
cd /workspace/project
time colmap feature_extractor --database_path db.db --image_path images \
  --ImageReader.single_camera 1 --SiftExtraction.use_gpu 1
time colmap exhaustive_matcher --database_path db.db --SiftMatching.use_gpu 0
# for an ordered walkthrough instead:  colmap sequential_matcher --database_path db.db
mkdir -p sparse
time colmap mapper --database_path db.db --image_path images --output_path sparse
ls sparse/0   # MUST show: cameras.bin  images.bin  points3D.bin
```

Two flags that are not optional here, both learned the hard way (2026-07-20):

- **`--ImageReader.single_camera 1`** — COLMAP otherwise creates a separate
  camera model per distinct image *dimension*. One mixed-resolution set is then
  split into unrelated intrinsics groups, which wrecks an already-small set.
  Frames from a single video are uniform, so this is free insurance; for hand-shot
  photos it is essential.
- **`--SiftMatching.use_gpu 0`** — the GPU matcher **core-dumps** on this pod
  (`Aborted (core dumped)`, apt COLMAP on the RTX 5090). CPU matching is fine at
  these set sizes. Feature *extraction* on GPU works; only matching crashes.

Check registration before spending GPU time on training:

```bash
colmap model_analyzer --path sparse/0   # look at "Registered images"
```

If `sparse/0` is missing, or registered images ≪ input images → photo set problem
(overlap/blur), not a pipeline problem. Reshoot; note what failed.

**Measured example of failure** (`photos-inbox/Location-1`, 6 stills of a
restaurant interior): 4 verified pairs of 15 possible, **2 of 6 images
registered, 36 points**. The set was six snapshots of different walls rather
than a continuous orbit — no amount of flag-tuning fixes missing overlap. A
video walkthrough is the reliable input.

## 8. Train (RECORD wall-clock + peak VRAM)

```bash
# terminal 2: watch VRAM, note the peak
nvidia-smi -l 5

# terminal 1:
time /workspace/dist/bin/run_lichtfeld.sh -d /workspace/project -o /workspace/out \
  --headless --eval --test-every 8 --undistort -i 30000
```

**`--undistort` is required for phone photos.** Without it training dies
immediately with `Training error: Distorted images detected. Use --gut or
--undistort to train on cameras with distortion.` COLMAP fits a distorted camera
model (SIMPLE_RADIAL by default) and LichtFeld refuses to train on it. `--gut` is
the alternative — it trains the distortion rather than removing it.

First run JIT-compiles kernels (~5–15 s extra at startup — that's the PTX build, expected).
**Verified working on an RTX 5090 / Blackwell (sm_120) 2026-07-20** — kernels JIT
cleanly, 34–445 iter/s. This was the project's last untested build assumption.

Afterwards check `cat /workspace/out/metrics.csv` — record final PSNR/SSIM and num_gaussians.

## 9. Export web formats

```bash
/workspace/dist/bin/run_lichtfeld.sh convert /workspace/out/splat_30000.ply /workspace/out/scene.sog  -f sog
/workspace/dist/bin/run_lichtfeld.sh convert /workspace/out/splat_30000.ply /workspace/out/scene.html -f html
ls -lh /workspace/out   # RECORD sizes of splat_30000.ply / scene.sog / scene.html
```

**`convert` exits 134 even on success — check for the file, not the exit code.**
It reliably reaches `100% Done`, writes a valid `scene.html`, and *then* aborts
with `malloc_consolidate(): unaligned fastbin chunk detected` while tearing down.
The artifact is complete; the crash is in cleanup after the write. Any automation
(i.e. `worker/handler.py`) must test `-s scene.html` rather than `$?`.

## 10. LOCAL: download and view

```bash
scp -P <port> root@<pod-ip>:/workspace/out/scene.html .
scp -P <port> root@<pod-ip>:/workspace/out/scene.sog .
scp -P <port> root@<pod-ip>:/workspace/out/metrics.csv .
```

Open `scene.html` in your browser. If it renders and you can orbit your scene — **Phase 0 is done.**

## 11. Shut it down

Terminate the pod (volume persists). Verify in the RunPod billing page that nothing is still metering.

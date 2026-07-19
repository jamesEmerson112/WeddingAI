# syntax=docker/dockerfile:1
#
# splat-service GPU worker image — Phase 1 SKELETON.
#
# STATUS: This Dockerfile INTENTIONALLY DOES NOT BUILD YET. It is a commented
# blueprint of the multi-stage image the worker needs. Every unfinished step is
# marked TODO(Phase 1). Do not `docker build` this expecting a working image —
# see ROADMAP.md "Phase 1" and docs/phase0-runbook.md (the manual build this
# container automates).
#
# Two stages:
#   1. build   — heavy CUDA devel image; compiles COLMAP + LichtFeld Studio.
#   2. runtime — lean CUDA runtime image; carries only the built binaries + Python.
# This keeps the shipped image small (fast RunPod cold starts) by leaving the
# multi-GB build toolchain (vcpkg, gcc-14, CUDA devel headers) behind in stage 1.

# =============================================================================
# Stage 1: build
# =============================================================================
FROM nvidia/cuda:12.8.1-devel-ubuntu24.04 AS build

# TODO(Phase 1) 1. System build deps. Mirror docs/phase0-runbook.md section 2:
#   git curl unzip zip tar pkg-config build-essential ninja-build ccache
#   gcc-14 g++-14 nasm autoconf autoconf-archive automake libtool
#   python3 python3-dev python3-pip
#   the X11/Wayland dev libs LichtFeld's SDL3 backend requires even when headless
#   (libxinerama-dev libxcursor-dev xorg-dev libglu1-mesa-dev libwayland-dev
#    libxkbcommon-dev libegl-dev libdecor-0-dev libibus-1.0-dev libdbus-1-dev
#    libsystemd-dev).
# RUN apt-get update && apt-get install -y --no-install-recommends <the above> \
#     && rm -rf /var/lib/apt/lists/*

# TODO(Phase 1) 2. CMake >= 3.30 (Ubuntu 24.04's apt cmake is 3.28, too old).
# RUN pip3 install --break-system-packages cmake
# ENV CC=gcc-14 CXX=g++-14

# TODO(Phase 1) 3. vcpkg (LichtFeld's dependency manager).
# RUN git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg \
#     && /opt/vcpkg/bootstrap-vcpkg.sh -disableMetrics
# ENV VCPKG_ROOT=/opt/vcpkg

# TODO(Phase 1) 4. Build CUDA COLMAP from source.
#   Ubuntu's apt `colmap` may be CPU-only; the worker wants GPU SIFT, so build
#   it against this CUDA devel image and install into /dist (or a system prefix).
#   (git clone colmap -> cmake -DCMAKE_CUDA_ARCHITECTURES=... -> build -> install)

# TODO(Phase 1) 5. Build LichtFeld Studio, PORTABLE.
#   -DBUILD_PORTABLE=ON is REQUIRED: it emits a PTX/JIT binary that runs on any
#   Turing+ (SM 75) GPU, so one image works across RunPod's mixed GPU fleet.
#   The first vcpkg build is very slow (1-2 h) — worth a BuildKit cache mount.
# RUN git clone --recurse-submodules https://github.com/MrNeRF/LichtFeld-Studio.git /src/lfs \
#     && cd /src/lfs \
#     && cmake -B build -DBUILD_PORTABLE=ON \
#     && cmake --build build -j"$(nproc)" \
#     && cmake --install build --prefix /dist
#   Result: /dist/bin/run_lichtfeld.sh + supporting files, self-contained.

# =============================================================================
# Stage 2: runtime
# =============================================================================
FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04 AS runtime

# TODO(Phase 1) 6. Runtime OS deps: python3 + pip, colmap runtime libraries,
#   and any shared libs LichtFeld links at runtime (the -dev packages from
#   stage 1 are build-only and must NOT be dragged in here — keep this lean).
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     python3 python3-pip <colmap-runtime-libs> \
#     && rm -rf /var/lib/apt/lists/*

# TODO(Phase 1) 7. Copy the built binaries from stage 1.
#   The portable /dist tree, plus the CUDA COLMAP binaries if they were staged
#   under /dist as well (otherwise copy their install prefix too).
# COPY --from=build /dist /dist
# ENV PATH="/dist/bin:${PATH}"

# TODO(Phase 1) 8. Python worker deps.
#   runpod = serverless SDK (long-polls for jobs, progress_update, start()).
#   boto3  = S3 client for Cloudflare R2 (download upload_key, upload artifacts).
# RUN pip3 install --break-system-packages --no-cache-dir runpod boto3

WORKDIR /app

# TODO(Phase 1) 9. Add the handler once the pipeline above actually builds.
# COPY handler.py /app/handler.py

# Entry point: RunPod runs this; handler.py's serverless.start() (currently
# commented out in the stub) will take over and serve jobs once Phase 1 lands.
CMD ["python", "-u", "handler.py"]

# LichtFeld-Studio — Vendored Upstream Documentation

Offline copy of the LichtFeld-Studio manual, vendored for reference by the
WeddingAI GPU worker team. These files are NOT part of WeddingAI's source; the
project invokes the LichtFeld-Studio binary as an external process only.

## Provenance

- Upstream repo: https://github.com/MrNeRF/LichtFeld-Studio
- Repo commit vendored: `5d3ed448ea9dda4f1c373a51217f5142e73c5eae` (2026-07-19, shallow clone)
- Upstream wiki: https://github.com/MrNeRF/LichtFeld-Studio/wiki
- Wiki commit vendored: `45faacb192d68edff2664bb56cd13f5222d33229` (2026-07-10)
- Vendored on: 2026-07-19
- Upstream license: GPL-3.0 (see `LICENSE` in this folder). Docs are vendored
  for reference only; WeddingAI runs the binary as an external process and does
  not link against or redistribute LichtFeld-Studio code.

Note: upstream's user docs under `docs/docs/` (FAQ, installation) are mostly
stubs that redirect to the GitHub wiki — the wiki is the real manual, so all
wiki pages are vendored under `wiki/`. Wiki filenames were normalized to plain
ASCII hyphens (upstream uses U+2010 in some names).

## Files

### Repo docs (from the main repository)

| File | Description |
|------|-------------|
| `README.md` | Upstream project README: overview, capabilities, NVIDIA/CUDA 12.8+ requirements, install and docs links. |
| `LICENSE` | Upstream GPL-3.0 license text. |
| `building_and_distribution.md` | Build requirements (CUDA 12.8+, cuDNN 9, CMake 3.30+, GCC 14+/VS2022), native vs portable build (`-DBUILD_PORTABLE=ON`), CMake options table (incl. `BUILD_CUDA_MIN_SM`), dist layout with `run_lichtfeld.sh`, troubleshooting. |
| `features/gut.md` | 3DGUT feature: ray-traced rendering for distorted (non-pinhole) COLMAP camera models via `--gut`; supported camera model list. |
| `features/poseopt.md` | Pose optimization during training (`--pose-opt direct` / `--pose-opt mlp`). |
| `features/timelapse.md` | Timelapse rendering of training progress (`--timelapse-images`, interval flag, output folder layout). |
| `development/build.md` | Developer build presets (`cmake --preset dev-release`), compiler cache notes, reproducible build measurement preset. |
| `development/flags.md` | Developer/diagnostic environment variables (`LFS_*`) and CMake developer options. |

### Wiki pages (the primary user manual)

| File | Description |
|------|-------------|
| `wiki/Home.md` | Manual entry point: hardware/software requirements (NVIDIA CC 7.5+, 8 GB+ VRAM, driver 570+, CUDA 12.8+), dataset expectations (undistorted COLMAP), basic CLI training examples. |
| `wiki/Command-Line-Options.md` | Full `--help` dump (dated 2026-06-24): all training/dataset/rendering/output/UI/logging flags and the `convert` / `plugin` subcommands. |
| `wiki/Frequently-Asked-Questions.md` | FAQ: exploding scenes (distorted images), slow training (VRAM), CPU load from image rescaling, max image resolution 4096x4096, no multi-GPU support. |
| `wiki/Example-Dataset.md` | Tanks & Trains example dataset download plus training command examples (basic, eval, MCMC with `--max-cap`). |
| `wiki/Feature-Documentation.md` | Feature guide: 3DGUT, background modulation, timelapse, and related flags with examples. |
| `wiki/Build-Instructions-Linux.md` | Linux build: GCC 14 setup per Ubuntu version, vcpkg build, and a validated no-vcpkg native build path. |
| `wiki/Build-Instructions-Windows.md` | Windows build instructions (VS 2022, CUDA, vcpkg). |
| `wiki/Build-Instructions-Docker.md` | Docker-based build instructions. |
| `wiki/Development.md` | Contributor/development workflow notes. |
| `wiki/Shortcuts.md` | GUI keyboard/mouse shortcuts (not relevant to headless use). |

### Not vendored

Upstream also ships plugin-system docs (`docs/plugin-system.md`,
`docs/plugins/`), MCP automation guides (`docs/docs/development/mcp/`), and
internal dev notes (Vulkan pipeline/roadmap, ImGui inventory, Python UI
notes). These are out of scope for our headless CLI usage; fetch from upstream
if needed. No images were vendored — the copied docs reference only remote
image URLs.

## Operational quick reference (for the WeddingAI GPU worker)

- Headless training: `LichtFeld-Studio -d <dataset> -o <out> --headless`
  (headless mode starts training immediately; `--train` only matters for GUI
  auto-start).
- Convert/export: `LichtFeld-Studio convert <in.ply> <out> [-f ply|sog|spz|html|usd|usda|usdc|rad]`
  — format is inferred from the output extension when `-f` is omitted.
- Dataset: undistorted images + COLMAP sparse model (cameras/points); use
  `--gut` for distorted camera models, or `--undistort` to undistort on the fly.
- Key limits: images capped at 4096x4096 (default rescale to `--max-width`,
  default 3840); no multi-GPU; NVIDIA compute capability 7.5+ with 8 GB+ VRAM
  recommended; driver 570+.
- Portable Linux build for containers: `cmake -B build -DBUILD_PORTABLE=ON`,
  then launch via `dist/bin/run_lichtfeld.sh` (bundles CUDA runtime; target
  machine only needs an NVIDIA driver).

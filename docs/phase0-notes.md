# Phase 0 Notes — fill in during the manual run

These numbers design Phases 1–3 (worker image, job caps, storage sizing). Fill honestly, including failures.

## Environment

- Date:
- GPU model / VRAM:
- Pod cost per hour:
- CUDA image used:

## Timings

| Stage | Wall-clock |
|---|---|
| apt + cmake + vcpkg bootstrap | |
| LichtFeld build (first, cold vcpkg) | |
| COLMAP feature_extractor | |
| COLMAP matcher (which one?) | |
| COLMAP mapper | |
| Training → iter 7000 | |
| Training → iter 30000 | |
| convert → sog | |
| convert → html | |

## Dataset & results

- Photo count / total MB:
- Subject (what was photographed):
- Images registered by COLMAP (out of total):
- Peak VRAM during training:
- Final num_gaussians:
- Final PSNR / SSIM (from metrics.csv):

## Artifact sizes

- splat_30000.ply:
- scene.sog:
- scene.html:

## Gotchas & failures

- COLMAP from apt: CUDA-enabled? (yes/no — Phase 1 image must build from source if no)
- Anything that failed and how it was fixed:
- Commands that differed from the runbook:

## Total spent this phase: $

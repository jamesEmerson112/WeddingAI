This is the return from --help got at 24/06/2026
```
LichtFeld Studio: High-performance CUDA implementation of 3D Gaussian Splatting algorithm.

OPTIONS:

  MODE SELECTION:
	-h, --help                        Display help menu
	-V, --version                     Display version information
	-v[path], --view=[path]           View file(s). Supports splat (.ply, .sog, .spz, .usd, .usda, .usdc, .usdz) and mesh (.obj, .fbx, .gltf, .glb, .stl) formats. If directory, loads all.
	--resume=[checkpoint]             Resume training from checkpoint file

  TRAINING PATHS:
	-d[data_path], --data-path=[data_path]
									  Path to training data
	-o[output_path], --output-path=[output_path]
									  Path to output
	--output-name=[output_name]       Output filename (replaces default splat_ITER.ply stem)
	--config=[config_file]            LichtFeldStudio config file (json)
	--init=[path]                     Initialize from splat file (.ply, .sog, .spz, .usd, .usda, .usdc, .usdz, .resume)
	--import-cameras=[path]           Import COLMAP cameras from sparse folder (no images required)

  TRAINING PARAMETERS:
	-i[iterations], --iter=[iterations]
									  Number of iterations
	--strategy=[strategy]             Optimization strategy: mcmc, mrnf, igs+ (legacy aliases: mnrf, lfs)
	--sh-degree=[sh_degree]           Max SH degree [0-3]
	--sh-degree-interval=[sh_degree_interval]
									  SH degree interval
	--max-cap=[max_cap]               Maximum number of Gaussians
	--min-opacity=[min_opacity]       Minimum opacity threshold
	--steps-scaler=[steps_scaler]     Scale training steps by factor
	--tile-mode=[tile_mode]           Tile mode for memory-efficient training: 1=1 tile, 2=2 tiles, 4=4 tiles (default: 1)
	--use-error-map                   Weight MRNF refine signal by per-pixel SSIM error map
	--use-edge-map                    Weight MRNF refine signal by Sobel edge map on GT images

  INITIALIZATION:
	--random                          Use random initialization instead of SfM
	--init-num-pts=[init_num_pts]     Number of random initialization points
	--init-extent=[init_extent]       Extent of random initialization

  DATASET OPTIONS:
	--images=[images]                 Images folder name
	--test-every=[test_every]         Use every Nth image as test
	-r[resize_factor], --resize_factor=[resize_factor]
									  Resize resolution by factor: auto, 1, 2, 4, 8 (default: auto)
	--max-width=[max_width]           Max width of images in px (default: 3840)
	--no-cpu-cache                    Disable CPU memory caching (default: enabled)
	--no-fs-cache                     Disable filesystem caching (default: enabled)
	--undistort                       Undistort images on-the-fly before training

  MASK OPTIONS:
	--mask-mode=[mask_mode]           Mask mode: none, segment, ignore, alpha_consistent (default: none)
	--invert-masks                    Invert mask values (swap object/background)
	--no-alpha-as-mask                Disable automatic alpha-as-mask for RGBA images

  SPARSITY OPTIMIZATION:
	--enable-sparsity                 Enable sparsity optimization
	--sparsify-steps=[sparsify_steps] Number of sparsification steps to run after regular training (default: 15000)
	--init-rho=[init_rho]             Initial ADMM penalty parameter (default: 0.0005)
	--prune-ratio=[prune_ratio]       Final pruning ratio for sparsity (default: 0.6)

  RENDERING OPTIONS:
	--enable-mip                      Enable mip filter (anti-aliasing)
	--bilateral-grid                  Enable bilateral grid filtering
	--ppisp                           Enable PPISP for per-camera appearance modeling
	--ppisp-controller                Enable PPISP controller for novel views
	--ppisp-freeze                    Freeze PPISP learning and load PPISP weights from a sidecar file
	--ppisp-sidecar=[path]            Path to PPISP sidecar (.ppisp) used for frozen PPISP training
	--bg-modulation                   Enable sinusoidal background modulation
	--gut                             Enable GUT mode

  OUTPUT OPTIONS:
	--eval                            Enable evaluation during training
	--save-eval-images                Save evaluation comparison images (GT vs rendered)
	--save-depth                      [TODO] Save depth maps during training (not yet implemented)
	--timelapse-images=[timelapse_images...]
									  Image filenames to render timelapse images for
	--timelapse-every=[timelapse_every]
									  Render timelapse image every N iterations (default: 50)

  UI OPTIONS:
	--headless                        Disable visualization during training
	--train                           Start training immediately on startup
	--no-splash                       Skip splash screen on startup
	--no-interop                      Disable CUDA-GL interop (use CPU fallback for display)
	--debug-python                    Start debugpy listener on port 5678 for plugin debugging
	--debug-python-port=[port]        Port for debugpy listener (default: 5678)

  LOGGING:
	--log-level=[level]               Log level: trace, debug, info, perf, warn, error, critical, off (default: info)
	--verbose                         Verbose output (equivalent to --log-level debug)
	-q, --quiet                       Suppress non-error output (equivalent to --log-level error)
	--log-file=[file]                 Optional log file path
	--log-filter=[pattern]            Filter log messages (glob: *foo*, regex: \\d+)

  EXTENSIONS:
	--python-script=[path...]         Python script(s) for custom training callbacks

SUBCOMMANDS:
convert -- Convert between .ply, .sog, .spz, .usd/.usda/.usdc, .html
plugin -- Manage plugins (create, check, list)
Run '<subcommand> --help' for details.
EXAMPLES:
lichtfeld-studio -d ./data -o ./output
lichtfeld-studio --resume checkpoint.resume
lichtfeld-studio -v model.ply
lichtfeld-studio convert in.ply out.spz
lichtfeld-studio plugin create my_plugin
ENVIRONMENT:
LOG_LEVEL -- Set log level (trace/debug/info/perf/warn/error)
```
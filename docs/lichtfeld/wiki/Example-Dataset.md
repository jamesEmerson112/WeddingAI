## Dataset Preparation

Download and extract the Tanks & Trains dataset:

```bash
wget https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/datasets/input/tandt_db.zip
unzip tandt_db.zip -d data/
```

## Training

Basic training:
```bash
./build/LichtFeld-Studio -d data/garden -o output/garden
```

Training with evaluation and visualization:
```bash
./build/LichtFeld-Studio \
    -d data/garden \
    -o output/garden \
    --eval \
    --save-eval-images \
    --render-mode RGB_D \
    -i 30000
```

MCMC strategy with limited Gaussians:
```bash
./build/LichtFeld-Studio \
    -d data/garden \
    -o output/garden \
    --strategy mcmc \
    --max-cap 500000
```
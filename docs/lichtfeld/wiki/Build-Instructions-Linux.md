## Compiler Setup

If you are on Ubuntu 25.04 please note: https://github.com/MrNeRF/LichtFeld-Studio/issues/906

<details>
<summary><b>Ubuntu 24.04+ (GCC 14)</b></summary>

```bash
# Install GCC 14
sudo apt update
sudo apt install gcc-14 g++-14 gfortran-14

# Set as default
sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-14 60
sudo update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-14 60
sudo update-alternatives --config gcc
sudo update-alternatives --config g++
```

</details>

<details>
<summary><b>Ubuntu 22.04 (Build GCC 14 from source)</b></summary>

```bash
# Install dependencies
sudo apt install build-essential libmpfr-dev libgmp3-dev libmpc-dev -y

# Download and build GCC
wget http://ftp.gnu.org/gnu/gcc/gcc-14.1.0/gcc-14.1.0.tar.gz
tar -xf gcc-14.1.0.tar.gz
cd gcc-14.1.0

# Configure and build (1-2 hours)
./configure --prefix=/usr/local/gcc-14.1.0 --enable-languages=c,c++ --disable-multilib
make -j$(nproc)
sudo make install

# Set up alternatives
sudo update-alternatives --install /usr/bin/gcc gcc /usr/local/gcc-14.1.0/bin/gcc 14
sudo update-alternatives --install /usr/bin/g++ g++ /usr/local/gcc-14.1.0/bin/g++ 14
```

</details>

<details>
<summary><b>Building on Ubuntu 26.04 with CUDA 13.x</b></summary>

## CUDA Toolkit
CUDA 12.8 or higher is required.  The CUDA toolkit in Ubuntu 26.04 is 12.4.  You can install the current NVIDIA-maintained toolkit from https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=Ubuntu&target_version=26.04&target_type=deb_network
This toolkit installs in /usr/local/cuda so special handling may be needed to get vcpkg to find it.

## Add to your shell (or ~/.bashrc):

```bash
export CUDA_HOME=/usr/local/cuda
export CUDAToolkit_ROOT=/usr/local/cuda
export CUDAToolkit_LIBRARY_ROOT=/usr/local/cuda
export CMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc
export PATH=/usr/local/cuda/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
```

## Configure the Project
```
cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CUDA_ARCHITECTURES="75;86;89;90" \     # adjust for your GPU
  -DCUDAToolkit_ROOT=/usr/local/cuda \
  -DCUDAToolkit_LIBRARY_ROOT=/usr/local/cuda \
  -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc \
  -DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake \
  -G Ninja
```

## Complete the build
```bash
cmake --build build -j$(nproc)
```

## Common Issues & Fixes
* "Could not find CUDA library root" or nvcc not found → Ensure the direct /usr/local/cuda symlink exists and set the environment variables above.
* math_functions.h noexcept errors → Known issue with CUDA 13.1 and Ubuntu 26.04.  Use CUDA 13.2+.
* Unsupported gpu architecture 'compute_52' → Always specify -DCMAKE_CUDA_ARCHITECTURES="75" (or your GPU's compute capability).

These steps were validated on Ubuntu 26.04 with CUDA 13.3 and an RTX 2060.

</details>

## Linux Build

```bash
# Set up vcpkg (one-time setup)
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg && ./bootstrap-vcpkg.sh -disableMetrics && cd ..

## If you want you can specify vcpkg locally without globally setting env variable (see -DCMAKE_TOOLCHAIN_FILE version)
export VCPKG_ROOT=/path/to/vcpkg  # Add to ~/.bashrc

# Clone repository and submodules
git clone --recursive https://github.com/MrNeRF/LichtFeld-Studio
cd LichtFeld-Studio

# Build
cmake -B build -DCMAKE_BUILD_TYPE=Release -G Ninja

## Or if you want you can specify your own vcpkg 
# cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE="<path-to-vcpkg>/scripts/buildsystems/vcpkg.cmake" -G Ninja 

cmake --build build -- -j$(nproc)
```


## Alternative: Native build without vcpkg

The vcpkg-based build downloads and compiles ~40 dependencies from source, which takes 30–90 minutes on the first configure. If you prefer to install as much as possible via `apt` and only source-build what the distro doesn't ship, the setup below is a working alternative.

Validated on **Ubuntu 24.04 LTS** with CUDA 12.8 and gcc-14.

### 1. Install what apt provides

```bash
sudo apt update
sudo apt install -y \
  build-essential ninja-build cmake pkg-config git curl wget ca-certificates \
  gcc-14 g++-14 patchelf \
  libassimp-dev libboost-dev libboost-regex-dev \
  libfmt-dev libfreetype-dev libglm-dev libgtest-dev \
  libarchive-dev libwebp-dev nlohmann-json3-dev \
  libopenimageio-dev libspdlog-dev libtbb-dev \
  libzmq3-dev cppzmq-dev \
  libvulkan-dev libvulkan-memory-allocator-dev \
  libavcodec-dev libavformat-dev libx264-dev libswscale-dev libffmpeg-nvenc-dev \
  glslang-dev glslang-tools \
  python3 python3-dev python3-pip python3-full \
  libgtk-3-dev libxinerama-dev libxcursor-dev libxi-dev libxrandr-dev \
  libxkbcommon-dev libxxf86vm-dev libwayland-dev libegl1-mesa-dev \
  libgles2-mesa-dev libasound2-dev libpulse-dev libdbus-1-dev

python3 -m pip install --user --break-system-packages "nanobind>=2.12,<3"
```

### 2. Source-build what isn't in apt

The following aren't available (or are too old) in the noble archive and need a source build into a local prefix such as `~/.local/lfs-deps`:

- **args** 6.4.8
- **Dear ImGui** — must be the `docking` branch (uses `ImGuiConfigFlags_DockingEnable`)
- **ImPlot** 0.17
- **SDL3** ≥ 3.4.2 (noble only ships SDL2)
- **volk** ≥ 1.4.341
- **OpenUSD** ≥ v26.03
- **lunasvg 3.x** (RmlUi 6.2 needs the 3.x `boundingBox` API)
- **RmlUi 6.2** built STATIC (the project's Linux wrapper uses `--whole-archive`)
- **shader-slang** 2026.13 prebuilt tarball
- **nlohmann_json** v3.12+ (noble ships 3.11; `src/tcp` uses `std::optional` `to_json` from 3.12)

After building, stamp `$ORIGIN` as RUNPATH on every `.so` under the prefix — RUNPATH is not inherited across load layers, so without this step lunasvg won't be able to find its own libplutovg at runtime:

```bash
export PATH=$HOME/.local/bin:$PATH
for so in ~/.local/lfs-deps/lib/*.so*; do
  [ -L "$so" ] || [ ! -f "$so" ] && continue
  file "$so" | grep -q ELF || continue
  patchelf --set-rpath '$ORIGIN' "$so"
done
```

### 3. Configure and build

```bash
cmake -B build-ubuntu -S . -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DLFS_USE_VCPKG=OFF \
  -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc \
  -DCMAKE_PREFIX_PATH="$HOME/.local/lfs-deps;$(python3 -c 'import nanobind;print(nanobind.cmake_dir())')" \
  -DLFS_EXTRA_RUNTIME_DIRS="$HOME/.local/lfs-deps/lib" \
  -DPython_EXECUTABLE=/usr/bin/python3.12 \
  -DCUDA_DEVICE_DEBUG=OFF

cmake --build build-ubuntu -j$(nproc)
./build-ubuntu/LichtFeld-Studio --version
```

`LFS_USE_VCPKG=OFF` skips the vcpkg toolchain entirely; `LFS_EXTRA_RUNTIME_DIRS` bakes the deps prefix into the binary's RUNPATH so it runs without `LD_LIBRARY_PATH`. Pinning `Python_EXECUTABLE` to the system Python 3.12 avoids miniconda/anaconda leaking a mismatched `fmt` / `spdlog` via its include path.

### Ready-to-run scripts

A fork at [huluoboge/LichtFeld-Studio](https://github.com/huluoboge/LichtFeld-Studio) maintains a bootstrap script that does all of the above end-to-end:

- [`scripts/bootstrap-ubuntu-deps.sh`](https://github.com/huluoboge/LichtFeld-Studio/blob/master/scripts/bootstrap-ubuntu-deps.sh) — installs apt/pip deps and source-builds the rest into `~/.local/lfs-deps` (idempotent)
- [`compile-ubuntu.sh`](https://github.com/huluoboge/LichtFeld-Studio/blob/master/compile-ubuntu.sh) — one-shot configure + build
- [`docs/BUILD_UBUNTU_NATIVE.md`](https://github.com/huluoboge/LichtFeld-Studio/blob/master/docs/BUILD_UBUNTU_NATIVE.md) — full walkthrough, layout, troubleshooting

The fork also carries three minor CMakeLists patches that the native path needs (`find_package(ZLIB)` in `src/io`, a guard on the vcpkg-specific `glslang_DIR` override in `src/visualizer`, and an `LFS_EXTRA_RUNTIME_DIRS` cache variable for RUNPATH). See its `master` branch for the diff.

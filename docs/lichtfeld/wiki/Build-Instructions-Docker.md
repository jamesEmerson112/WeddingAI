The Docker container is primarily intended for development, but it can also be used as a stable environment for running the program.

```bash
# Build and start the container
./docker/run_docker.sh -bu 12.8.0

# Build without using the cache
./docker/run_docker.sh -n

# Stop the containers
./docker/run_docker.sh -c
```

Once the container has started, build the program using the Linux build instructions. All required dependencies are already set up inside the container, so you only need to run:

```bash
# Configure
cmake -B build -DCMAKE_BUILD_TYPE=Release -G Ninja

# Build
cmake --build build -- -j$(nproc)
```

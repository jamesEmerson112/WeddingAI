# Development Requirements
- C++23 compatible compiler (GCC 14+ or Clang 17+)
- CUDA 12.8+ for GPU development
- Apply `clang-format` for code style

# Project Architecture

```
LichtFeld-Studio/
├── src/
│   ├── core/          # Foundation (data structures, utilities)
│   ├── geometry/      # Geometric operations
│   ├── loader/        # Dataset loading (COLMAP, PLY, Blender)
│   ├── training/      # Training pipeline and strategies
│   ├── rendering/     # CUDA/OpenGL rendering
│   └── visualizer/    # Interactive GUI
├── gsplat/            # Optimized rasterization backend
├── fastgs/            # Fast Gaussian splatting kernels
└── parameter/         # JSON configuration files
```

# Components
## Tools

1. **Create tool files**: `src/visualizer/tools/your_tool.hpp` and `.cpp`
   - Inherit from `ToolBase`, implement: `getName()`, `getDescription()`, `renderUI()`

2. **Register tool**: In `tool_manager.cpp` add to `registerBuiltinTools()`:
   ```cpp
   registry_.registerTool<YourTool>();
   ```

3. **Update build**: In `CMakeLists.txt` add:
   ```cmake
   tools/your_tool.cpp
   ```

4. **Build & run** - Your tool appears automatically in the Tools panel!

**Example minimal tool**: Copy `crop_box_tool.hpp/cpp`, rename class, change `getName()` to return your tool name.
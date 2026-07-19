
# 3DGUT

3DGUT (3D Gaussian Unscented Transform) is an alternative method of rendering proposed by NVIDIA Research that uses raytracing instead of rasterization. Most significantly, it allows rendering and training with nonlinear projections, like camera models with distortion.

## When to Use
Use 3DGUT when your COLMAP camera model is not PINHOLE or SIMPLE_PINHOLE.

## How to Use
To enable 3DGUT, use the `--gut` flag.

## Supported Camera Models
- SIMPLE_PINHOLE
- PINHOLE
- SIMPLE_RADIAL
- RADIAL
- OPENCV
- FULL_OPENCV
- OPENCV_FISHEYE
- RADIAL_FISHEYE
- SIMPLE_RADIAL_FISHEYE

## References
- [3DGUT: Enabling Distorted Cameras and Secondary Rays in Gaussian Splatting](https://research.nvidia.com/labs/toronto-ai/3DGUT/) - Original paper and project page
- [3dgrut Repository](https://github.com/nv-tlabs/3dgrut) - Reference implementation
- [gsplat 3DGUT pull request](https://github.com/nerfstudio-project/gsplat/pull/667) - Implementation in gsplat which LFS's 3DGUT support is based on

# BG Modulation
Short for "Background Modulation"
By default a black background is used for training the splat. Due to the nature of gasussian splatting, if pictures contain dark/black areas that serve as background, those areas will be made transparent or even no gaussians (no need for gaussians as the area is already black).  BG modulation alters the background color dynamically during training using a sine pattern so that these areas will be covered with non-transparent (and dark/black) gaussians.
Most notable, if you woul change the background in the viewer to RED, you would see a lot of red areas in the transparent areas.  Or when you import the model into some larger scene, these transparent areas would also become noticeable as other elements of the scene would become visible as well

Without Background Modulation:
<img width="1280" alt="image" src="https://github.com/user-attachments/assets/41b87470-2bdc-4453-9359-54dbe3e0a2ad" />

With Background Modulation:
<img width="1280" alt="image" src="https://github.com/user-attachments/assets/af1b322d-0091-4a6f-846b-b4419f103815" />

# Timelapse

If you want to see how your reconstruction is progressing during training, you can enable timelapse generation. This will save out images of the current reconstruction at regular intervals. Currently, you can only save renders from a camera pose that corresponds to one of the training images.

## How to Use
To enable timelapse generation, use the `--timelapse-images` flag for every image you save timelapse images for. You can also use the `--timelapse-interval` flag to set how often (in number of training steps) to save out images. The default is every 50 steps.

:::note
The saved images can take up a significant amount of disk space, especially if you are saving images frequently, for many different images, or training on high resolution images (saved image size depends on --resize_factor too). Make sure you have enough disk space available.
:::

### Example
```bash
--timelapse-images IMG_6672.JPG --timelapse-images IMG_6690.JPG --timelapse-interval 100
```

This will save out renders from the camera poses corresponding to `IMG_6672.JPG` and `IMG_6690.JPG` every 100 training steps. The images will be saved in subfolders that correspond to the image names (with the file extension truncated) in the `timelapse` folder inside your output directory (see visual structure below).

```
<output_directory>
├── project.ls
└── timelapse
    ├── IMG_6672
    │   ├── 000100.png
    │   ├── 000200.png
    │   └── ...
    └── IMG_6690
        ├── 000100.png
        ├── 000200.png
        └── ...
```

# LPIPS Model Details

The implementation uses `weights/lpips_vgg.pt`, exported from `torchmetrics` with:
- **Network**: VGG with ImageNet pretrained weights
- **Input range**: [-1, 1] (conversion handled internally)
- **Normalization**: Included in model

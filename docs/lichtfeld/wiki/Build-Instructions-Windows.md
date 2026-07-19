#### Note: If you only want to run Lichtfeld Studio, you don't need to do any of this. Donate to support the project then you can just grab a pre-built zip from [here](https://portal.lichtfeld.io) instead, extract it, and just run the .exe in the bin folder.

# TLDR

- Install Visual Studio 2022
- Install CUDA Toolkit 12.8 after installing Visual Studio
- Install GIT
- Install PERL
- Follow the [instructions for Windows](https://github.com/MrNeRF/LichtFeld-Studio/wiki/Build-Instructions-%E2%80%90-Windows#step-3-downloading-and-building-lichtfeld-studio) 

# Step 1: Installation Dependencies

## Visual Studio 2022 Community Edition
- Download the community edition installer from https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-history#release-dates-and-build-numbers
	- **NOT** Visual Studio Code
		- this does not contain the required files for building LichtFeld Studio
	- **NOT** Visual Studio 2019
		- This contains old cmake version
	- **NOT** Visual Studio 2026
		- This version is not yet detected by CUDA installations

<img width="789" height="168" alt="image" src="https://github.com/user-attachments/assets/96b02a37-5258-4bf1-aeb1-23a7a64c0e64" />

- Run the downloaded setup program vs_Community.exe
- Install the following packages:
	- Desktop Development with C++

 <img width="600" alt="image" src="https://github.com/user-attachments/assets/095ed93e-1cb0-44c6-82c3-14fda647efe7" />
  
- After installation is complete, exit Visual Studio if it was started automatically

## CUDA Toolkit 12.8
- <u>Important</u>:
	- Dont start installation until Visual Studio has completed installation
	- if you have another version of CUDA Toolkit, uninstall it and re-install CUDA Toolkit 12.
- Download from https://developer.nvidia.com/cuda-12-8-0-download-archive
- Select windows as your operating system, select x86_64 as architecture and select your Windows version and select "exe (local)".
- Download the 3.2GB file

<img width="600" alt="image" src="https://github.com/user-attachments/assets/7c11556f-93d7-4a8a-8fab-7222c30e8c9c" />

- After download, execute the file and unpack the installation files in the proposed directory
- Use "express" installation during installation

<img width="400" alt="image" src="https://github.com/user-attachments/assets/f8262aaa-db90-47fa-b3bf-830c64edbb88" />
  
- After installation is complete, verify if "nsight for Visual Studio 2022" was installed

<img width="400" alt="image" src="https://github.com/user-attachments/assets/6663bfe7-456d-4262-aab7-cf6c25f77e83" />

- Press "next" and close the installation


## Git
- Download Windows installer from https://git-scm.com/downloads
- Follow instructions, use default settings for all options (there are many)
- Close installation after completion

## Perl
- Install Strawberry Perl from https://strawberryperl.com/, or via your favorite package manager (e.g. scoop, chocolatey, ...)

# Step 2: Verifying your prerequisites

- Press start and find "x64 native tools command prompt for VS 2022"
- Type the following commands to verify your installation:
	```powershell
	cmake --version
	
	nvcc --version
	
	git --version

        perl --version
	```
- Cmake: Must be 3.30 or higher
- nvcc: Verify that 12.8 is being used
- git: Verify that git shows version information
- perl: Must be 5.42 or higher

<img width="1108" height="622" alt="image" src="https://github.com/user-attachments/assets/9cdee296-47f4-4cde-8072-03829ecc6342" />


# Step 3: Downloading and building LichtFeld Studio

- Press start and find "x64 native tools command prompt for VS 2022"
Execute the commands below:

- go to your user directory
	```powershell
	cd %userprofile%
	```

- Create a directory "repos".

	note: create this folder in a directory that does not contain spaces or the build process will fail later
	```powershell
	mkdir repos
	```
- Go to the directory "repos"
	```powershell
	cd repos
	```
- Set up vcpkg (one-time setup)
	```powershell
	git clone https://github.com/microsoft/vcpkg.git
	cd vcpkg && .\bootstrap-vcpkg.bat -disableMetrics && cd ..
	```
- Clone repository
	```powershell
	git clone --recurse-submodules https://github.com/MrNeRF/LichtFeld-Studio
	```
- Checkout stable version
	```powershell
	cd LichtFeld-Studio
	git checkout v0.4.0
	```
- Build configuration files and download dependencies
	```powershell
	cmake -B build -DCMAKE_BUILD_TYPE=Release -G Ninja -DCMAKE_TOOLCHAIN_FILE="../vcpkg/scripts/buildsystems/vcpkg.cmake"
    ```
- Build LichtFeld Studio
	```powershell
	cmake --build build -j
	```
After the last step is complete, you should have a new directory "\build" where you can find "LichtFeld-Studio.exe" and you can execute that file to run LichtFeld Studio.

<img width="1110" height="683" alt="image" src="https://github.com/user-attachments/assets/605c5b3a-53b3-4f16-85e2-05e9af2327cd" />

<img width="1200" alt="image" src="https://github.com/user-attachments/assets/b3526d79-b30a-492c-8589-42be60d29d11" />


# Updating
If you have an earlier version of LichtFeld Studio and want to upgrade to the latest release, you can use these instructions:

- Press start and find "x64 native tools command prompt for VS 2022"
- go to the directory where you installed LichtFeld Studio and execute the commands:

	```powershell
	cd vcpkg
        git pull
        cd ..
	cd LichtFeld-Studio
	git pull
	git checkout v0.5.1
	git pull
	cmake --build build -j
	```

This will update vcpkg if required, and after that, we grab the latest version of LichtFeld-Studio and build it from source again.

If you would like to test and build the latest source release:
	```powershell
	cd vcpkg
        git pull
        cd ..
	cd LichtFeld-Studio
	git pull
	git checkout master
	git pull
	cmake --build build -j
	```


# Troubleshooting

**Before anything else:**
- Make sure you run all commands from the "x64 native tools command prompt for VS 2022" (not standard command or cmd or powershell or "developer command prompt for VS 2022")
- Verify if you have the proper requirements installed -see Step 2
- Uninstall all CUDA Toolkit versions and re-install 12.8
- Delete the build directory, and restart the instructions from Step 3

## Common issues
### Release build works, but debug build fails with error "cannot open file 'python313_d.lib'"
- This could be missing python debug libraries
- Run the python setup again, choose "modify" and select "download debug binaries"
- Copy the files python313_d.lib from your python installation directory to the build\debug directory

### vcpkg fails to install depenencies due to permission errors

An example may look like this:
```
error: rename_or_delete("###/vcpkg/buildtrees/versioning_/versions/args/eca261df4af60a96e04f46c28f27e5aeee0290a1_46724.tmp", "###\vcpkg\buildtrees\versioning_\versions\args\eca261df4af60a96e04f46c28f27e5aeee0290a1"): unknown errornote: while checking out port args with git tree eca261df4af60a96e04f46c28f27e5aeee0290a1

note: See https://learn.microsoft.com/vcpkg/users/versioning-troubleshooting?WT.mc_id=vcpkg_inproduct_cli for more information.

note: while loading args@6.4.7
```
Deleting buildtrees and regenerating won't fix the issue.

The solution is to find the source of the problem: what blocks delete/rename.
Try these first:
1. Temporarily add the `repos` folder containing LichtFeld-Studio and vcpkg to the antivirus exclude list (e.g. Windows Security > Virus & threat protection > Exclusions for Windows defender or the equivalent of the AV software you use)
2. Temporarily pause any file search/indexing services (e.g. run `services.msc` and stop Windows Search (or similar custom search services))
3. Temporarily pause file sync services (e.g. DropBox, OneDrive, GoogleDrive, etc.), especially if they access parent folders.

This should resolve the issue and dependencies should intall via vcpkg.

If the problem persists, you may need to investigate deeper and [procmon](https://learn.microsoft.com/en-us/sysinternals/downloads/procmon) can help filter changes to the `repos` subfolders and find access denied / shared violation type of events and their sources.

### Cannot open include file

<img width="600" alt="image" src="https://github.com/user-attachments/assets/60eaae64-3b85-42af-9276-31550b5d3d33" />

- Run the visual studio installation and modify the installation. Verify you have the C++ package installed (see step 1)

### Building does not generate the .exe, but only the lib file

<img width="600" alt="image" src="https://github.com/user-attachments/assets/28b2ed73-d0b1-492a-aa1d-7762391e94d1" />

- Possible cause: build files not up-to date with latest changes
- Solution: Re-generate the configuration files using in the command prompt and rebuild LichtFeld Studio
	```powershell
	cmake -B build -DCMAKE_BUILD_TYPE=Release -G Ninja -DCMAKE_TOOLCHAIN_FILE="../vcpkg/scripts/buildsystems/vcpkg.cmake"
	cmake --build build -j
	```
### Unable to find Ninja ###
```
CMake Error: CMake was unable to find a build program corresponding to "Ninja".  CMAKE_MAKE_PROGRAM is not set.  You probably need to select a different build tool.
CMake Error: CMAKE_CUDA_COMPILER not set, after EnableLanguage
CMake Error: CMAKE_CXX_COMPILER not set, after EnableLanguage
CMake Error: CMAKE_C_COMPILER not set, after EnableLanguage
-- Configuring incomplete, errors occurred!
```
- Possible cause 1: your build directory is containing a SPACE in the path.  The log file will show something like:
```
-- Warning: Paths with embedded space may be handled incorrectly by configure:
   D:/repo space/repos/vcpkg/packages/hwloc_x64-windows
   D:/repo space/repos/LichtFeld-Studio/build/vcpkg_installed/x64-windows
   Please move the path to one without whitespaces!
```
Solution: move your directory structure (`LichtFeld-Studio` and `vcpkg`) to a directory without a space.



- Possible cause 2: There is a problem with your current vcpkg installation

Solution: Delete repos/vcpkg and redo the vcpkg setup step

### Out of memory
- If you find this in your build output
```
catastrophic error: out of memory
```
- Reduce used threads:
```
cmake --build build -j4 # 4 threads
```

### Important for non English Windows installations

If your Windows installation is not using English as the default language, Visual Studio may install a non English language pack.  
This can cause vcpkg to fail when building certain dependencies, such as `expat`, due to localization related issues in the Visual Studio toolchain.

To avoid this, or to fix build failures already encountered:

1. Open the Visual Studio Installer  
2. Select "Modify"  
3. Remove all non English language packs  
4. Install the "English" language pack  
5. Apply changes and restart the x64 Native Tools Command Prompt

After applying these changes, retry the build process.

### Other things to check
- Type "set" in the console
- Verify the following environment variables
	- CUDA_ROOT -> must point to your cuda toolkit installation
   	- INCLUDE -> must point to your Visual Studio installation
   	- PATH -> must contain path to all binaries of the installed tools (Python, Visual Studio, CUDA Toolkit, Git)

### Manual installation of CUDA in Visual Studio
- set CUDA_ROOT environment variable manually
- copy the files from
	`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\extras\visual_studio_integration\MSBuildExtensions`
   	to
   	`C:\Program Files\Microsoft Visual Studio\ 2022 \Community\MSBuild\Microsoft\VC\v170\BuildCustomizations`
# Export Design Archive File

## Plugin Introduction

This is a batch export plugin specifically designed for JLCEDA, supporting the bulk export of design resources such as project files, component libraries, and package libraries. The extension is particularly suitable for offline client users, enabling convenient export of design resources as local files for backup or migration.

## Main Features

The plugin provides the following export functions:

### 🔧 Export Project Archive

- Export all projects under the specified owner in bulk
- Supports version-adaptive formats
- Export without opening the project
  ![img.png](images/img.png)

### 📦 Export Device Archive

- Batch export devices from the library
- Supports version-adaptive format
- Supports paginated export, with the option to set the number of records exported per batch
  ![img_1.png](images/img_1.png)

### 📋 Export Device List

- Export the detailed list of the device library
- Supports exporting in Excel format
- After editing the list, you can batch refresh device parameters using the built-in batch component creation feature in the editor
  ![img_2.png](images/img_2.png)

### 🔌 Export Footprint Archive

- Batch export of encapsulated library resources
- Supports exporting by library category
- The number of exports per session can be set (maximum 2000)
- Supports both paginated export and full export modes
- Facilitates backup and sharing of encapsulated libraries
  ![img_3.png](images/img_3.png)

### 🏷️ Export Device Archive (Based on LCSC Part No.)

- Export components based on LCSC Mall part numbers
- Supports version-adaptive format
- Facilitates correspondence with the LCSC component library
  ![img_4.png](images/img_4.png)


# ==================================================================
# Application.mk — Configuration globale Android NDK
# ==================================================================

# Architectures supportées (ARM 32-bit, ARM 64-bit pour téléphones Android récents)
APP_ABI := armeabi-v7a arm64-v8a

# Version minimale de la plateforme Android supportée (Android 5.0 / API 21)
APP_PLATFORM := android-21

# Standard C++ de la bibliothèque STL (Static C++ STL)
APP_STL := c++_static

# Rétrocompatibilité et optimisations
APP_CPPFLAGS := -std=c++17 -fexceptions -frtti
APP_OPTIM := release

# ==================================================================
# Android.mk — Fichier de compilation Android NDK pour libmod.so
# ==================================================================

LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)

# Nom du module (génère libmod.so)
LOCAL_MODULE := mod

# Fichiers sources C++ à compiler
LOCAL_SRC_FILES := main.cpp

# Bibliothèques système Android requises (logcat, etc.)
LOCAL_LDLIBS := -llog -landroid

# Options C++ (C++17, exceptions, RTTI)
LOCAL_CPPFLAGS := -std=c++17 -fexceptions -frtti -Wall

# Génération d'une bibliothèque partagée (.so)
include $(BUILD_SHARED_LIBRARY)

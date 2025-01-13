#!/bin/bash

# Check if we're on Linux
if [ "$(uname)" == "Linux" ]; then
    echo "Installing audio development libraries..."
    if [ -f /etc/debian_version ]; then
        sudo apt-get update
        sudo apt-get install -y libasound2-dev portaudio19-dev libpulse-dev
    elif [ -f /etc/redhat-release ]; then
        sudo yum install -y alsa-lib-devel portaudio-devel pulseaudio-libs-devel
    fi
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install openwakeword numpy soundfile
PULSE_CFLAGS="-I/usr/include/pulse" pip install --upgrade pyaudio

echo "Python setup complete!"

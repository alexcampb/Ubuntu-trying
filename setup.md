# Ubuntu Setup Guide

This guide will help you set up this voice assistant project on Ubuntu ARM64.

## Prerequisites

- Ubuntu 22.04 or later
- Git
- Node.js >= 14 and npm
- Python 3
- VS Code (for development)

## Initial Setup

### 1. Install VS Code (ARM64)
```bash
# Download and install VS Code for ARM64
curl -L https://aka.ms/linux-arm64-deb > code_arm64.deb
sudo apt install ./code_arm64.deb
```

### 2. Install Audio Dependencies
```bash
# Install audio packages and tools
sudo apt update
sudo apt install -y sox libsox-fmt-all pulseaudio alsa-utils

# Configure audio permissions
sudo usermod -a -G audio $USER

# Remove any existing ALSA config
sudo rm -f /etc/asound.conf

# Create new ALSA config
echo 'defaults.pcm.card 0
defaults.ctl.card 0' | sudo tee /etc/asound.conf

# Test audio setup (you should hear white noise, Ctrl+C to stop)
speaker-test -D default -c 2

# Restart pulseaudio
pulseaudio -k
pulseaudio --start
```

### 3. Install Python and Required Packages
```bash
# Install Python and pip
sudo apt update
sudo apt install -y python3 python3-pip python3-venv

# Install audio dependencies
sudo apt-get install -y libasound2-dev portaudio19-dev libpulse-dev
```

### 4. Install Node.js using NVM
```bash
# Install build dependencies
sudo apt-get update
sudo apt-get install -y build-essential

# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell configuration (or restart terminal)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Install Node.js 18 LTS
nvm install node
nvm use node

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 8.x.x or higher
```

### 5. Clone and Setup Repository
```bash
# Clone repository
git clone git@github.com:alexcampb/Ubuntu-trying.git
cd Ubuntu-trying

# Install project dependencies
npm install

# Run setup script
npm run setup
```

## Running the Application

```bash
# Start the voice assistant
node chat.js
```

## Troubleshooting

### Audio Issues
1. Verify audio device is recognized:
```bash
aplay -l
```

2. Check PulseAudio status:
```bash
pulseaudio --check
```

3. Verify audio permissions:
```bash
groups | grep audio
```

4. If you encounter ALSA errors:
- Make sure you're in the audio group
- Log out and log back in after adding to audio group
- Try restarting PulseAudio: `pulseaudio -k && pulseaudio --start`

### Node.js Issues
- If you get "command not found" for nvm, restart your terminal
- Make sure you're using Node.js 18: `node --version`

### Python Issues
- Verify Python installation: `python3 --version`
- Verify pip installation: `pip3 --version`
- If virtual environment fails, try: `python3 -m venv venv`

## Notes
- The voice assistant uses the default audio input/output devices
- Make sure your microphone is properly connected and selected in system settings
- The wake word is "Hey Jarvis"

# Ubuntu Setup Guide

This guide will walk you through setting up this project on Ubuntu.

## Prerequisites

- Ubuntu 22.04 or later
- Git
- Node.js and npm
- Python 3

## Initial Setup

### 1. SSH Key Setup for GitHub
```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your-email@example.com"

# Start the SSH agent
eval "$(ssh-agent -s)"

# Add your SSH key to the agent
ssh-add ~/.ssh/id_ed25519

# Copy your public key (you'll need to add this to GitHub)
cat ~/.ssh/id_ed25519.pub
```

Now add your SSH key to GitHub:
1. Go to GitHub.com → Settings → SSH and GPG keys
2. Click "New SSH key"
3. Paste your public key and save

### 2. Clone the Repository
```bash
git clone git@github.com:alexcampb/Ubuntu-trying.git
cd Ubuntu-trying
```

### 3. Install Dependencies
```bash
# Install project dependencies
npm install

# Run setup script
npm run setup
```

## Known Issues

- SSH authentication required for GitHub access
- More issues will be documented as we encounter them

## Running the Application

```bash
# Start the main application
npm start

# Test wake word detection
npm run test-wake
```

---
*This document will be updated as we discover and resolve setup issues.*

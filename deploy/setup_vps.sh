#!/bin/bash
# JARVIS VPS Setup Script
# Ubuntu 22.04 pe chalao: bash setup_vps.sh

set -e

echo "=== JARVIS VPS Setup ==="

# 1. System update
apt-get update -y
apt-get install -y python3 python3-pip git wget unzip xvfb

# 2. Chrome install (for WhatsApp/Facebook Selenium)
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y ./google-chrome-stable_current_amd64.deb
rm google-chrome-stable_current_amd64.deb

# 3. Python deps (no PyAudio on server — voice not needed)
pip3 install anthropic flask requests duckduckgo-search psutil python-dotenv \
             beautifulsoup4 colorama rich selenium webdriver-manager

# 4. .env file
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo ">>> .env file create hua — ANTHROPIC_API_KEY daalo:"
    echo "    nano .env"
fi

echo ""
echo "=== Setup complete! ==="
echo "Next steps:"
echo "  1. nano .env  (API key daalo)"
echo "  2. python3 main.py --text  (text mode, no voice)"

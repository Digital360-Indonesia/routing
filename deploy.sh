#!/bin/bash

# Deploy script parametrik untuk multi-user setup
# Dijalankan oleh syanampro, tapi PM2 jalan sebagai user yang didefine di .deployrc

set -e  # Exit on error

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.deployrc" ]; then
    source "$SCRIPT_DIR/.deployrc"
else
    echo "❌ Error: .deployrc not found!"
    exit 1
fi

echo "🚀 Starting deployment..."
echo "👤 Deploy user: $DEPLOY_USER"
echo "📦 PM2 app: $PM2_APP_NAME"
echo "🌿 Branch: $DEPLOY_BRANCH"

# Pindah ke directory project
cd "$SCRIPT_DIR" || exit 1

echo "📥 Pulling latest code from GitHub (as syanampro)..."
git pull origin "$DEPLOY_BRANCH"

echo "📦 Installing dependencies (as $DEPLOY_USER)..."
sudo -u "$DEPLOY_USER" npm install --production

echo "♻️ Restarting PM2 process (as $DEPLOY_USER)..."
# Cek apakah app sudah ada di PM2
if sudo -u "$DEPLOY_USER" pm2 list | grep -q "$PM2_APP_NAME"; then
    sudo -u "$DEPLOY_USER" pm2 restart "$PM2_APP_NAME"
else
    sudo -u "$DEPLOY_USER" pm2 start server.js --name "$PM2_APP_NAME"
fi

echo "✅ Deployment completed!"
echo "📊 PM2 Status:"
sudo -u "$DEPLOY_USER" pm2 list

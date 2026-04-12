#!/bin/bash
set -e

echo "🚀 Deploying Voice AI to Production"
echo "=================================="

# Navigate to project directory
cd /opt/ai-assistant || { echo "❌ Project directory not found"; exit 1; }

# Pull latest changes from the branch
echo "📥 Pulling latest code from branch..."
git fetch origin
git checkout claude/implement-mcp-server-2xxSS
git pull origin claude/implement-mcp-server-2xxSS

# Build Docker images
echo "🏗️  Building Docker images..."
docker compose build --no-cache backend frontend

# Start services
echo "🔄 Starting services..."
docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to become healthy..."
sleep 30

# Check health status
echo "✅ Checking service health..."
docker compose ps

echo ""
echo "🎉 Deployment complete!"
echo "=================================="
echo "Frontend: https://app.neurosetu.cloud"
echo "API: https://api.neurosetu.cloud"
echo ""
echo "Next steps:"
echo "1. Test Phone Numbers page - link a Vobiz number"
echo "2. Assign an agent to the number"
echo "3. Configure webhook in Vobiz dashboard"
echo "4. Test inbound calls"

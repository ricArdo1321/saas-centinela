#!/bin/bash

# Stop script on error
set -e

echo "🚀 Starting Centinela Agents Update..."

# 1. Pull latest changes
echo "⬇️  Pulling latest code from git..."
git pull origin main

# 2. Check for .env file
if [ ! -f agents/.env ]; then
    echo "⚠️  agents/.env not found! Creating from .env.example..."
    cp agents/.env.example agents/.env
    echo "❗ Please edit agents/.env and add your OPENAI_API_KEY before continuing."
    echo "   Correct format: OPENAI_API_KEY=sk-..."
    exit 1
fi

# 3. Build and restart containers
echo "🔄 Rebuilding and restarting agents..."
if command -v docker-compose &> /dev/null; then
    docker-compose -f agents/docker-compose.yml up -d --build
else
    docker compose -f agents/docker-compose.yml up -d --build
fi

echo "✅ Update complete! Agents are running."
echo "📜 Logs: docker compose -f agents/docker-compose.yml logs -f"

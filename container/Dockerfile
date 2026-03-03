FROM node:20-slim

# Install system dependencies for build tools and node-pty
RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    build-essential \
    python3 \
    tar \
    gzip \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm and nx globally
RUN npm install -g pnpm nx

# Set up the container application
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy the pre-built application
COPY dist/ ./dist/

# Create workspace directory (project files synced here at runtime)
RUN mkdir -p /workspace && chown node:node /workspace

# Use non-root user for security
USER node
ENV HOME=/workspace

EXPOSE 8080

# Health check for ALB
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/server.js"]

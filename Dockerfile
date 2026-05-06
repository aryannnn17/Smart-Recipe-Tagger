# Multi-stage build for Smart Recipe Tagger
# Stage 1: Build React frontend
FROM node:18-alpine AS client-build

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci

# Copy client source (including .env.production)
COPY client/ ./

# Build React app (Vite will automatically use .env.production)
RUN npm run build

# Stage 2: Setup Node.js server
FROM node:18-alpine AS server-build

WORKDIR /app/server

# Copy server package files
COPY server/package*.json ./

# Install server dependencies
RUN npm ci --only=production

# Stage 3: Production image
FROM node:18-alpine

WORKDIR /workspace

# Copy server code and dependencies
COPY --from=server-build /app/server/node_modules ./node_modules
COPY server/package*.json ./
COPY server/index.js ./
COPY server/analytics.js ./

# Copy built React app from client-build stage
COPY --from=client-build /app/client/dist ./client/dist

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Set environment to production
ENV NODE_ENV=production

# Start the server
CMD ["node", "index.js"]


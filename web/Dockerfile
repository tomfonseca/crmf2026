FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app
COPY web/ ./
RUN pnpm install --frozen-lockfile
EXPOSE 5173 5174

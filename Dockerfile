# syntax=docker/dockerfile:1

# ---- Web 发布阶段：构建静态产物并用 vite preview 提供服务 ----
FROM node:22-bookworm-slim AS web
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8080
# 容器内固定监听 8080；宿主机发布端口由 compose 的 WEB_PORT 控制
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "8080"]

# ---- 一次性验收阶段：类型构建 + Vitest 单元测试 + Playwright 端到端 ----
# 使用与 @playwright/test 版本匹配的官方镜像（内置 Chromium 与系统依赖）
FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS verify
WORKDIR /app
USER root

COPY package.json package-lock.json ./
# 显式确保 npm ci 安装 devDependencies（含 Playwright/TS/Vitest）
ENV NODE_ENV=development
RUN npm ci

COPY . .
RUN chown -R pwuser:pwuser /app
USER pwuser

# 由 compose 的 verify 服务以一次性任务方式运行：
#   npm run build && npm run test && npx playwright test
CMD ["sh", "-c", "npm run build && npm run test && npx playwright test"]

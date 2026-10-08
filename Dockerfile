FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Node runs the TypeScript sources directly, so there is no build step.
# Tests are included so they can run inside the container too (`docker compose run --rm bot npm test`).
COPY faq.json ./
COPY src ./src
COPY test ./test

# Relay map (which owner message belongs to which customer) lives here, on a volume.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

CMD ["node", "src/index.ts"]

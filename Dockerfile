FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN npm install --ignore-scripts --no-audit --no-fund \
  && chown -R node:node /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000
USER node

CMD ["npm", "start"]

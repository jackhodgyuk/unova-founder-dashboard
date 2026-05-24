FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN node --check api/server.js \
  && node --check bot/index.js \
  && node --check dashboard/app.js

EXPOSE 8080

CMD ["npm", "start"]

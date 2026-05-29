FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY server.js ./
ENV NODE_ENV=production
CMD ["node", "server.js"]

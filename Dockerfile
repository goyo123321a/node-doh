FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --only=production && npm cache clean --force

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY index.js ./
EXPOSE 7860
CMD ["node", "index.js"]

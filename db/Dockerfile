FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json import-server.mjs schema.sql ./
RUN npm install --omit=dev
ENV SCHEMA_PATH=/app/schema.sql
EXPOSE 3000
CMD ["node", "import-server.mjs"]

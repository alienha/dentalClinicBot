FROM node:20-slim

# Dependencias de navegador
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala deps de Node
COPY package*.json ./
# Usa ci si tienes package-lock.json; si no, cambia a npm install
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Instala navegadores/dep de Playwright (casan con la versión de tu package.json)
RUN npx playwright install --with-deps

# Copia el resto
COPY . .

EXPOSE 3000

# Arranca tu servidor
CMD ["node", "server.js"]

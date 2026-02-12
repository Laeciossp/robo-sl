# Usa a imagem oficial que JÁ TEM o Chrome instalado
FROM ghcr.io/puppeteer/puppeteer:latest

# Define o diretório de trabalho
WORKDIR /usr/src/app

# --- O PULO DO GATO ---
# Avisa o instalador para NÃO baixar o Chrome de novo
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copia os arquivos de configuração primeiro
COPY package*.json ./

# Instala só as bibliotecas leves (vai ser muito rápido agora)
RUN npm ci

# Copia o resto do código
COPY index.js ./

# Inicia o robô
CMD [ "node", "index.js" ]
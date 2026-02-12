# Usa a imagem oficial que JÁ TEM o Chrome instalado
FROM ghcr.io/puppeteer/puppeteer:latest

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Avisa o instalador para NÃO baixar o Chrome de novo
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copia os arquivos de configuração
COPY package*.json ./

# --- A CORREÇÃO ESTÁ AQUI ---
# Usamos 'npm install' em vez de 'npm ci' porque você ainda não tem o package-lock.json
RUN npm install

# Copia o resto do código
COPY index.js ./

# Inicia o robô
CMD [ "node", "index.js" ]
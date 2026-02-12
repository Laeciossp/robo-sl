# Usa uma imagem pronta que já tem Puppeteer e Chrome configurados
FROM ghcr.io/puppeteer/puppeteer:latest

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia os arquivos do projeto
COPY package*.json ./
COPY index.js ./

# Instala as dependências do projeto
RUN npm install

# Comando para iniciar o robô
CMD [ "node", "index.js" ]
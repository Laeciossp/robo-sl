# Usa a imagem oficial (que já tem Chrome e sabe onde ele está)
FROM ghcr.io/puppeteer/puppeteer:latest

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia os arquivos de configuração
COPY package*.json ./

# Instala as dependências do projeto
# (A imagem já pula o download do Chrome automaticamente, não precisa forçar)
RUN npm install

# Copia o código do robô
COPY index.js ./

# Inicia o robô
CMD [ "node", "index.js" ]
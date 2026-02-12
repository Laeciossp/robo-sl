const { createClient } = require('@sanity/client');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const slugify = require('slugify');
const http = require('http');

puppeteer.use(StealthPlugin());

// --- SERVIDOR MANTÉM VIVO ---
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Robo SL Seguro Ativo');
});
server.listen(process.env.PORT || 8080);

// --- CONFIGURAÇÃO SANITY ---
const client = createClient({
  projectId: 'o4upb251',
  dataset: 'production',
  apiVersion: '2023-05-03',
  useCdn: false, 
  token: 'skmLtdy7ME2lnyS0blM3IWiNv0wuWzBG4egK7jUYdVVkBktLngwz47GbsPPdq5NLX58WJEiR3bmW0TBpeMtBhPNEIxf5mk6uQ14PvbGYKlWQdSiP2uWdBDafWhVAGMw5RYh3IyKhDSmqEqSLg1bEzzYVEwcGWDZ9tEPmZhNDkljeyvY6IcEO' 
});

const generateKey = () => Math.random().toString(36).substring(2, 15);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- FUNÇÕES AUXILIARES ---
async function uploadMediaToSanity(mediaUrl) {
  if (!mediaUrl) return null;
  try {
    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buffer = Buffer.from(response.data, 'binary');
    const asset = await client.assets.upload('image', buffer, { filename: mediaUrl.split('/').pop() });
    return { _type: 'image', asset: { _type: 'reference', _ref: asset._id }, _key: generateKey() };
  } catch (error) { return null; }
}

async function scrapeProductData(page, url) {
    try {
        // Aumentei o timeout e mudei a estratégia de espera
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) { return null; }

    return await page.evaluate(() => {
        // --- TRAVA DE SEGURANÇA 1: VERIFICAR SE É PÁGINA DE PRODUTO ---
        // Se não tiver o elemento básico de produto, assume que é bloqueio
        const isProductPage = document.querySelector('.product-view') || document.querySelector('.product-essential') || document.querySelector('h1');
        if (!isProductPage) return { blocked: true };

        const bodyText = document.body.innerText.toUpperCase();
        
        // Só marca como esgotado se tiver certeza absoluta
        const isOutOfStock = bodyText.includes('SEM ESTOQUE') || 
                             bodyText.includes('ESGOTADO') || 
                             bodyText.includes('INDISPONÍVEL');

        let priceElement = document.querySelector('.special-price .price') || 
                           document.querySelector('.regular-price .price') || 
                           document.querySelector('.price-box .price');
                           
        let priceText = priceElement ? priceElement.innerText.trim() : '0';
        let rawPrice = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

        // Se achou "Access Denied" ou preço zero, marca como suspeito
        if (bodyText.includes('ACCESS DENIED') || bodyText.includes('FORBIDDEN') || rawPrice === 0) {
            if (!isOutOfStock) return { blocked: true }; // Se preço é 0 e não está escrito esgotado, é erro/bloqueio
        }

        let specificColor = 'Padrão';
        const colorRow = Array.from(document.querySelectorAll('#product-attribute-specs-table tr')).find(tr => tr.innerText.includes('Cor'));
        if (colorRow) specificColor = colorRow.querySelector('.data')?.innerText.trim();

        let mainImage = document.querySelector('.MagicToolboxMainContainer a')?.getAttribute('href');

        let sizes = [];
        try {
            const match = document.body.innerHTML.match(/var spConfig = new Product.Config\((.*)\);/);
            if (match) {
                const json = JSON.parse(match[1]);
                const sizeAttr = Object.values(json.attributes).find(a => a.label === 'Tamanho');
                if (sizeAttr) sizes = sizeAttr.options.map(o => o.label);
            }
        } catch (e) { }

        if (sizes.length === 0) sizes = isOutOfStock ? [] : ['Único'];

        const variantLinks = [];
        document.querySelectorAll('#block-related .item a.product-image').forEach(el => variantLinks.push({ url: el.href }));

        return { rawPrice, specificColor, mainImage, sizes, variantLinks, isOutOfStock, blocked: false };
    });
}

function calculatePrice(rawPrice) {
    return parseFloat(((rawPrice * 1.30) + 15.00).toFixed(2));
}

// --- LÓGICA PRINCIPAL ---
async function executarAtualizacao() {
    console.log(`\n🔥 [${new Date().toLocaleString()}] INICIANDO CICLO SEGURO (SL)...`);

    // Busca apenas produtos ATIVOS para não perder tempo com o que já morreu
    const query = `*[_type == "product" && defined(sourceUrl) && brand match "SL" && isActive == true]{ _id, title, sourceUrl, variants, price, isActive }`;
    let sanityProducts = [];
    
    try {
        sanityProducts = await client.fetch(query);
    } catch (e) { console.error("Erro Sanity:", e.message); return; }

    const browser = await puppeteer.launch({ 
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote']
    });
    
    const page = await browser.newPage();
    // Headers extras para parecer humano
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const [index, product] of sanityProducts.entries()) {
        try {
            console.log(`Checking (${index+1}/${sanityProducts.length}): ${product.title}`);
            const mainData = await scrapeProductData(page, product.sourceUrl);
            
            // --- PROTEÇÃO CONTRA BLOQUEIO ---
            if (!mainData || mainData.blocked) {
                console.log(`   ⚠️ LEITURA FALHOU (Provável bloqueio). Pulando produto para segurança.`);
                await sleep(2000); // Espera um pouco para não forçar
                continue; // NÃO DESATIVA, APENAS PULA
            }

            const calculatedPrice = calculatePrice(mainData.rawPrice);
            
            // --- PROTEÇÃO DE PREÇO ZERO ---
            if (calculatedPrice <= 15) { 
                // Se o preço for muito baixo, só desativa se o site disser explicitamente que está esgotado
                if (mainData.isOutOfStock) {
                    console.log(`   ⛔ Esgotado confirmado. Desativando.`);
                    await client.patch(product._id).set({ isActive: false }).commit();
                } else {
                    console.log(`   ⚠️ Preço zerado mas não está 'Esgotado'. Ignorando erro de leitura.`);
                }
                continue;
            }

            // Se chegou aqui, o preço é válido e a página carregou bem
            let siteInventory = {};
            if (mainData.sizes.length > 0) siteInventory[mainData.specificColor.toUpperCase()] = { sizes: mainData.sizes, imageUrl: mainData.mainImage };

            // Verifica variantes (limitado a 2 para ser rápido e discreto)
            for (const variantLink of mainData.variantLinks.slice(0, 2)) {
                if (variantLink.url === product.sourceUrl) continue;
                const variantData = await scrapeProductData(page, variantLink.url);
                if (variantData && !variantData.blocked && variantData.sizes.length > 0) {
                    siteInventory[variantData.specificColor.toUpperCase()] = { sizes: variantData.sizes, imageUrl: variantData.mainImage };
                }
                await sleep(1500); // Pausa maior entre requisições
            }

            if (Object.keys(siteInventory).length === 0) {
                // Só desativa se acessou a página com sucesso e confirmou que está vazio
                console.log(`   ⛔ Sem estoque em nenhuma cor. Desativando.`);
                await client.patch(product._id).set({ isActive: false, variants: [] }).commit();
                continue;
            }

            // ... (Lógica de montagem igual ao anterior) ...
            let currentVariants = product.variants || [];
            let newSanityVariants = [];

            for (const [colorName, colorData] of Object.entries(siteInventory)) {
                let existingVariant = currentVariants.find(v => (v.colorName || 'Única').toUpperCase() === colorName);
                let imageAsset = existingVariant ? existingVariant.variantImage : await uploadMediaToSanity(colorData.imageUrl);

                const mappedSizes = colorData.sizes.map(siteSize => {
                    const existingSize = existingVariant?.sizes?.find(s => s.size === siteSize);
                    return {
                        _key: existingSize?._key || generateKey(),
                        size: siteSize,
                        price: calculatedPrice,
                        stock: 10,
                        sku: `${slugify(product.title).substring(0,10)}-${colorName}-${siteSize}`.toUpperCase()
                    };
                });

                newSanityVariants.push({
                    _key: existingVariant?._key || generateKey(),
                    _type: 'object',
                    colorName: colorName.charAt(0) + colorName.slice(1).toLowerCase(),
                    variantImage: imageAsset,
                    sizes: mappedSizes
                });
            }

            await client.patch(product._id).set({ variants: newSanityVariants, price: calculatedPrice, isActive: true }).commit();
            console.log("   ✅ Atualizado.");
            
        } catch (err) { console.error(`Erro processando ${product.title}: ${err.message}`); }
    }

    await browser.close();
    console.log(`✅ [${new Date().toLocaleString()}] CICLO FINALIZADO.`);
}

// --- LOOP ETERNO ---
executarAtualizacao();
const INTERVALO_24H = 24 * 60 * 60 * 1000;
setInterval(() => {
    executarAtualizacao();
}, INTERVALO_24H);
console.log("⏳ MODO SEGURO ATIVADO: Monitorando a cada 24h.");
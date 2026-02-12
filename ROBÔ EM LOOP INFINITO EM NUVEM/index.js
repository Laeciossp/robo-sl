const { createClient } = require('@sanity/client');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const slugify = require('slugify');
const http = require('http'); // Necessário para a nuvem não desligar o robô

puppeteer.use(StealthPlugin());

// --- 1. MANTÉM O ROBÔ VIVO NA NUVEM ---
// Cria um servidor simples para o Railway/Render saber que estamos online
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Robo SL Ativo e Operando!');
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
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) { return null; }

    return await page.evaluate(() => {
        const bodyText = document.body.innerText.toUpperCase();
        const isOutOfStock = bodyText.includes('SEM ESTOQUE') || bodyText.includes('ESGOTADO') || bodyText.includes('INDISPONÍVEL');

        let priceElement = document.querySelector('.special-price .price') || document.querySelector('.regular-price .price') || document.querySelector('.price-box .price:not(.old-price .price)');
        let priceText = priceElement ? priceElement.innerText.trim() : '0';
        let rawPrice = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

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

        return { rawPrice, specificColor, mainImage, sizes, variantLinks, isOutOfStock };
    });
}

function calculatePrice(rawPrice) {
    return parseFloat(((rawPrice * 1.30) + 15.00).toFixed(2));
}

// --- LÓGICA PRINCIPAL ---
async function executarAtualizacao() {
    console.log(`\n🔥 [${new Date().toLocaleString()}] INICIANDO CICLO DE ATUALIZAÇÃO SL...`);

    const query = `*[_type == "product" && defined(sourceUrl) && brand match "SL"]{ _id, title, sourceUrl, variants, price, isActive }`;
    let sanityProducts = [];
    
    try {
        sanityProducts = await client.fetch(query);
    } catch (e) { console.error("Erro ao conectar Sanity:", e.message); return; }

    // BROWSER PARA NUVEM (Headless e Sem Sandbox)
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const [index, product] of sanityProducts.entries()) {
        try {
            console.log(`Checking (${index+1}/${sanityProducts.length}): ${product.title}`);
            const mainData = await scrapeProductData(page, product.sourceUrl);
            if (!mainData) continue;

            const calculatedPrice = calculatePrice(mainData.rawPrice);
            if (calculatedPrice <= 15) { 
                await client.patch(product._id).set({ isActive: false }).commit();
                continue;
            }

            let siteInventory = {};
            if (mainData.sizes.length > 0) siteInventory[mainData.specificColor.toUpperCase()] = { sizes: mainData.sizes, imageUrl: mainData.mainImage };

            // Verifica variantes (limitado a 3 para economizar CPU da nuvem)
            for (const variantLink of mainData.variantLinks.slice(0, 3)) {
                if (variantLink.url === product.sourceUrl) continue;
                const variantData = await scrapeProductData(page, variantLink.url);
                if (variantData && variantData.sizes.length > 0) {
                    siteInventory[variantData.specificColor.toUpperCase()] = { sizes: variantData.sizes, imageUrl: variantData.mainImage };
                }
                await sleep(1000);
            }

            if (Object.keys(siteInventory).length === 0) {
                await client.patch(product._id).set({ isActive: false, variants: [] }).commit();
                continue;
            }

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
            
        } catch (err) { console.error(`Erro no produto ${product.title}: ${err.message}`); }
    }

    await browser.close();
    console.log(`✅ [${new Date().toLocaleString()}] CICLO FINALIZADO.`);
}

// --- LOOP ETERNO ---
// Roda imediatamente ao ligar
executarAtualizacao();

// Roda a cada 24 horas (em milissegundos)
const INTERVALO_24H = 24 * 60 * 60 * 1000;
setInterval(() => {
    executarAtualizacao();
}, INTERVALO_24H);

console.log("⏳ SISTEMA DE LOOP INICIADO: Rodando a cada 24h.");
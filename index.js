require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

function cleanJson(text) {
  return text.replace(/```json|```/g, "").trim();
}

function getImageFiles(imagesDir) {
  if (!fs.existsSync(imagesDir)) return [];

  const allowed = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  return fs
    .readdirSync(imagesDir)
    .map((name) => path.join(imagesDir, name))
    .filter((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return allowed.has(ext) && fs.statSync(filePath).isFile();
    })
    .sort();
}

function toBase64Attachment(filePath) {
  return fs.readFileSync(filePath).toString("base64");
}

async function getShopifyAccessToken() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "");
  const url = `https://${shop}/admin/oauth/access_token`;

  const body = new URLSearchParams({
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const rawText = await response.text();

  let result;
  try {
    result = JSON.parse(rawText);
  } catch {
    throw new Error(
      `TOKEN SHOPIFY NON JSON\n${rawText.slice(0, 500)}`
    );
  }

  if (!response.ok || !result.access_token) {
    throw new Error(`TOKEN SHOPIFY ERREUR\n${JSON.stringify(result, null, 2)}`);
  }

  return result.access_token;
}

async function extractProductDataFromWhatsApp(whatsappText) {
  if (!whatsappText || !whatsappText.trim()) {
    return {
      title: "Produit sans titre",
      vendor: "Generic",
      product_type: "Autre",
      price_mad: "0",
      description_html: "<p>Description non disponible.</p>",
      tags: ["produit", "shopify", "maroc"],
    };
  }

  const prompt = `
You extract Shopify product data from supplier WhatsApp messages for an electronics store in Morocco.

Return ONLY valid JSON with this exact structure:
{
  "title": "",
  "vendor": "",
  "product_type": "",
  "price_mad": "",
  "description_html": "",
  "tags": ["", "", "", "", ""]
}

Rules:
- Write title and description in French
- description_html must be simple valid HTML
- If vendor is unknown, use "Generic"
- If product_type is unknown, use "Autre"
- If price is unknown, return "0"
- If title is unknown, use "Produit sans titre"
- Tags should be short and useful
- No markdown
- No code fences

Supplier WhatsApp text:
${whatsappText}
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  const parsed = JSON.parse(cleanJson(response.text));

  return {
    title: parsed.title || "Produit sans titre",
    vendor: parsed.vendor || "Generic",
    product_type: parsed.product_type || "Autre",
    price_mad: String(parsed.price_mad || "0").replace(/[^\d.]/g, "") || "0",
    description_html:
      parsed.description_html || "<p>Description non disponible.</p>",
    tags:
      Array.isArray(parsed.tags) && parsed.tags.length
        ? parsed.tags.filter(Boolean).slice(0, 10)
        : ["produit", "shopify", "maroc"],
  };
}

async function createShopifyProduct(shopifyToken, productData, imagePath, index) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "");
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-10";
  const url = `https://${shop}/admin/api/${apiVersion}/products.json`;

  const payload = {
    product: {
      title: `${productData.title} ${index + 1}`,
      body_html: productData.description_html,
      vendor: productData.vendor,
      product_type: productData.product_type,
      status: "draft",
      tags: productData.tags.join(", "),
      variants: [
        {
          price: productData.price_mad || "0",
          inventory_management: null,
          inventory_policy: "deny",
          requires_shipping: true,
        },
      ],
      images: [
        {
          attachment: toBase64Attachment(imagePath),
          filename: path.basename(imagePath),
        },
      ],
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": shopifyToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();

  let result;
  try {
    result = JSON.parse(rawText);
  } catch {
    throw new Error(
      `CREATION PRODUIT NON JSON pour ${path.basename(imagePath)}\n${rawText.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `CREATION PRODUIT ERREUR pour ${path.basename(imagePath)}\n${JSON.stringify(result, null, 2)}`
    );
  }

  return result.product;
}

async function run() {
  try {
    const whatsappPath = path.join(__dirname, "whatsapp.txt");
    const imagesDir = path.join(__dirname, "decoded_images");

    const whatsappText = fs.existsSync(whatsappPath)
      ? fs.readFileSync(whatsappPath, "utf8").trim()
      : "";

    const productData = await extractProductDataFromWhatsApp(whatsappText);
    const imagePaths = getImageFiles(imagesDir);

    if (imagePaths.length === 0) {
      throw new Error("Aucune image trouvée dans decoded_images");
    }

    console.log(`Images trouvées: ${imagePaths.length}`);
    console.log(`Titre base: ${productData.title}`);
    console.log(`Prix: ${productData.price_mad}`);

    const shopifyToken = await getShopifyAccessToken();

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      console.log(`Création produit ${i + 1}/${imagePaths.length}: ${path.basename(imagePath)}`);

      const product = await createShopifyProduct(shopifyToken, productData, imagePath, i);

      console.log(`OK -> ID ${product.id} | ${product.title}`);
    }

    console.log("Terminé.");
  } catch (error) {
    console.error("\nErreur:");
    console.error(error.message || error);
  }
}

run();
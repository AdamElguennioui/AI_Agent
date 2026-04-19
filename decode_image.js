const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "Pasted text.txt");
const outputDir = path.join(__dirname, "decoded_images");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const raw = fs.readFileSync(inputPath, "utf8");

// each line is likely one base64 jpeg
const chunks = raw
  .split(/\r?\n/)
  .map((x) => x.trim())
  .filter((x) => x.startsWith("/9j/"));

if (chunks.length === 0) {
  console.log("No JPEG base64 data found.");
  process.exit(0);
}

chunks.forEach((b64, index) => {
  const buffer = Buffer.from(b64, "base64");
  const filePath = path.join(outputDir, `image_${index + 1}.jpg`);
  fs.writeFileSync(filePath, buffer);
  console.log(`Saved: ${filePath}`);
});

console.log(`Done. ${chunks.length} image(s) created.`);
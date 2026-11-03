const fs = require("fs");
const pdfModule = require("pdf-parse");

async function extractTextFromPDF(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);

    // Support pdf-parse v2 (PDFParse class)
    if (pdfModule && typeof pdfModule.PDFParse === "function") {
      const parser = new pdfModule.PDFParse({
        data: fileBuffer,
      });
      const result = await parser.getText();
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
      if (result && result.text && result.text.trim()) {
        return result.text;
      }
    }

    // Support pdf-parse v1 (function)
    if (typeof pdfModule === "function") {
      const result = await pdfModule(fileBuffer);
      if (result && result.text && result.text.trim()) {
        return result.text;
      }
    }

    return "";
  } catch (err) {
    console.warn("PDF text layer extraction note:", err.message);
    return "";
  }
}

module.exports = {
  extractTextFromPDF,
};

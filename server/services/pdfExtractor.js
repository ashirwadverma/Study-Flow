const fs = require("fs");
const { PDFParse } = require("pdf-parse");

async function extractTextFromPDF(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({
      data: fileBuffer,
    });
    const result = await parser.getText();
    await parser.destroy();
    return (result && result.text) ? result.text : "";
  } catch (err) {
    console.warn("PDF text layer extraction note:", err.message);
    return "";
  }
}

module.exports = {
  extractTextFromPDF,
};

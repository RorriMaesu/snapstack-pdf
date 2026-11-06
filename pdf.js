"use strict";

async function imageToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image encoding failed.")), "image/jpeg", 0.92);
    });
    return { jpeg, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

async function buildPdf(pages, onProgress) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0];
  let length = 0;

  function append(part) {
    const data = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(data);
    length += data instanceof Blob ? data.size : data.byteLength;
  }

  function object(id, ...contents) {
    offsets[id] = length;
    append(`${id} 0 obj\n`);
    for (const content of contents) append(content);
    append("\nendobj\n");
  }

  // Each page has three consecutive objects: the page, its drawing, and its JPEG.
  const pageIds = pages.map((_, index) => 3 + index * 3);
  append("%PDF-1.4\n");
  append(Uint8Array.of(37, 226, 227, 207, 211, 10));
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] >>`);

  for (const [index, page] of pages.entries()) {
    onProgress(index + 1, pages.length);
    let image;
    try {
      image = await imageToJpeg(page.file);
    } catch {
      throw new Error(`Couldn't prepare “${page.file.name}” for the PDF.`);
    }
    const { jpeg, width, height } = image;
    const landscape = width > height;
    const scale = Math.min((landscape ? 792 : 612) / width, (landscape ? 612 : 792) / height);
    const pageWidth = Math.max(0.01, width * scale).toFixed(3);
    const pageHeight = Math.max(0.01, height * scale).toFixed(3);
    const id = pageIds[index];
    const drawing = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, `<< /Length ${drawing.length} >>\nstream\n${drawing}endstream`);
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>\nstream\n`, jpeg, "\nendstream");
  }

  const xref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) append(`${String(offset).padStart(10, "0")} 00000 n \n`);
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

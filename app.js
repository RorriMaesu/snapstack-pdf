"use strict";

const byId = id => document.getElementById(id);
const fileInput = byId("files");
const browse = byId("browse");
const dropZone = byId("drop-zone");
const queue = byId("queue");
const filename = byId("filename");
const destination = byId("destination");
const destinationHelp = byId("destination-help");
const exportButton = byId("export");
const exportLabel = exportButton.querySelector("span");
const stackStatus = byId("stack-status");
const exportStatus = byId("export-status");
const nativeSave = typeof window.showSaveFilePicker === "function" && window.top === window;
const pages = [];
let nextId = 0;
let busy = false;
let draggedId = null;

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function span(className, value) {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = value;
  return element;
}

function status(element, message = "", kind = "") {
  element.textContent = message;
  element.dataset.kind = kind;
}

function control(action, symbol, label, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.disabled = disabled;
  button.append(icon(symbol));
  return button;
}

function render(focusId, focusAction) {
  const list = document.createDocumentFragment();
  for (const [index, page] of pages.entries()) {
    const row = document.createElement("li");
    row.className = "page-row";
    row.dataset.id = page.id;
    row.draggable = !busy;

    const grip = span("grip", "");
    grip.append(icon("grip"));
    const thumb = document.createElement("img");
    thumb.src = page.url;
    thumb.alt = "";
    thumb.className = "thumbnail";
    thumb.draggable = false;
    const details = document.createElement("div");
    details.className = "file-details";
    const name = span("file-name", page.file.name);
    name.title = page.file.name;
    details.append(name, span("dimensions", `${page.width} × ${page.height} px`));
    const controls = document.createElement("div");
    controls.className = "row-controls";
    controls.append(
      control("up", "up", `Move page ${index + 1} up`, busy || index === 0),
      control("down", "chevron", `Move page ${index + 1} down`, busy || index === pages.length - 1),
      control("remove", "close", `Remove page ${index + 1}`, busy)
    );
    row.append(grip, span("page-number", String(index + 1).padStart(2, "0")), thumb, details, controls);
    list.append(row);
  }
  queue.replaceChildren(list);
  byId("empty").hidden = pages.length > 0;
  byId("count").textContent = pages.length === 1 ? "1 page" : `${pages.length} pages`;
  browse.disabled = busy;
  filename.disabled = busy;
  destination.disabled = busy;
  exportButton.disabled = busy || pages.length === 0;

  if (focusAction) {
    const row = queue.querySelector(`[data-id="${focusId}"]`);
    const button = row?.querySelector(`[data-action="${focusAction}"]:enabled`) ??
      row?.querySelector("button:enabled");
    (button || browse).focus();
  }
}

async function preview(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, 144 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!thumbnail) throw new Error("Thumbnail encoding failed.");
    return { width, height, url: URL.createObjectURL(thumbnail) };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

async function addFiles(files) {
  if (busy || files.length === 0) return;
  busy = true;
  render();
  status(stackStatus, "Reading your images…");
  status(exportStatus);
  const unreadable = [];
  for (const file of files) {
    try {
      if (!/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name) &&
          !/^image\/(jpeg|png|webp|gif|bmp|avif)$/i.test(file.type)) {
        throw new Error("Unsupported image format.");
      }
      pages.push({ id: ++nextId, file, ...await preview(file) });
    } catch {
      unreadable.push(file.name);
    }
  }
  busy = false;
  render();
  const added = files.length - unreadable.length;
  if (unreadable.length) {
    const names = unreadable.slice(0, 2).join(", ");
    const extra = unreadable.length > 2 ? ` and ${unreadable.length - 2} more` : "";
    status(stackStatus, `Added ${added}. Couldn’t open ${names}${extra}.`, "error");
  } else {
    status(stackStatus, `Added ${added} ${added === 1 ? "image" : "images"}.`, "success");
  }
}

function movePage(from, to, focusAction) {
  if (from < 0 || to < 0 || to >= pages.length || from === to) return;
  const [page] = pages.splice(from, 1);
  pages.splice(to, 0, page);
  render(page.id, focusAction);
  status(stackStatus, `Moved ${page.file.name} to page ${to + 1}.`);
  status(exportStatus);
}

browse.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  fileInput.value = "";
  void addFiles(files);
});

const hasFiles = event => event.dataTransfer?.types.includes("Files");
for (const type of ["dragover", "drop"]) {
  window.addEventListener(type, event => {
    if (hasFiles(event)) event.preventDefault();
  });
}
dropZone.addEventListener("dragover", event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = busy ? "none" : "copy";
  if (!busy) dropZone.classList.add("over");
});
dropZone.addEventListener("dragleave", event => {
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("over");
});
dropZone.addEventListener("drop", event => {
  dropZone.classList.remove("over");
  if (hasFiles(event)) {
    event.preventDefault();
    void addFiles([...event.dataTransfer.files]);
  }
});

queue.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button || busy) return;
  const index = pages.findIndex(page => page.id === Number(button.closest("li").dataset.id));
  if (index < 0) return;
  const action = button.dataset.action;
  if (action === "remove") {
    const [removed] = pages.splice(index, 1);
    URL.revokeObjectURL(removed.url);
    render(pages[index]?.id ?? pages.at(-1)?.id, action);
    status(stackStatus, `Removed ${removed.file.name}.`);
    status(exportStatus);
    return;
  }
  movePage(index, index + (action === "up" ? -1 : 1), action);
});

function dropAfter(event, row) {
  const { top, height } = row.getBoundingClientRect();
  return event.clientY > top + height / 2;
}

function clearDropMarker() {
  queue.querySelector(".before, .after")?.classList.remove("before", "after");
}

function endDrag() {
  clearDropMarker();
  queue.querySelector(".dragging")?.classList.remove("dragging");
  draggedId = null;
}

queue.addEventListener("dragstart", event => {
  const row = event.target.closest(".page-row");
  if (busy || !row || event.target.closest("button")) {
    event.preventDefault();
    return;
  }
  draggedId = Number(row.dataset.id);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedId));
  row.classList.add("dragging");
});
queue.addEventListener("dragover", event => {
  if (draggedId === null) return;
  clearDropMarker();
  const row = event.target.closest(".page-row");
  if (!row || Number(row.dataset.id) === draggedId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  row.classList.add(dropAfter(event, row) ? "after" : "before");
});
queue.addEventListener("dragleave", event => {
  if (!queue.contains(event.relatedTarget)) clearDropMarker();
});
queue.addEventListener("drop", event => {
  const row = event.target.closest(".page-row");
  if (draggedId === null || !row) return;
  event.preventDefault();
  const from = pages.findIndex(page => page.id === draggedId);
  const target = pages.findIndex(page => page.id === Number(row.dataset.id));
  const insertion = target + (dropAfter(event, row) ? 1 : 0);
  endDrag();
  movePage(from, insertion - (from < insertion ? 1 : 0));
});
queue.addEventListener("dragend", endDrag);

function updateDestinationHelp() {
  if (destination.value === "pick") {
    destinationHelp.textContent = "Choose a folder when you create the PDF.";
  } else if (!nativeSave) {
    destinationHelp.textContent = "To choose a folder here, enable your browser’s “ask where to save” download setting.";
  } else {
    destinationHelp.textContent = "Use your browser’s download settings.";
  }
}

function outputName() {
  let base = filename.value.trim().replace(/(?:\.pdf)+$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(base)) base = `_${base}`;
  return `${base || "my-image-stack"}.pdf`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

byId("export-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !pages.length) return;
  const name = outputName();
  const chooseLocation = destination.value === "pick";
  busy = true;
  render();
  status(exportStatus);
  exportLabel.textContent = chooseLocation ? "Choose a location…" : "Creating PDF…";
  try {
    let handle;
    if (chooseLocation) {
      try {
        // Open the picker before any encoding awaits so it keeps the click's activation.
        handle = await window.showSaveFilePicker({
          id: "snapstack-pdf",
          suggestedName: name,
          types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
          excludeAcceptAllOption: true
        });
      } catch (error) {
        if (error.name === "AbortError") {
          status(exportStatus, "Save canceled.");
          return;
        }
        status(exportStatus, "The save dialog couldn’t open. Select Browser downloads and try again.", "error");
        return;
      }
    }

    exportLabel.textContent = "Creating PDF…";
    const pdf = await buildPdf(pages, (page, total) => {
      status(exportStatus, `Preparing page ${page} of ${total}…`);
    });
    if (handle) {
      const writer = await handle.createWritable();
      try {
        await writer.write(pdf);
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => {});
        throw error;
      }
      status(exportStatus, `Saved ${handle.name} · ${byId("count").textContent}`, "success");
    } else {
      download(pdf, name);
      status(exportStatus, `Download started for ${name} · ${byId("count").textContent}`, "success");
    }
  } catch (error) {
    const message = error.message?.startsWith("Couldn't prepare") ? error.message : "Couldn’t save the PDF. Check the destination and try again.";
    status(exportStatus, message, "error");
  } finally {
    busy = false;
    exportLabel.textContent = "Create PDF";
    render();
    exportButton.focus();
  }
});

if (!nativeSave) {
  destination.value = "download";
  destination.querySelector('[value="pick"]').disabled = true;
}
destination.addEventListener("change", updateDestinationHelp);
filename.addEventListener("input", () => {
  byId("extension").hidden = /\.pdf\s*$/i.test(filename.value);
});
updateDestinationHelp();
render();

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES } from "../shared/contracts";

export interface IncomingFile {
  name: string;
  mimeType: string;
  data: string;
}

export interface PreparedUploads {
  images: { data: string; mimeType: string }[];
  attachments: { type: "uploaded_file"; id: string; fileName: string; mimeType: string; size: number; path: string }[];
}

const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function uploadsRoot(): string {
  return join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "uploads");
}

function safeName(name: string, index: number): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120);
  return cleaned || `attachment-${index + 1}`;
}

export async function prepareUploads(files: readonly IncomingFile[]): Promise<PreparedUploads> {
  const prepared: PreparedUploads = { images: [], attachments: [] };
  let total = 0;
  for (const [index, file] of files.entries()) {
    const bytes = Buffer.from(file.data, "base64");
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than ${MAX_ATTACHMENT_BYTES} bytes.`);
    total += bytes.length;
    if (total > MAX_ATTACHMENTS_TOTAL_BYTES) throw new Error("The attachments are too large together.");
    if (INLINE_IMAGE_TYPES.has(file.mimeType)) {
      prepared.images.push({ data: file.data, mimeType: file.mimeType });
      continue;
    }
    const id = `upload_${randomUUID()}`;
    const directory = join(uploadsRoot(), id);
    const fileName = safeName(file.name, index);
    const path = join(directory, fileName);
    await mkdir(directory, { recursive: true });
    await writeFile(path, bytes);
    prepared.attachments.push({ type: "uploaded_file", id, fileName, mimeType: file.mimeType, size: bytes.length, path });
  }
  return prepared;
}

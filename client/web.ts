import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface WebFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}
interface WebFileList {
  readonly length: number;
  item(index: number): WebFile | null;
}
interface WebDataTransfer {
  readonly files: WebFileList;
}
interface WebEvent {
  readonly clipboardData?: WebDataTransfer | null;
  readonly dataTransfer?: WebDataTransfer | null;
  preventDefault(): void;
}
interface WebFileReader {
  result: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsDataURL(file: WebFile): void;
}
interface WebInput {
  type: string;
  multiple: boolean;
  files: WebFileList | null;
  onchange: (() => void) | null;
  click(): void;
}
declare const document: {
  addEventListener(type: string, listener: (event: WebEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebEvent) => void): void;
  createElement(tag: "input"): WebInput;
};
declare const FileReader: { new (): WebFileReader };

export interface PickedFile {
  name: string;
  mimeType: string;
  size: number;
  data: string;
}

export const filePickingSupported = Platform.OS === "web";

function read(file: WebFile): Promise<PickedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve({
        name: file.name || "pasted",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        data: url.slice(url.indexOf(",") + 1),
      });
    };
    reader.onerror = () => reject(new Error(`Не удалось прочитать ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function filesOf(list: WebFileList | null | undefined): WebFile[] {
  const files: WebFile[] = [];
  if (!list) return files;
  for (let index = 0; index < list.length; index += 1) {
    const file = list.item(index);
    if (file) files.push(file);
  }
  return files;
}

/** Calls onFiles with files pasted (Ctrl+V) or dropped anywhere in the window. Returns cleanup. */
export function listenForFiles(onFiles: (files: Promise<PickedFile[]>) => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const onPaste = (event: WebEvent) => {
    const files = filesOf(event.clipboardData?.files);
    if (!files.length) return;
    event.preventDefault();
    onFiles(Promise.all(files.map(read)));
  };
  const onDragOver = (event: WebEvent) => event.preventDefault();
  const onDrop = (event: WebEvent) => {
    const files = filesOf(event.dataTransfer?.files);
    if (!files.length) return;
    event.preventDefault();
    onFiles(Promise.all(files.map(read)));
  };
  document.addEventListener("paste", onPaste);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);
  return () => {
    document.removeEventListener("paste", onPaste);
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("drop", onDrop);
  };
}

/** Opens the system file chooser. Resolves with the chosen files, or none on cancel. */
export function pickFiles(): Promise<PickedFile[]> {
  if (Platform.OS !== "web") return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      Promise.all(filesOf(input.files).map(read)).then(resolve, reject);
    };
    input.click();
  });
}

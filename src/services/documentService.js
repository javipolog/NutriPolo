import { invoke } from '@tauri-apps/api/tauri';
import { appDataDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/api/dialog';

let cachedAppDataDir = null;

async function getAppDataPath() {
  if (!cachedAppDataDir) cachedAppDataDir = await appDataDir();
  return cachedAppDataDir;
}

function buildDocumentPath(appData, clientId, storedFileName) {
  return `${appData}documents\\${clientId}\\${storedFileName}`;
}

export async function selectPdfFile() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return selected || null;
}

export async function uploadDocument(sourcePath, clientId, originalFileName) {
  const uuid = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const safeName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedFileName = `${uuid}_${safeName}`;

  const result = await invoke('copy_file_to_documents', {
    sourcePath,
    clientId,
    destFilename: storedFileName,
  });

  // Rust returns "path|size" format
  const [pathPart, sizePart] = (result || '').split('|');
  const appData = await getAppDataPath();
  const expectedPath = buildDocumentPath(appData, clientId, storedFileName);

  return {
    storedFileName,
    fullPath: pathPart || expectedPath,
    fileSize: parseInt(sizePart, 10) || 0,
  };
}

export async function openDocument(clientId, storedFileName) {
  const appData = await getAppDataPath();
  const path = buildDocumentPath(appData, clientId, storedFileName);
  return invoke('open_file', { path });
}

export async function getDocumentBase64(clientId, storedFileName) {
  const appData = await getAppDataPath();
  const path = buildDocumentPath(appData, clientId, storedFileName);
  return invoke('read_file_as_base64', { path });
}

export async function deleteDocumentFile(clientId, storedFileName) {
  const appData = await getAppDataPath();
  const path = buildDocumentPath(appData, clientId, storedFileName);
  return invoke('delete_document_file', { path });
}

export async function deleteClientDocumentsDir(clientId) {
  return invoke('delete_documents_directory', { clientId });
}

export async function saveBytesToDocuments(clientId, fileName, base64Data) {
  const uuid = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedFileName = `${uuid}_${safeName}`;

  const fullPath = await invoke('save_bytes_to_documents', {
    clientId,
    destFilename: storedFileName,
    base64Data,
  });

  return { storedFileName, fullPath };
}

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

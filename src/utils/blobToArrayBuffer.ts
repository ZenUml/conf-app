/** Read a Blob as ArrayBuffer, falling back to FileReader for environments where Blob.arrayBuffer is absent (e.g. older jsdom). */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error ?? new Error('FileReader error'));
    fr.readAsArrayBuffer(blob);
  });
}

/**
 * shared/data-uri.cjs - Shared data URI encoding and download utilities
 *
 * Extracted from prior generator scripts that each had their own
 * copy of imageToDataUri, downloadImage, and MIME detection.
 *
 * Usage:
 *   const { encodeToDataUri, downloadFile, mimeFromExt } = require('./shared/data-uri.cjs');
 *   const uri = await encodeToDataUri('path/to/image.png');
 *   await downloadFile('https://...', 'output.png');
 * @inheritance inheritable
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// MIME type lookup by extension
const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
};

/**
 * Get MIME type from file extension.
 */
function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * Encode a local file to a data URI (data:mime;base64,...).
 */
function encodeToDataUri(filePath) {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const mime = mimeFromExt(filePath);
  return `data:${mime};base64,${base64}`;
}

/**
 * Download a file from a URL with redirect following (max 5 redirects).
 * Returns the output file path on success.
 */
function downloadFile(url, outputPath, maxRedirects = 5) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    const client = url.startsWith('https') ? https : http;

    const request = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); // Drain the redirect response to free the connection
        return downloadFile(res.headers.location, outputPath, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: Failed to download ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          fs.writeFileSync(outputPath, Buffer.concat(chunks));
          resolve(outputPath);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error(`Timeout downloading ${url}`));
    });
  });
}

/**
 * Decode a data URI back to a Buffer.
 */
function decodeDataUri(dataUri) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URI format');
  return {
    mime: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

module.exports = {
  mimeFromExt,
  encodeToDataUri,
  downloadFile,
  decodeDataUri,
  MIME_MAP,
};

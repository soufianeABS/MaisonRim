import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const accountId = process.env.R2_ACCOUNT_ID || '';
const endpoint =
  process.env.R2_S3_API ||
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

const s3Client = new S3Client({
  region: 'auto',
  ...(endpoint ? { endpoint } : {}),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || '';

const S3_PRESIGN_MAX_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 days (SigV4 limit)
const DEFAULT_PRESIGN_EXPIRES_SECONDS = 4 * 24 * 60 * 60; // 4 days

function getPresignExpiresSeconds(): number {
  const raw = process.env.R2_PRESIGNED_URL_EXPIRES_IN_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const desired = Number.isFinite(parsed) ? parsed : DEFAULT_PRESIGN_EXPIRES_SECONDS;
  const clamped = Math.max(1, Math.min(S3_PRESIGN_MAX_EXPIRES_SECONDS, desired));
  return clamped;
}

/**
 * Map common MIME types to file extensions
 */
export function getFileExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: { [key: string]: string } = {
    // Images
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/svg+xml': 'svg',
    // Videos
    'video/mp4': 'mp4',
    'video/mpeg': 'mpeg',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'video/x-flv': 'flv',
    // Audio
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/amr': 'amr',
    'audio/opus': 'opus',
    // Documents
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/zip': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z',
    'application/json': 'json',
    'application/xml': 'xml',
    'text/html': 'html',
    'text/css': 'css',
    'text/javascript': 'js',
    'application/javascript': 'js',
    'application/rtf': 'rtf',
    'application/vnd.oasis.opendocument.text': 'odt',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'application/vnd.oasis.opendocument.presentation': 'odp',
  };
  return mimeToExt[mimeType.toLowerCase()] || 'bin';
}

/**
 * Check if file type is supported by WhatsApp Cloud API
 */
export function isWhatsAppSupportedFileType(mimeType: string): boolean {
  const supportedTypes = [
    // Audio
    'audio/aac',
    'audio/mp4',
    'audio/mpeg',
    'audio/amr',
    'audio/ogg',
    'audio/opus',
    // Documents
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
    'text/plain',
    'application/vnd.ms-excel',
    // Images
    'image/jpeg',
    'image/png',
    'image/webp',
    // Videos
    'video/mp4',
    'video/3gpp',
  ];

  return supportedTypes.includes(mimeType.toLowerCase());
}

/**
 * Download file from WhatsApp and upload to Cloudflare R2 (S3-compatible API)
 */
export async function downloadAndUploadToS3(
  fileUrl: string,
  senderId: string,
  mediaId: string,
  mimeType: string,
  whatsappAccessToken?: string
): Promise<string | null> {
  try {
    console.log(`Downloading file from URL: ${fileUrl}`);

    if (!fileUrl || !senderId || !mediaId || !mimeType) {
      throw new Error('Missing required parameters for R2 upload');
    }

    if (!/^\d{10,15}$/.test(senderId)) {
      throw new Error(`Invalid sender ID format: ${senderId}`);
    }

    if (!/^\d+$/.test(mediaId)) {
      throw new Error(`Invalid media ID format: ${mediaId}`);
    }

    if (!isWhatsAppSupportedFileType(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    const headers: Record<string, string> = {};

    if (fileUrl.includes('lookaside.fbsbx.com') || fileUrl.includes('graph.facebook.com')) {
      if (whatsappAccessToken) {
        headers['Authorization'] = `Bearer ${whatsappAccessToken}`;
        console.log('Added WhatsApp authentication header for media download');
      } else {
        throw new Error('WhatsApp media URL detected but no access token provided');
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(fileUrl, {
      method: 'GET',
      headers: headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith(mimeType.split('/')[0])) {
      console.warn(`Content type mismatch: expected ${mimeType}, got ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const maxSize = 25 * 1024 * 1024;
    if (buffer.length > maxSize) {
      throw new Error(`File too large: ${buffer.length} bytes (max: ${maxSize})`);
    }

    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }

    console.log(`Downloaded file: ${buffer.length} bytes`);

    const fileExtension = getFileExtensionFromMimeType(mimeType);
    const sanitizedSenderId = senderId.replace(/[^0-9]/g, '');
    const s3Key = `${sanitizedSenderId}/${mediaId}.${fileExtension}`;

    console.log(`Uploading to R2: ${s3Key} (${buffer.length} bytes)`);

    // R2 does not support S3 ACLs — omit ACL (objects are private by default for presigned access)
    const uploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: {
        'sender-id': sanitizedSenderId,
        'media-id': mediaId,
        'upload-timestamp': new Date().toISOString(),
        'original-url': fileUrl,
        'file-size': buffer.length.toString(),
        'content-type': mimeType,
      },
    });

    await s3Client.send(uploadCommand);
    console.log('R2 upload successful');

    const presignedUrl = await generatePresignedUrl(sanitizedSenderId, mediaId, mimeType);
    return presignedUrl;
  } catch (error) {
    console.error('Error in downloadAndUploadToS3 (R2):', error);
    return null;
  }
}

/**
 * Upload a File object directly to R2
 */
export async function uploadFileToS3(
  file: File,
  senderId: string,
  mediaId: string
): Promise<string | null> {
  try {
    const fileExtension = getFileExtensionFromMimeType(file.type);
    const s3Key = `${senderId}/${mediaId}.${fileExtension}`;

    console.log(`Uploading file to R2: ${s3Key} (${file.size} bytes)`);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: file.type,
      Metadata: {
        'original-filename': file.name,
        'upload-timestamp': new Date().toISOString(),
      },
    });

    await s3Client.send(uploadCommand);
    console.log('R2 file upload successful');

    const presignedUrl = await generatePresignedUrl(senderId, mediaId, file.type);
    return presignedUrl;
  } catch (error) {
    console.error('Error in uploadFileToS3 (R2):', error);
    return null;
  }
}

/**
 * Upload a Buffer to R2 and return a presigned URL.
 * Used for inbound media from providers that give a downloadUrl.
 */
export async function uploadBufferToS3(
  buffer: Buffer,
  senderId: string,
  mediaId: string,
  mimeType: string,
  originalFilename?: string | null
): Promise<string | null> {
  try {
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer is empty');
    }
    if (!senderId || !mediaId || !mimeType) {
      throw new Error('Missing required parameters for buffer upload');
    }

    const sanitizedSenderId = String(senderId).replace(/[^0-9]/g, '') || 'unknown';
    const sanitizedMediaId = String(mediaId).replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown';

    // Keep same extension mapping for UI previews
    const fileExtension = getFileExtensionFromMimeType(mimeType);
    const s3Key = `${sanitizedSenderId}/${sanitizedMediaId}.${fileExtension}`;

    console.log(`Uploading buffer to R2: ${s3Key} (${buffer.length} bytes)`);

    const uploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: {
        'sender-id': sanitizedSenderId,
        'media-id': sanitizedMediaId,
        'upload-timestamp': new Date().toISOString(),
        ...(originalFilename ? { 'original-filename': String(originalFilename) } : {}),
        'file-size': buffer.length.toString(),
        'content-type': mimeType,
      },
    });

    await s3Client.send(uploadCommand);
    console.log('R2 buffer upload successful');

    // Reuse presign generator (it uses senderId/mediaId + mimeType to build the key)
    return await generatePresignedUrl(sanitizedSenderId, sanitizedMediaId, mimeType);
  } catch (error) {
    console.error('Error in uploadBufferToS3 (R2):', error);
    return null;
  }
}

/**
 * Generate a presigned URL for accessing an object in R2
 */
export async function generatePresignedUrl(
  senderId: string,
  mediaId: string,
  mimeType: string,
  expiresIn: number = getPresignExpiresSeconds()
): Promise<string | null> {
  try {
    const fileExtension = getFileExtensionFromMimeType(mimeType);
    const s3Key = `${senderId}/${mediaId}.${fileExtension}`;

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    console.log(`Generated presigned URL for ${s3Key} (expires in ${expiresIn}s)`);

    return presignedUrl;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return null;
  }
}

/**
 * Check if file exists in R2
 */
export async function checkS3FileExists(
  senderId: string,
  mediaId: string,
  mimeType: string
): Promise<boolean> {
  try {
    const fileExtension = getFileExtensionFromMimeType(mimeType);
    const s3Key = `${senderId}/${mediaId}.${fileExtension}`;

    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    await s3Client.send(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete file from R2
 */
export async function deleteFromS3(
  senderId: string,
  mediaId: string,
  mimeType: string
): Promise<boolean> {
  try {
    const fileExtension = getFileExtensionFromMimeType(mimeType);
    const s3Key = `${senderId}/${mediaId}.${fileExtension}`;

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    await s3Client.send(command);
    console.log(`Deleted R2 object: ${s3Key}`);
    return true;
  } catch (error) {
    console.error('Error deleting from R2:', error);
    return false;
  }
}

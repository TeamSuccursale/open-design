const namedTypes: Record<string, string> = {
  'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/svg+xml': 'SVG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/bmp': 'BMP', 'image/avif': 'AVIF',
  'application/zip': 'ZIP', 'application/x-zip-compressed': 'ZIP', 'application/pdf': 'PDF', 'text/plain': 'TXT', 'text/csv': 'CSV', 'application/json': 'JSON', 'text/xml': 'XML', 'application/xml': 'XML',
  'application/msword': 'DOC', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX', 'application/vnd.ms-excel': 'XLS', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
};
const wildcardTypes: Record<string, string[]> = { 'image/*': ['PNG', 'JPG', 'SVG', 'WebP', 'GIF', 'BMP'], 'audio/*': ['MP3', 'WAV', 'FLAC', 'OGG', 'AAC'], 'video/*': ['MP4', 'WebM', 'MOV'], 'text/*': ['TXT', 'CSV', 'JSON', 'XML'] };
/** Native accept tokens become familiar file formats, without exposing MIME jargon. */
export function acceptedFileTypes(accept: string | undefined): string {
  const formats = (accept ?? '').split(',').flatMap((raw) => { const token = raw.trim().toLowerCase(); if (wildcardTypes[token]) return wildcardTypes[token]!; if (namedTypes[token]) return [namedTypes[token]!]; return /^\.[a-z\d][a-z\d+_-]{0,12}$/.test(token) ? [token.slice(1).toUpperCase()] : []; });
  return [...new Set(formats)].join(', ');
}

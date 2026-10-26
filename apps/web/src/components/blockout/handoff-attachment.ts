/** Recognize only canonical Blockout requests, including an authorized child alias. */
export function blockoutHandoffAttachmentDocument(path: string): string | null {
  const match = /^(?:documents\/([\w.-]+)\/)?blockouts\/([\w.-]+)\/handoffs\/[\w.-]+\.blockout-update\.json$/.exec(path.replaceAll('\\', '/'));
  if (!match || match[2] === '.' || match[2] === '..' || (match[1] && match[1] !== match[2])) return null;
  return match[2]!;
}

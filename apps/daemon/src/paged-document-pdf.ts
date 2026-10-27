/**
 * A designed document printed by the PC's own Chrome or Edge.
 *
 * Without the desktop app the daemon has no renderer of its own, so `od export --format pdf` of a designed
 * document failed, and the desktop's screenshot export would cut an A3 plate into viewport-sized raster pages
 * anyway. A document whose pages declare their paper size therefore goes through headless Chromium's own print:
 * vector text, embedded fonts and each page at its paper size. It gets the same preparation script as the browser
 * export (`document-print.ts` in contracts), and its linked stylesheets are inlined first, because a page opened
 * from a file cannot read the rules of an http stylesheet, and the preparation needs them to settle print media
 * queries.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DOCUMENT_PRINT_PREPARE_SCRIPT,
  HTML_TAG_PATTERNS,
  findRealTagEnd,
  findRealTagOffset,
  inlineLinkedStylesheets,
  prependAfterDoctype,
} from '@open-design/contracts';

import { findBrowserExecutable } from './browser-sessions.js';

const PRINT_TIMEOUT_MS = 120_000;
// Virtual time the document's own scripts get after load; network loads do not consume it.
const VIRTUAL_TIME_BUDGET_MS = 10_000;

export interface PagedDocumentPrintInput {
  html: string;
  /** The http base the document's relative assets resolve against, normally a preview scope. */
  baseHref: string;
  /** A directory the caller owns and removes afterwards. */
  scratchDir: string;
}

/** Resolves to the PDF, or to null when this PC has no browser to print with. */
export type PagedDocumentPrinter = (input: PagedDocumentPrintInput) => Promise<Buffer | null>;

export type PrintProcessRunner = (executable: string, args: string[], timeoutMs: number) => Promise<void>;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** The document as the browser prints it: our base first, so it wins over one of its own, and the preparation. */
export function preparePagedPrintHtml(html: string, baseHref: string): string {
  const base = `<base href="${escapeAttribute(baseHref)}">`;
  const headEnd = findRealTagEnd(html, HTML_TAG_PATTERNS.headOpen);
  const htmlEnd = headEnd >= 0 ? -1 : findRealTagEnd(html, HTML_TAG_PATTERNS.htmlOpen);
  const insertAt = headEnd >= 0 ? headEnd : htmlEnd;
  const based = insertAt >= 0 ? html.slice(0, insertAt) + base + html.slice(insertAt) : prependAfterDoctype(html, base);
  const script = `<script data-md-print-prepare>${DOCUMENT_PRINT_PREPARE_SCRIPT}</script>`;
  const bodyClose = findRealTagOffset(based, HTML_TAG_PATTERNS.bodyClose);
  return bodyClose >= 0 ? based.slice(0, bodyClose) + script + based.slice(bodyClose) : based + script;
}

async function fetchStylesheetText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`stylesheet ${response.status}`);
  return response.text();
}

export const runPrintProcess: PrintProcessRunner = (executable, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-2000); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the browser did not finish printing within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      const detail = stderr.trim().split(/\r?\n/).at(-1);
      if (code === 0) resolve();
      else reject(new Error(`the browser exited with code ${code}${detail ? `: ${detail}` : ''}`));
    });
  });

export async function printPagedDocumentPdf(input: PagedDocumentPrintInput & {
  executable: string;
  fetchText?: (url: string) => Promise<string>;
  run?: PrintProcessRunner;
  timeoutMs?: number;
}): Promise<Buffer> {
  const inlined = await inlineLinkedStylesheets(input.html, {
    baseHref: input.baseHref,
    origin: new URL(input.baseHref).origin,
    fetchText: input.fetchText ?? fetchStylesheetText,
  });
  const prepared = preparePagedPrintHtml(inlined, input.baseHref);
  await mkdir(input.scratchDir, { recursive: true });
  const page = path.join(input.scratchDir, 'print.html');
  const output = path.join(input.scratchDir, 'document.pdf');
  // A file page is decoded as Windows-1252 unless it says otherwise; the signature keeps accented text intact.
  await writeFile(page, prepared.charCodeAt(0) === 0xfeff ? prepared : `﻿${prepared}`, 'utf8');
  await (input.run ?? runPrintProcess)(input.executable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    `--user-data-dir=${path.join(input.scratchDir, 'profile')}`,
    '--no-pdf-header-footer',
    `--virtual-time-budget=${VIRTUAL_TIME_BUDGET_MS}`,
    `--print-to-pdf=${output}`,
    pathToFileURL(page).href,
  ], input.timeoutMs ?? PRINT_TIMEOUT_MS);
  const pdf = await readFile(output).catch(() => null);
  if (!pdf || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('the browser did not produce a PDF');
  }
  return pdf;
}

export function createSystemPagedDocumentPrinter(
  options: { findExecutable?: () => string | null } = {},
): PagedDocumentPrinter {
  return async (input) => {
    const executable = (options.findExecutable ?? findBrowserExecutable)();
    return executable ? printPagedDocumentPdf({ ...input, executable }) : null;
  };
}

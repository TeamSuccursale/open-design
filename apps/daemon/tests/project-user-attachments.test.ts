// The gallery takes in what the engineer attached, so the query must see every
// chat of the project and nothing the agent wrote.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, insertConversation, insertProject, listProjectUserAttachments, openDatabase, upsertMessage } from '../src/db.js';

let tempDir: string;
beforeEach(() => { tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-user-attachments-')); });
afterEach(() => { closeDatabase(); rmSync(tempDir, { recursive: true, force: true }); });

describe('listProjectUserAttachments', () => {
  it('lists the attachments of user messages across the project chats, oldest first', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    const now = Date.now();
    insertProject(db, { id: 'pompei', name: 'Pompei', createdAt: now, updatedAt: now });
    insertProject(db, { id: 'altro', name: 'Altro', createdAt: now, updatedAt: now });
    insertConversation(db, { id: 'chat-1', projectId: 'pompei', title: 'Uno', createdAt: now, updatedAt: now });
    insertConversation(db, { id: 'chat-2', projectId: 'pompei', title: 'Due', createdAt: now, updatedAt: now });
    insertConversation(db, { id: 'chat-3', projectId: 'altro', title: 'Altro', createdAt: now, updatedAt: now });
    upsertMessage(db, 'chat-2', { id: 'm2', role: 'user', content: 'mappa', createdAt: now + 20, attachments: [{ path: 'image-1.png', name: 'image-1.png', kind: 'image' }] });
    upsertMessage(db, 'chat-1', { id: 'm1', role: 'user', content: 'foto', createdAt: now + 10, attachments: [{ path: 'images.jpg', name: 'images.jpg', kind: 'image' }] });
    upsertMessage(db, 'chat-1', { id: 'a1', role: 'assistant', content: 'fatto', createdAt: now + 15, attachments: [{ path: 'render.png', name: 'render.png', kind: 'image' }] });
    upsertMessage(db, 'chat-3', { id: 'm3', role: 'user', content: 'altro', createdAt: now + 5, attachments: [{ path: 'estranea.png', name: 'estranea.png', kind: 'image' }] });
    expect(listProjectUserAttachments(db, 'pompei').map((attachment) => attachment.path)).toEqual(['images.jpg', 'image-1.png']);
  });
});

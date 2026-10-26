import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getMessage, insertConversation, insertProject, listMessages, openDatabase, upsertMessage } from '../src/db.js';

describe('failed user send persistence', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(path.join(os.tmpdir(), 'od-message-send-')); });
  afterEach(() => { closeDatabase(); rmSync(directory, { recursive: true, force: true }); });
  function seed() {
    const db = openDatabase(directory, { dataDir: directory });
    insertProject(db, { id: 'project', name: 'Project', createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'chat', projectId: 'project', title: 'Report', createdAt: 1, updatedAt: 1 });
    return db;
  }
  it('retains the retry identity and concrete pre-run error through INSERT, UPDATE and database reopen', () => {
    let db = seed();
    const original = { id: 'user', role: 'user', content: 'Prepare the report', clientRequestId: 'same-request', sendFailed: true,
      sendFailure: { message: 'Reconnect the document folder.', code: 'DOCUMENT_UNAVAILABLE', status: 409, retryable: false } };
    upsertMessage(db, 'chat', original);
    expect(getMessage(db, 'user')).toMatchObject(original);
    upsertMessage(db, 'chat', { ...original, sendFailure: { ...original.sendFailure, message: 'The folder is still disconnected.' } });
    closeDatabase(); db = openDatabase(directory, { dataDir: directory });
    expect(listMessages(db, 'chat')).toHaveLength(1);
    expect(listMessages(db, 'chat')[0]).toMatchObject({ clientRequestId: 'same-request', sendFailed: true, sendFailure: { message: 'The folder is still disconnected.' } });
    expect(getMessage(db, 'user')?.runId).toBeUndefined();
  });
  it('clears the obsolete refusal when the same user turn is accepted while keeping its request identity', () => {
    const db = seed();
    const message = { id: 'user', role: 'user', content: 'Prepare the report', clientRequestId: 'same-request' };
    upsertMessage(db, 'chat', { ...message, sendFailed: true, sendFailure: { message: 'Brief unfinished.' } });
    upsertMessage(db, 'chat', message);
    expect(getMessage(db, 'user')?.clientRequestId).toBe('same-request');
    expect(getMessage(db, 'user')?.sendFailed).toBeUndefined(); expect(getMessage(db, 'user')?.sendFailure).toBeUndefined();
  });
  it('does not apply a failed user-send badge to assistant messages and bounds malformed incoming detail', () => {
    const db = seed();
    upsertMessage(db, 'chat', { id: 'assistant', role: 'assistant', content: '', sendFailed: true, sendFailure: { message: 'Wrong side' } });
    expect(getMessage(db, 'assistant')?.sendFailed).toBeUndefined();
    upsertMessage(db, 'chat', { id: 'user', role: 'user', content: '', sendFailed: true, sendFailure: { message: 'x'.repeat(4000), code: 'y'.repeat(400), status: 'bad' } });
    const restored = getMessage(db, 'user'); expect(restored?.sendFailure?.message).toHaveLength(1200); expect(restored?.sendFailure?.code).toHaveLength(200); expect(restored?.sendFailure?.status).toBeUndefined();
  });
  it('adds the send-state column to an existing database without changing its stored messages', () => {
    let db = seed();
    upsertMessage(db, 'chat', { id: 'earlier-user', role: 'user', content: 'Original content' });
    db.exec('ALTER TABLE messages DROP COLUMN send_state_json'); closeDatabase();
    db = openDatabase(directory, { dataDir: directory });
    expect(getMessage(db, 'earlier-user')?.content).toBe('Original content');
    upsertMessage(db, 'chat', { id: 'earlier-user', role: 'user', content: 'Original content', sendFailed: true, sendFailure: { message: 'Retry safely.' } });
    expect(getMessage(db, 'earlier-user')?.sendFailure?.message).toBe('Retry safely.');
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const capabilities = read('contracts/app-capabilities.md');
const store = read('app/src/main/java/cn/edu/njupt/studycheckin/SyncStore.java');
const downlink = read('app/src/main/java/cn/edu/njupt/studycheckin/HostedDownlink.java');
const scheduler = read('app/src/main/java/cn/edu/njupt/studycheckin/ShiyiReminderScheduler.java');
const manifest = read('app/src/main/AndroidManifest.xml');

test('Android capability dictionary covers the hosted entities and local-first boundary', () => {
  for (const entity of ['plan', 'record', 'task', 'review', 'evaluation', 'reminder']) assert.match(capabilities, new RegExp('`' + entity + '`'));
  assert.match(capabilities, /draft-pending-backend-freeze/);
  assert.match(capabilities, /GitHub 只保存代码、契约、fixtures/);
});

test('reminder storage has versioned receipt fields and backward-compatible defaults', () => {
  assert.match(store, /normalizeReminder\(reminder\)/);
  for (const field of ['reminderVersion', 'receiptState', 'receivedAtUtc', 'scheduledAtUtc', 'deliveredAtUtc', 'cancelledAtUtc']) assert.match(store, new RegExp(field));
  for (const method of ['markReminderReceived', 'markReminderScheduled', 'markReminderDelivered', 'cancelReminder']) assert.match(store, new RegExp(method));
});

test('downlink processing keeps unknown business commands explicit', () => {
  assert.match(downlink, /UNSUPPORTED_DOWNLINK/);
  assert.match(downlink, /recordInbox\(context/);
  assert.match(downlink, /validateHostedOperation/);
});

test('reminder scheduling carries the version into the local receipt path', () => {
  assert.match(scheduler, /putExtra\("reminderVersion"/);
  assert.match(scheduler, /markReminderScheduled/);
  assert.match(scheduler, /public static void cancel/);
});

test('periodic sync is a system job with no push claim or client secret', () => {
  assert.match(manifest, /HostedSyncJobService/);
  const job = read('app/src/main/java/cn/edu/njupt/studycheckin/HostedSyncJobService.java');
  assert.match(job, /HostedSyncEndpoint\.transport/);
  assert.match(job, /jobFinished/);
  assert.match(read('app/src/main/java/cn/edu/njupt/studycheckin/HostedSyncEndpoint.java'), /HOSTED_SYNC_ENDPOINT/);
  assert.doesNotMatch(job, /service_role|SUPABASE_SERVICE_KEY|Bearer\s+[^s]/i);
});

test('sync settings expose confirmed and attempted timestamps separately', () => {
  const app = read('app/src/main/assets/app.js');
  assert.match(app, /lastAttemptAt/);
  assert.match(app, /lastSuccessAt/);
  assert.match(app, /上次云端确认/);
});

test('the reminder downlink fixture keeps revision and cursor outside the operation payload', () => {
  const fixture = JSON.parse(read('contracts/fixtures/hosted-reminder-downlink.json'));
  assert.equal(fixture.serverRevision, 12);
  assert.equal(fixture.journalCursor, 31);
  assert.equal(fixture.operation.command, 'upsert_reminder');
  assert.equal(fixture.operation.payload.reminderVersion, 3);
  assert.match(read('docs/integration/mac-backend-handoff.md'), /snapshot/);
});

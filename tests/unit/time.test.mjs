// Unit tests for js/utils/time.js. Run: node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineInfo, offsetMinutes, utcToZonedInput, zonedToUtc, zoneLabel } from '../../js/utils/time.js';

test('a Cairo deadline near midnight stores as the right UTC instant', () => {
  assert.equal(zonedToUtc('2026-11-20T23:30', 'Africa/Cairo').toISOString(), '2026-11-20T21:30:00.000Z');
});

test('the stored instant shows back as the same local time', () => {
  assert.equal(utcToZonedInput('2026-11-20T21:30:00Z', 'Africa/Cairo'), '2026-11-20T23:30');
});

test('UTC passes straight through', () => {
  assert.equal(zonedToUtc('2026-03-01T09:00', 'UTC').toISOString(), '2026-03-01T09:00:00.000Z');
});

test('zones with summer time use the offset of that date', () => {
  assert.equal(zonedToUtc('2026-07-01T12:00', 'America/New_York').toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(zonedToUtc('2026-01-15T12:00', 'America/New_York').toISOString(), '2026-01-15T17:00:00.000Z');
  assert.equal(offsetMinutes(new Date('2026-07-01T12:00:00Z'), 'Europe/London'), 60);
});

test('a time that does not exist on the day clocks go forward still lands on a real instant', () => {
  const instant = zonedToUtc('2026-03-08T02:30', 'America/New_York');
  assert.ok(instant instanceof Date && !Number.isNaN(instant.getTime()));
});

test('bad input gives null instead of a wrong date', () => {
  assert.equal(zonedToUtc('', 'UTC'), null);
  assert.equal(zonedToUtc('tomorrow', 'UTC'), null);
});

test('deadline wording: overdue, due soon, fine, done, none', () => {
  const now = Date.parse('2026-11-18T10:00:00Z');
  assert.equal(deadlineInfo('2026-11-17T10:00:00Z', 'in_progress', 'UTC', now).tone, 'late');
  assert.match(deadlineInfo('2026-11-17T10:00:00Z', 'in_progress', 'UTC', now).remaining, /Overdue by 24 hours/);
  assert.equal(deadlineInfo('2026-11-19T10:00:00Z', 'todo', 'UTC', now).tone, 'soon');
  assert.equal(deadlineInfo('2026-11-25T10:00:00Z', 'todo', 'UTC', now).tone, '');
  assert.match(deadlineInfo('2026-11-25T10:00:00Z', 'todo', 'UTC', now).remaining, /7 days left/);
  assert.equal(deadlineInfo('2026-11-17T10:00:00Z', 'completed', 'UTC', now).tone, '', 'completed work is never overdue');
  assert.equal(deadlineInfo(null, 'todo', 'UTC', now).label, 'No deadline');
});

test('zone labels read like places', () => {
  assert.equal(zoneLabel('America/New_York'), 'New York');
  assert.equal(zoneLabel('Etc/UTC'), 'UTC');
});

import { describe, expect, it } from 'vitest';
import { login, logout } from './auth';

it('logs in', () => {
  expect(login('ada', 'pw').ok).toBe(true);
});

it('rejects a bad password', () => {
  expect(login('ada', 'nope').ok).toBe(false);
});

describe('logout', () => {
  it('clears the session', () => {
    expect(logout().session).toBeNull();
  });
});

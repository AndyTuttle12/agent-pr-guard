import { describe, expect, it } from 'vitest';
import { login, logout } from './auth';

it.only('logs in', () => {
  expect(login('ada', 'pw').ok).toBe(true);
});

it('rejects a bad password', () => {
  expect(login('ada', 'nope').ok).toBe(false);
});

fdescribe('logout', () => {
  it('clears the session', () => {
    expect(logout().session).toBeNull();
  });
});

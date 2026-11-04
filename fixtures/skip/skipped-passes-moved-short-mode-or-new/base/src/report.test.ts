import { expect, it } from 'vitest';
import { report } from './report';

it.skip('renders the legacy layout', () => {
  expect(report('legacy')).toMatchSnapshot();
});

it('renders', () => {
  expect(report('new')).toMatchSnapshot();
});

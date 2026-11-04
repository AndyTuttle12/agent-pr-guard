import { expect, it } from 'vitest';
import { report } from './report';

it('renders', () => {
  // it.skip('was here') used to wrap this, see the changelog
  expect(report('new', { skip: 10, take: 5 })).toMatchSnapshot();
});

it.skip('renders the legacy layout', () => {
  expect(report('legacy')).toMatchSnapshot();
});

import { runFixture } from './fixture';

export default function globalTeardown(): void {
  runFixture('teardown');
}

import { defineProject } from 'vitest/config';

export default defineProject({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
});

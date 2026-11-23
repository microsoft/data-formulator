import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// The full suite runs test files in parallel on every core, which can make a render several times slower than
// it is alone. Waits (findBy…, waitFor) get room to finish rather than failing at the 1 s default.
configure({ asyncUtilTimeout: 5000 });

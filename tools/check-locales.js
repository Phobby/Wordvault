#!/usr/bin/env node

// npm run i18n:check: checks src/locales against the English source (tools/i18n/check.js).

import path from 'node:path';
import { checkRepository, report } from './i18n/check.js';

process.exitCode = report(checkRepository(path.join(import.meta.dirname, '..'))) ? 0 : 1;

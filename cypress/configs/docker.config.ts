import { defineConfig } from 'cypress'

import base from './base.config'
import { setupCommonNodeEvents } from './_shared'
export default defineConfig({
  chromeWebSecurity: false,
  video: false,
  videosFolder: 'cypress/videos',
  screenshotOnRunFailure: true,
  screenshotsFolder: 'cypress/screenshots',
  pageLoadTimeout: 30000,
  defaultCommandTimeout: 5000,
  requestTimeout: 15000,
  viewportHeight: 1080,
  viewportWidth: 1920,
  projectId: 'n4qnyb',
  env: {
    'admin.api.key': 'ajGwpy8Pdai22XDUpqjC5Ob04v0eG7EGgb4vz2bD2juT8YDmfM',
    'user.api.key': 'JZJApQ9XOnF7nvupWZlTWBRrqMtHE9eNcWBTUzEWGqL4Sdqp6C',
    'nofinance.api.key': 'M_5K4ZWTdBTmMOTGTfLWCmXFbETgHNG6_6FNZXJJulicn_WweBjm',
    'nofundraiser.api.key': 'financeNoFundraiserApiKeyForTesting12345',
    'nofundraiser.username': 'finance.nofundraiser',
    'nofundraiser.password': 'changeme',
    'selfedit.api.key': 'amandaBlackEditSelfOnlyApiKey12345678901',
    'selfedit.plus.notes.api.key': 'editSelfPlusNotesApiKeyForTesting12345678901',
    'plainauth.api.key': 'plainAuthReadOnlyApiKeyForTesting12345678901',
    'limited.api.key': 'limitedUserApiKeyForTesting123456789012345678',
    'editrecords.api.key': 'judithMatthewsEditRecordsNoNotesApiKey1234',
    'admin.username': 'admin',
    'admin.password': 'changeme',
    'admin.2fa.secret': 'JBSWY3DPEBLW64TMMQ======',
    taskDbHost: process.env.CYPRESS_TASK_DB_HOST || '127.0.0.1',
    taskDbPort: process.env.CYPRESS_TASK_DB_PORT || '',
    'standard.username': 'tony.wade@example.com',
    'standard.password': 'basicjoe',
    'nofinance.username': 'judith.matthews@example.com',
    'nofinance.password': 'noMoney$',
  },
  retries: 0,
  numTestsKeptInMemory: 0,
  e2e: {
    ...base.e2e,
    setupNodeEvents(on, config) {
      return setupCommonNodeEvents(on, config);
    },
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost/',
  },
})

/**
 * Integration test config. Runs against real VS Code workspaceStorage data on
 * the developer's machine. NOT run in CI (CI uses jest.config.js / unit tests
 * only).
 *
 * Run locally with: npm run test:integration
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test-integration'],
  testMatch: ['**/*.integration.test.ts'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json'
    }
  },
  moduleNameMapper: {
    '^vscode$': '<rootDir>/test/__mocks__/vscode.ts'
  },
  testTimeout: 60000
};

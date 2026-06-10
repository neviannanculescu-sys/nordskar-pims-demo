module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.integration.spec.ts'],
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { types: ['jest', 'node'] } }] },
  testEnvironment: 'node',
  forceExit: true,
  // Integration tests are slow — allow up to 60s per test
  testTimeout: 60000,
};

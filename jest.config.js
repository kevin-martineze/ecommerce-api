/**
 * Configuración de tests unitarios.
 *
 * Vive en su propio archivo y no dentro de package.json porque los patrones de
 * `testRegex` y `transform` son expresiones regulares: en JSON hay que escapar
 * cada barra invertida dos veces y el resultado es ilegible y fácil de romper.
 *
 * Los alias de módulo se repiten aquí porque Jest no lee `paths` de tsconfig.
 * Si se agrega uno en tsconfig.json, hay que agregarlo también acá o los tests
 * fallarán con "cannot find module" mientras el build pasa sin quejarse.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@db/(.*)$': '<rootDir>/prisma/$1',
  },
};

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import * as ts from 'typescript';

/**
 * Test de arquitectura: toda consulta a un modelo de tienda nombra `storeId`.
 *
 * RLS es la red; esto es la regla (ARCHITECTURE.md § 4). Con RLS, una consulta
 * a la que se le olvidó el filtro devuelve cero filas en vez de las de otra
 * tienda, que es un bug y no una fuga. Este test hace que ese bug no llegue ni
 * a escribirse: rompe el build.
 *
 * Cómo decide:
 *
 * - **Modelos de tienda**: los que declaran un campo `storeId` en
 *   schema.prisma. Se leen del schema y no de una lista escrita acá, para que
 *   un modelo nuevo quede cubierto sin que nadie se acuerde de este archivo.
 * - **Consultas**: toda llamada `<algo>.<modelo>.<operación>(...)` en `src/`.
 * - **Regla**: el primer argumento tiene que mencionar `storeId`.
 *
 * Es textual a propósito, y tiene una consecuencia que conviene conocer: el
 * filtro se escribe EN la llamada. `findMany({ where })` falla aunque `where`
 * tenga el storeId adentro. Es una restricción deseable: quien revisa el
 * código ve el filtro en la misma línea que la consulta.
 */

const SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
const SOURCE_ROOT = join(__dirname, '..');

/**
 * Modelos con `storeId` que NO son datos de una tienda.
 *
 * - `RefreshToken`: su `storeId` es la tienda activa de la sesión, no su
 *   dueña. La sesión es de la cuenta y se busca por el hash del token, antes
 *   de saber nada de tiendas.
 */
const EXEMPT_MODELS = new Set(['RefreshToken']);

const QUERY_METHODS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

interface Violation {
  file: string;
  line: number;
  call: string;
}

/** Nombres de delegado de Prisma (`product`, `storeSettings`…) de los modelos de tienda. */
function tenantDelegates(schema: string): Set<string> {
  const delegates = new Set<string>();

  for (const [, name, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    if (!name || body === undefined || EXEMPT_MODELS.has(name)) {
      continue;
    }

    if (/^\s*storeId\s/m.test(body)) {
      delegates.add(name.charAt(0).toLowerCase() + name.slice(1));
    }
  }

  return delegates;
}

function findUnscopedQueries(
  fileName: string,
  source: string,
  delegates: ReadonlySet<string>,
): Violation[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const target = node.expression.expression;

      if (
        QUERY_METHODS.has(method) &&
        ts.isPropertyAccessExpression(target) &&
        delegates.has(target.name.text)
      ) {
        const firstArgument = node.arguments[0];

        if (!firstArgument || !/\bstoreId\b/.test(firstArgument.getText(sourceFile))) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

          violations.push({
            file: fileName,
            line: line + 1,
            call: `${target.name.text}.${method}`,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return violations;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(path);
    }

    return entry.name.endsWith('.ts') && !/\.(spec|arch-spec|e2e-spec)\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe('Aislamiento por tienda: toda consulta a Prisma nombra storeId', () => {
  const delegates = tenantDelegates(readFileSync(SCHEMA_PATH, 'utf8'));

  it('reconoce los modelos de tienda en el schema', () => {
    // Si el parseo del schema se rompiera, el conjunto quedaría vacío y el test
    // de más abajo pasaría sin revisar nada. Esto lo impide.
    expect([...delegates]).toEqual(
      expect.arrayContaining(['product', 'variant', 'color', 'order', 'storeSettings']),
    );
    expect(delegates.has('refreshToken')).toBe(false);
    expect(delegates.has('user')).toBe(false);
  });

  it('detecta una consulta sin storeId', () => {
    const source = `
      async function ejemplo(tx, id, storeId, tokenHash, where) {
        await tx.product.findMany({ where: { status: 'ACTIVE' } });
        await tx.product.count();
        await tx.product.findMany({ where });
        await tx.product.findFirst({ where: { id, storeId } });
        await tx.refreshToken.findUnique({ where: { tokenHash } });
      }
    `;

    expect(findUnscopedQueries('ejemplo.ts', source, delegates).map((v) => v.call)).toEqual([
      'product.findMany',
      'product.count',
      'product.findMany',
    ]);
  });

  it('ningún archivo de src/ consulta un modelo de tienda sin storeId', () => {
    const violations = sourceFiles(SOURCE_ROOT).flatMap((file) =>
      findUnscopedQueries(relative(SOURCE_ROOT, file), readFileSync(file, 'utf8'), delegates),
    );

    expect(violations.map((v) => `${v.file}:${v.line} ${v.call}`)).toEqual([]);
  });
});

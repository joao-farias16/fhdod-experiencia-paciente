/**
 * Montagem de SQL parametrizado (RNF11). Todo comando enviado ao MySQL é um `SqlStatement`
 * criado pelo template `sql`: os valores interpolados viram parâmetros `?` (nunca texto
 * concatenado) e são escapados pelo driver mysql2. Fragmentos podem ser aninhados, o que permite
 * montar filtros dinâmicos (WHERE opcionais) sem perder a parametrização.
 *
 * Exemplo:
 *   const where = sql`s.hospital_id = ${hospitalId}`;
 *   await db.query(sql`SELECT id FROM sectors s WHERE ${where} AND s.id IN (${sql.list(ids)})`);
 */

/** Valores aceitos como parâmetro. Objetos JSON devem ser convertidos com `sql.json`. */
export type SqlValue = string | number | boolean | Date | Buffer | null;

const STATEMENT = Symbol('SqlStatement');

/** Comando SQL com marcadores `?` e os valores na mesma ordem. */
export interface SqlStatement {
  readonly [STATEMENT]: true;
  readonly text: string;
  readonly values: readonly SqlValue[];
}

function statement(text: string, values: readonly SqlValue[]): SqlStatement {
  return { [STATEMENT]: true, text, values };
}

export function isSqlStatement(value: unknown): value is SqlStatement {
  return typeof value === 'object' && value !== null && STATEMENT in value;
}

function assertSqlValue(value: unknown): asserts value is SqlValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Parâmetro SQL numérico inválido (NaN ou infinito).');
    }
    return;
  }
  if (value === undefined) {
    throw new TypeError('Parâmetro SQL indefinido: use null explicitamente.');
  }
  throw new TypeError(
    'Parâmetro SQL de tipo não suportado: use sql.list para listas e sql.json para JSON.',
  );
}

/** Template de SQL parametrizado. Interpolações de `SqlStatement` são incorporadas como SQL. */
export function sql(strings: TemplateStringsArray, ...params: unknown[]): SqlStatement {
  let text = strings[0] ?? '';
  const values: SqlValue[] = [];
  params.forEach((param, index) => {
    if (isSqlStatement(param)) {
      text += param.text;
      values.push(...param.values);
    } else {
      assertSqlValue(param);
      text += '?';
      values.push(param);
    }
    text += strings[index + 1] ?? '';
  });
  return statement(text, values);
}

/** Fragmento vazio (condição opcional ausente). */
sql.empty = statement('', []);

/** Junta fragmentos com um separador literal (por exemplo, ' AND ' ou ', '). */
sql.join = (parts: readonly SqlStatement[], separator: string): SqlStatement =>
  statement(
    parts.map((part) => part.text).join(separator),
    parts.flatMap((part) => part.values),
  );

/**
 * Lista de valores para `IN (...)`: um marcador por item. Lista vazia é recusada, pois `IN ()` é
 * inválido no MySQL — trate o caso vazio antes (normalmente devolvendo nenhum resultado).
 */
sql.list = (items: readonly SqlValue[]): SqlStatement => {
  if (items.length === 0) throw new RangeError('sql.list exige ao menos um item.');
  items.forEach((item) => {
    assertSqlValue(item);
  });
  return statement(items.map(() => '?').join(', '), items);
};

/** Valor JSON serializado (colunas JSON: details, errors, staged_rows). */
sql.json = (value: unknown): SqlStatement => {
  const serialized = JSON.stringify(value) as string | undefined;
  if (serialized === undefined) throw new TypeError('Valor não serializável em JSON.');
  return statement('CAST(? AS JSON)', [serialized]);
};

/**
 * Identificador (nome de banco ou tabela) validado — somente para scripts administrativos que
 * criam o banco; nunca use com entrada do usuário.
 */
sql.identifier = (name: string): SqlStatement => {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) {
    throw new RangeError(`Identificador SQL inválido: ${name}`);
  }
  return statement(`\`${name}\``, []);
};

/**
 * Padrão `%texto%` para LIKE com os curingas do próprio texto (%, _ e \) escapados, como o
 * `contains` usado antes: a busca encontra o texto literal digitado pelo usuário.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

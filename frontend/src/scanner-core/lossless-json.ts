export type JsonValue = null | boolean | string | number | bigint | JsonValue[] | JsonObject;
export interface JsonObject {[key: string]: JsonValue;}

/** Strict JSON with duplicate-key rejection and exact large integer preservation. */
export function parseLosslessJson(source: string, allIntegers = false): JsonValue {
  let position = 0;
  const whitespace = (): void => {while (/[\t\n\r ]/.test(source[position] ?? 'x')) position++;};
  const fail = (): never => {throw new SyntaxError('Invalid JSON');};
  const string = (): string => {
    const start = position++;
    while (position < source.length) {
      const character = source[position++];
      if (character === '\\') position++;
      else if (character === '"') return JSON.parse(source.slice(start, position)) as string;
    }
    return fail();
  };
  const value = (depth: number): JsonValue => {
    if (depth > 256) return fail();
    whitespace();
    const character = source[position];
    if (character === '"') return string();
    if (character === '{') {
      position++; whitespace();
      const result: JsonObject = Object.create(null) as JsonObject;
      if (source[position] === '}') {position++; return result;}
      while (true) {
        whitespace(); if (source[position] !== '"') return fail();
        const key = string();
        if (Object.hasOwn(result, key)) return fail();
        whitespace(); if (source[position++] !== ':') return fail();
        result[key] = value(depth + 1); whitespace();
        const end = source[position++];
        if (end === '}') return result;
        if (end !== ',') return fail();
      }
    }
    if (character === '[') {
      position++; whitespace();
      const result: JsonValue[] = [];
      if (source[position] === ']') {position++; return result;}
      while (true) {
        result.push(value(depth + 1)); whitespace();
        const end = source[position++];
        if (end === ']') return result;
        if (end !== ',') return fail();
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(literal, position)) {position += literal.length; return result;}
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(position));
    if (!match) return fail();
    position += match[0].length;
    if (!/[.eE]/.test(match[0])) {
      const integer = BigInt(match[0]);
      if (allIntegers || integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) return integer;
    }
    const number = Number(match[0]);
    return Number.isFinite(number) ? number : fail();
  };
  const result = value(0); whitespace();
  if (position !== source.length) return fail();
  return result;
}

export function jsonText(value: JsonValue, canonical = false): string {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return `[${value.map(item => jsonText(item, canonical)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (canonical) keys.sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${jsonText(value[key], canonical)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function jsonObject(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Expected object');
  return value;
}

/** Keeps integer and floating-point JSON node kinds distinct, matching the Java importer. */
export function jsonEqual(a: JsonValue,b: JsonValue): boolean {
  if (typeof a!==typeof b) return false;
  if (a===b) return true;
  if (a===null || b===null || typeof a!=='object' || typeof b!=='object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((item,index)=>jsonEqual(item,b[index]));
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(key=>Object.hasOwn(b,key) && jsonEqual(a[key],b[key]));
}

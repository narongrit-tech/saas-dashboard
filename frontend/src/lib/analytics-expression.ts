/**
 * Safe math expression evaluator for Analytics Builder.
 *
 * Supports: + - * / and parentheses ()
 * Identifiers are looked up in a context map (metric keys → numbers).
 *
 * NO eval() is used. Implemented as a hand-rolled recursive-descent parser.
 *
 * Division by zero: returns null (caller decides how to display).
 * Unknown identifier: throws ExpressionError with a descriptive message.
 */

// ─── Token types ──────────────────────────────────────────────────────────────

type TokenType =
  | 'NUMBER'
  | 'IDENT'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'LPAREN'
  | 'RPAREN'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
}

// ─── Lexer ────────────────────────────────────────────────────────────────────

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    // Skip whitespace
    if (/\s/.test(ch)) { i++; continue }

    // Number (integer or decimal)
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(input[i + 1] ?? ''))) {
      let num = ''
      while (i < input.length && /[\d.]/.test(input[i])) num += input[i++]
      tokens.push({ type: 'NUMBER', value: num })
      continue
    }

    // Identifier (metric key)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = ''
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) ident += input[i++]
      tokens.push({ type: 'IDENT', value: ident })
      continue
    }

    if (ch === '+') { tokens.push({ type: 'PLUS',   value: '+' }); i++; continue }
    if (ch === '-') { tokens.push({ type: 'MINUS',  value: '-' }); i++; continue }
    if (ch === '*') { tokens.push({ type: 'STAR',   value: '*' }); i++; continue }
    if (ch === '/') { tokens.push({ type: 'SLASH',  value: '/' }); i++; continue }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue }

    throw new ExpressionError(`Unexpected character: '${ch}'`)
  }

  tokens.push({ type: 'EOF', value: '' })
  return tokens
}

// ─── Signals ──────────────────────────────────────────────────────────────────

class DivisionByZeroSignal {
  readonly type = 'DIV_BY_ZERO' as const
}

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExpressionError'
  }
}

type ParseResult = number | DivisionByZeroSignal

// ─── Parser ───────────────────────────────────────────────────────────────────

class Parser {
  private pos = 0

  constructor(
    private tokens: Token[],
    private context: Record<string, number>
  ) {}

  private peek(): Token { return this.tokens[this.pos] }
  private consume(): Token { return this.tokens[this.pos++] }
  isAtEnd(): boolean { return this.tokens[this.pos]?.type === 'EOF' }

  private expect(type: TokenType): Token {
    const t = this.consume()
    if (t.type !== type) throw new ExpressionError(`Expected ${type}, got ${t.type}`)
    return t
  }

  /** expr → term (('+' | '-') term)* */
  parseExpr(): ParseResult {
    let left = this.parseTerm()

    while (this.peek().type === 'PLUS' || this.peek().type === 'MINUS') {
      const op = this.consume().type
      const right = this.parseTerm()
      if (left instanceof DivisionByZeroSignal || right instanceof DivisionByZeroSignal) {
        left = new DivisionByZeroSignal()
        continue
      }
      left = op === 'PLUS' ? left + right : left - right
    }
    return left
  }

  /** term → factor (('*' | '/') factor)* */
  private parseTerm(): ParseResult {
    let left = this.parseFactor()

    while (this.peek().type === 'STAR' || this.peek().type === 'SLASH') {
      const op = this.consume().type
      const right = this.parseFactor()
      if (left instanceof DivisionByZeroSignal || right instanceof DivisionByZeroSignal) {
        left = new DivisionByZeroSignal()
        continue
      }
      if (op === 'SLASH') {
        if (right === 0) return new DivisionByZeroSignal()
        left = left / right
      } else {
        left = left * right
      }
    }
    return left
  }

  /** factor → '(' expr ')' | NUMBER | IDENT | '-' factor */
  private parseFactor(): ParseResult {
    const t = this.peek()

    if (t.type === 'MINUS') {
      this.consume()
      const val = this.parseFactor()
      if (val instanceof DivisionByZeroSignal) return val
      return -val
    }

    if (t.type === 'LPAREN') {
      this.consume()
      const val = this.parseExpr()
      this.expect('RPAREN')
      return val
    }

    if (t.type === 'NUMBER') {
      this.consume()
      return parseFloat(t.value)
    }

    if (t.type === 'IDENT') {
      this.consume()
      if (!(t.value in this.context)) {
        throw new ExpressionError(`Unknown metric: '${t.value}'`)
      }
      return this.context[t.value]
    }

    throw new ExpressionError(`Unexpected token: '${t.value}' (${t.type})`)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a math expression with a given context.
 *
 * @param expression - e.g. "(revenue - cogs - advertising) / orders"
 * @param context    - metric key → numeric value map
 * @returns number if successful, null if division-by-zero
 * @throws ExpressionError if syntactically invalid or references an unknown metric
 */
export function evaluateExpression(
  expression: string,
  context: Record<string, number>
): number | null {
  if (!expression.trim()) return null

  const tokens = tokenize(expression)
  const parser = new Parser(tokens, context)
  const result = parser.parseExpr()

  // Ensure entire expression was consumed
  if (!parser.isAtEnd()) {
    throw new ExpressionError('Unexpected tokens after expression end')
  }

  if (result instanceof DivisionByZeroSignal) return null

  // Round to 2 decimal places for currency precision
  return Math.round(result * 100) / 100
}

/**
 * Validate expression syntax (uses 1.0 for all known metrics).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateExpression(expression: string, knownMetrics: string[]): string | null {
  try {
    const context: Record<string, number> = {}
    knownMetrics.forEach((k) => { context[k] = 1.0 })
    evaluateExpression(expression, context)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Expression error'
  }
}

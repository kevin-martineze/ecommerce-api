/**
 * El asistente de una tienda, visto desde el dominio.
 *
 * La implementación habla con un modelo; esta clase existe para que el módulo
 * que la usa no sepa con cuál. Por eso el contrato no menciona ningún proveedor
 * y las herramientas se declaran acá: quien las ejecuta es el módulo —que es
 * quien tiene la base y el contexto de la tienda—, no el driver.
 *
 * Esa frontera es lo que hace que el asistente no pueda inventar: no recibe el
 * catálogo en el instructivo, sino la posibilidad de consultarlo. Lo que
 * responde sale de lo que devuelven las herramientas.
 */

/** Una herramienta que el modelo puede pedir que se ejecute. */
export interface AssistantTool {
  name: string;
  description: string;
  /** JSON Schema de los argumentos. */
  input: Record<string, unknown>;
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantRequest {
  /** Quién es, de qué tienda habla y qué NO puede hacer. */
  system: string;
  messages: AssistantMessage[];
  tools: AssistantTool[];
  /** Ejecuta una herramienta y devuelve lo que se le pasa al modelo. */
  run(name: string, input: unknown): Promise<unknown>;
}

export interface AssistantAnswer {
  text: string;
  /** Para el tope del plan y para saber cuánto cuesta de verdad una conversación. */
  usage: { inputTokens: number; outputTokens: number };
}

export abstract class Assistant {
  /** Si hay un modelo detrás. Con `false` el chat ni se ofrece. */
  abstract readonly available: boolean;

  abstract answer(request: AssistantRequest): Promise<AssistantAnswer>;
}

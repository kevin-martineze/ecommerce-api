import { Assistant, AssistantAnswer } from './assistant';

/**
 * El asistente apagado, que es como sale de fábrica.
 *
 * No responde nada y lo dice: el módulo comprueba `available` antes de llamar,
 * así que llegar acá es un error de programación, no un caso de uso. Lanzar es
 * lo correcto —una respuesta vacía se colaría hasta la clienta.
 */
export class NullAssistant extends Assistant {
  readonly available = false;

  answer(): Promise<AssistantAnswer> {
    throw new Error('El asistente está apagado (AI_DRIVER=none).');
  }
}

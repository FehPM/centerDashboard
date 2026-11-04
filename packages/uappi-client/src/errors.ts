/**
 * Resposta HTTP de erro da Uappi, com o status. Separado em arquivo próprio
 * porque tanto o cliente quanto o provedor de token lançam este erro: quem
 * chama distingue credencial recusada (401/403) de indisponibilidade pelo
 * `status`, sem interpretar texto.
 */
export class UappiApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'UappiApiError';
  }
}

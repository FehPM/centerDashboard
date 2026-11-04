import { useQuery } from '@tanstack/react-query';
import { ApiError, backofficeApi, getOperatorToken, type OperatorView } from '../lib/api-client.js';

export function useOperator() {
  return useQuery<OperatorView, ApiError>({
    queryKey: ['operator', 'me'],
    queryFn: backofficeApi.me,
    retry: false,
    // Sem token o guard redireciona; não adianta chamar a API.
    enabled: getOperatorToken() !== null,
  });
}

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiClient, getAuthToken, type ApiError, type MeView } from '../lib/api-client.js';

/** Sessão atual: usuário, módulos em vigor e fontes liberadas. Vem sempre do servidor. */
export function useMe(): UseQueryResult<MeView, ApiError> {
  return useQuery<MeView, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiClient.getMe(),
    enabled: getAuthToken() !== null,
    staleTime: 30_000,
  });
}

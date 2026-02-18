import { apiRequest } from '@/lib/queryClient';

export async function fetchWithTimeout(
  method: string,
  url: string,
  body?: any,
  timeoutMs = 30000
): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await apiRequest(method, url, body, { signal: controller.signal });
    try {
      return await res.json();
    } catch {
      throw new Error('Invalid response from server');
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getErrorMessage(err: any): string {
  if (err?.name === 'AbortError') return "The request took too long. Please try again.";
  if (err?.message === 'Invalid response from server') return "Received an unexpected response. Please try again.";
  if (err instanceof TypeError) return "Network error. Please check your connection and try again.";
  return "Sorry, I'm having trouble right now. Please try again in a moment.";
}

import type {
  ActionResponse,
  ApplicationPrefillResponse,
  AiSummaryResponse,
  CaseDetail,
  CasesResponse,
  CorePayloadResponse,
  CreateCaseInput,
  DashboardData,
  DocumentAiInsights,
  HealthData,
  PolicyCatalog,
  ValidationResponse,
} from './types';

const API_ROOT = '/api';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers });
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'La solicitud no es válida. Revisa los datos e intenta nuevamente.',
      401: 'La sesión no está autorizada para realizar esta operación.',
      403: 'Tu rol no tiene permiso para realizar esta acción.',
      404: 'El recurso solicitado no está disponible.',
      409: 'El expediente cambió de estado. Actualiza la vista e intenta nuevamente.',
      413: 'El archivo supera el tamaño permitido.',
      415: 'El archivo no es un PDF válido o utiliza una protección no admitida.',
      422: 'Los datos enviados requieren corrección.',
      429: 'Hay demasiadas solicitudes. Espera un momento e intenta nuevamente.',
      500: 'El servicio local encontró un inconveniente.',
      502: 'El servicio local no pudo comunicarse con una dependencia.',
      503: 'El servicio local no está disponible temporalmente.',
    };
    const message = messages[response.status] || `No fue posible completar la operación (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthData>('/health'),
  dashboard: () => request<DashboardData>('/dashboard'),
  resetDemoData: () =>
    request<{ ok: boolean; message: string; dashboard: DashboardData }>('/demo/reset', { method: 'POST' }),
  policies: () => request<PolicyCatalog>('/policies'),
  cases: (filters?: { status?: string; search?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.search) params.set('search', filters.search);
    const query = params.size ? `?${params.toString()}` : '';
    return request<CasesResponse>(`/cases${query}`);
  },
  case: (id: string) => request<CaseDetail>(`/cases/${id}`),
  createCase: (input: CreateCaseInput) =>
    request<CaseDetail>('/cases', { method: 'POST', body: JSON.stringify(input) }),
  action: (id: string, action: string, note?: string) =>
    request<ActionResponse>(`/cases/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action, actor: 'Cinthia M. · Usuario B', role: 'AFILIACIONES', note }),
    }),
  revalidate: (id: string) =>
    request<ValidationResponse>(`/cases/${id}/revalidate`, { method: 'POST' }),
  demoCorrection: (id: string) =>
    request<ValidationResponse>(`/cases/${id}/demo-correction`, { method: 'POST' }),
  corePayload: (id: string) => request<CorePayloadResponse>(`/cases/${id}/core-payload`),
  aiSummary: (id: string) =>
    request<AiSummaryResponse>(`/cases/${id}/ai-summary`, { method: 'POST' }),
  aiInsights: (id: string) => request<DocumentAiInsights>(`/cases/${id}/ai-insights`),
  analyzeAiInsights: (id: string) =>
    request<DocumentAiInsights>(`/cases/${id}/ai-insights`, {
      method: 'POST',
      body: JSON.stringify({ actor: 'Cinthia M. · Usuario B', mode: 'demo-local' }),
    }),
  uploadDocument: (id: string, file: File, type: string) => {
    const body = new FormData();
    body.set('file', file);
    body.set('type', type);
    body.set('synthetic', 'true');
    return request<{ case: CaseDetail; document: unknown }>(`/cases/${id}/documents`, {
      method: 'POST',
      body,
    });
  },
  applicationPrefill: (file: File, allowAiProcessing: boolean) => {
    const body = new FormData();
    body.set('file', file);
    body.set('synthetic', 'true');
    body.set('allowAiProcessing', String(allowAiProcessing));
    return request<ApplicationPrefillResponse>('/application-prefill', {
      method: 'POST',
      body,
    });
  },
  async applicationPrefillSample() {
    const response = await fetch(`${API_ROOT}/demo/application-prefill-sample`);
    if (!response.ok) throw new ApiError('No fue posible cargar la solicitud de prueba.', response.status);
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const basicName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const name = encodedName ? decodeURIComponent(encodedName) : basicName || 'Solicitud-AFPC-sintetica.pdf';
    return new File([blob], name, { type: blob.type || 'application/pdf' });
  },
  async downloadContract(id: string, reference: string) {
    const response = await fetch(`${API_ROOT}/cases/${id}/contract`);
    if (!response.ok) throw new ApiError('No fue posible generar el contrato.', response.status);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Contrato-${reference}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

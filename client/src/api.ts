import type {
  ActionResponse,
  ApplicationPrefillResponse,
  AiSummaryResponse,
  AuthUser,
  CaseDetail,
  CasesResponse,
  CorePayloadResponse,
  CreateCaseInput,
  DashboardData,
  DocumentAiInsights,
  HealthData,
  GeneratedCaseDetail,
  GeneratedCaseSummary,
  IncomingRequest,
  MailSettings,
  ManagedUser,
  PolicyCatalog,
  UserInput,
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

  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers, credentials: 'same-origin' });
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
    let serverMessage = '';
    try {
      const body = await response.json() as { message?: unknown };
      serverMessage = typeof body.message === 'string' ? body.message : '';
    } catch {}
    const message = serverMessage || messages[response.status] || `No fue posible completar la operación (${response.status}).`;
    if (response.status === 401 && path !== '/auth/login') {
      window.dispatchEvent(new Event('occidente:unauthorized'));
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string, rememberDevice: boolean) =>
    request<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, rememberDevice }),
    }),
  me: () => request<{ user: AuthUser }>('/auth/me'),
  saveUserPreferences: (preferences: Pick<AuthUser, 'autoRefreshIncoming' | 'autoAnalyzeCompleteCases'>) =>
    request<{ user: AuthUser }>('/auth/preferences', { method: 'PUT', body: JSON.stringify(preferences) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  users: () => request<{ items: ManagedUser[] }>('/users'),
  createUser: (input: UserInput & { password: string }) =>
    request<{ user: ManagedUser }>('/users', { method: 'POST', body: JSON.stringify(input) }),
  updateUser: (id: string, input: UserInput) =>
    request<{ user: ManagedUser }>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deactivateUser: (id: string) =>
    request<{ user: ManagedUser }>(`/users/${id}`, { method: 'DELETE' }),
  health: () => request<HealthData>('/health'),
  dashboard: () => request<DashboardData>('/dashboard'),
  resetDemoData: () =>
    request<{ ok: boolean; message: string; dashboard: DashboardData }>('/demo/reset', { method: 'POST' }),
  policies: () => request<PolicyCatalog>('/policies'),
  emailSettings: () => request<MailSettings>('/settings/email'),
  saveEmailSettings: (settings: Omit<MailSettings, 'hasPassword' | 'lastSyncAt' | 'lastImapStatus' | 'lastSmtpStatus' | 'lastError' | 'updatedAt'> & { password?: string }) =>
    request<MailSettings>('/settings/email', { method: 'PUT', body: JSON.stringify(settings) }),
  testEmailSettings: () => request<{ imap: 'OK'; smtp: 'OK' }>('/settings/email/test', { method: 'POST' }),
  incomingRequests: () => request<{ items: IncomingRequest[] }>('/incoming-requests'),
  syncIncomingRequests: () => request<{ imported: number; generated: number; documents: number; movedToTrash: number; total: number }>('/incoming-requests/sync', { method: 'POST' }),
  deleteIncomingRequest: (id: string) =>
    request<{ ok: true; caseCode?: string; deletedObjects: number }>(`/incoming-requests/${id}`, { method: 'DELETE' }),
  generatedCases: () => request<{ items: GeneratedCaseSummary[] }>('/generated-cases'),
  generatedCase: (id: string) => request<{ case: GeneratedCaseDetail }>(`/generated-cases/${id}`),
  analyzeGeneratedCase: (id: string) =>
    request<{ case: GeneratedCaseDetail }>(`/generated-cases/${id}/analyze`, { method: 'POST' }),
  finalizeGeneratedCase: (id: string) =>
    request<{ case: GeneratedCaseDetail }>(`/generated-cases/${id}/finalize`, { method: 'POST' }),
  finalizedCases: () => request<{ items: GeneratedCaseSummary[] }>('/finalized-cases'),
  async downloadFinalizedCases(caseIds: string[]) {
    const response = await fetch(`${API_ROOT}/finalized-cases/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ caseIds }),
    });
    if (!response.ok) {
      let message = 'No fue posible generar los archivos de afiliados y beneficiarios.';
      try {
        const body = await response.json() as { message?: unknown };
        if (typeof body.message === 'string') message = body.message;
      } catch {}
      throw new ApiError(message, response.status);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Casos_Finalizados_AFPC.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  generatedDocumentUrl: (caseId: string, documentId: string) =>
    `${API_ROOT}/generated-cases/${caseId}/documents/${documentId}/content`,
  generatedDocumentPreviewUrl: (caseId: string, documentId: string, page = 1) =>
    `${API_ROOT}/generated-cases/${caseId}/documents/${documentId}/preview?page=${page}`,
  deleteGeneratedCase: (id: string) =>
    request<{ ok: true; code: string; deletedObjects: number }>(`/generated-cases/${id}`, { method: 'DELETE' }),
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

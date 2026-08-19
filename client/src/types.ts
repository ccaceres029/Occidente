export type CaseStatus =
  | 'received'
  | 'in-review'
  | 'returned'
  | 'compliance'
  | 'approved'
  | 'ready-core'
  | 'archived'
  | string;

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export interface MailSettings {
  emailAddress: string;
  username: string;
  incomingHost: string;
  incomingPort: number;
  incomingSecure: boolean;
  outgoingHost: string;
  outgoingPort: number;
  outgoingSecure: boolean;
  enabled: boolean;
  hasPassword: boolean;
  lastSyncAt?: string;
  lastImapStatus: string;
  lastSmtpStatus: string;
  lastError?: string;
  updatedAt: string;
}

export interface IncomingRequest {
  id: string;
  messageId: string;
  mailboxUid: number;
  subject: string;
  senderName?: string;
  senderEmail?: string;
  receivedAt: string;
  snippet?: string;
  hasAttachments: boolean;
  attachmentCount: number;
  status: string;
}

export interface ClientData {
  fullName: string;
  idType: string;
  idNumberMasked: string;
  nationality?: string;
  residenceCountry?: string;
  city?: string;
  birthDate?: string;
  emailMasked?: string;
  phoneMasked?: string;
  civilStatus?: string;
  occupation?: string;
  fatcaIndicators?: string[];
}

export interface ProductData {
  plan: string;
  currency: string;
  contributionAmount: number;
  frequency: string;
  paymentMethod: string;
  sourceOfFunds: string;
  firstContributionDate?: string;
}

export interface RiskData {
  level: string;
  score: number;
  route: string;
  reasons: string[];
}

export interface SlaData {
  receivedAt: string;
  dueAt: string;
  ageHours: number;
  breached: boolean;
}

export interface CaseDocument {
  id: string;
  name: string;
  type: string;
  status: string;
  synthetic: boolean;
  uploadedAt: string;
  mimeType?: string;
  size?: number;
  pages?: number;
  confidence?: number;
  fieldsExtracted?: number;
}

export interface ValidationRule {
  id: string;
  code: string;
  severity: 'error' | 'warning' | 'info' | string;
  title: string;
  message: string;
  field?: string;
  documentType?: string;
  policyRef?: string;
  resolved: boolean;
}

export interface AuditEvent {
  id: string;
  caseId?: string;
  action: string;
  label?: string;
  actor: string;
  note?: string;
  createdAt: string;
  fromStatus?: string;
  toStatus?: string;
}

export interface CaseSummary {
  id: string;
  reference: string;
  status: CaseStatus;
  statusLabel: string;
  currentStage: string;
  agency: string;
  advisor: string;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  client: ClientData;
  product: ProductData;
  risk: RiskData;
  sla: SlaData;
  progress: number;
  documents?: CaseDocument[];
  validations?: ValidationRule[];
}

export interface CaseDetail extends CaseSummary {
  documents: CaseDocument[];
  validations: ValidationRule[];
  auditTrail?: AuditEvent[];
  audit?: AuditEvent[];
  beneficiaries?: Array<{
    name: string;
    idNumberMasked?: string;
    relationship: string;
    percentage: number;
  }>;
  references?: Array<{
    name: string;
    relationship?: string;
    phoneMasked?: string;
  }>;
  canActions?: string[];
  aiSummary?: AiSummaryResponse;
}

export interface DashboardData {
  metrics: {
    total: number;
    inReview: number;
    returned: number;
    compliance: number;
    readyForCore: number;
    reprocessRate: number;
    avgCycleHours: number;
    estimatedHoursSaved: number;
  };
  byStatus: Array<{ status: string; label: string; count: number }>;
  recentCases: CaseSummary[];
  alerts: Array<{ level: string; message: string; count: number }>;
  volumeByDay?: Array<{ date: string; label?: string; count: number }>;
}

export interface HealthData {
  status: string;
  service: string;
  mode: string;
  timestamp: string;
  geminiConfigured: boolean;
  storage?: string;
  database?: string;
}

export interface PolicyRule {
  code: string;
  title: string;
  domain: string;
  severity: 'error' | 'warning' | 'info' | string;
  trigger: string;
  action: string;
  owner: string;
  evidence: string[];
  policyRef: string;
  configurable: boolean;
  status: string;
}

export interface PolicyCatalog {
  version: string;
  mode: string;
  updatedAt: string;
  summary: {
    activeRules: number;
    blockingRules: number;
    complianceRules: number;
    configurableRules: number;
  };
  documentMatrix: Array<{
    type: string;
    label: string;
    condition: string;
    owner: string;
    policyRef: string;
  }>;
  riskBands: Array<{
    range: string;
    route: string;
    review: string;
    policyRef: string;
  }>;
  rules: PolicyRule[];
  disclaimers: string[];
}

export interface CasesResponse {
  items: CaseSummary[];
  total: number;
}

export interface CorePayloadResponse {
  caseId: string;
  generatedAt: string;
  target: string;
  mode: string;
  payload: Record<string, unknown>;
  validation: { valid: boolean; errors: string[] };
}

export interface AiSummaryResponse {
  provider: string;
  configured: boolean;
  summary: string;
  generatedAt: string;
}

export type AiPipelineStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AiInsightAnalysis {
  id: string;
  fingerprint: string;
  engineVersion: string;
  generatedAt: string;
  provider: 'gemini' | 'local-fallback' | string;
  configured?: boolean;
  cached: boolean;
  syntheticOnly: true | boolean;
  mode?: string;
  dataOrigin?: string;
  extractionMethod?: string;
}

export interface AiInsightPipelineStep {
  id: string;
  label: string;
  status: AiPipelineStatus | string;
  durationMs: number;
  itemsProcessed: number;
}

export interface AiDocumentInsight {
  documentId: string;
  name: string;
  predictedType: string;
  label: string;
  confidence: number;
  method: string;
  source?: string;
  contentUrl?: string;
  pages: number;
  quality: {
    readability: number;
    completeness: number;
    orientation: string;
  };
}

export interface AiExtractedField {
  id: string;
  documentId: string;
  documentType: string;
  field: string;
  label: string;
  value: string | number | boolean | null;
  confidence: number;
  page: number;
  evidence: string;
  evidenceLocation?: 'verified-pdf-text' | 'unavailable';
  boundingBox?: { x: number; y: number; width: number; height: number };
  status: string;
  origin?: string;
}

export interface AiConsistencySource {
  documentType: string;
  documentId: string;
  value: string | number | boolean | null;
  confidence: number;
}

export interface AiConsistencyCheck {
  field: string;
  label: string;
  verdict: 'MATCH' | 'MISMATCH' | 'MISSING' | 'REVIEW' | string;
  confidence: number;
  explanation: string;
  sources: AiConsistencySource[];
}

export interface AiAnomaly {
  id: string;
  severity: 'low' | 'medium' | 'high' | string;
  category: string;
  title: string;
  explanation: string;
  evidenceRefs: string[];
  suggestedAction: string;
  ruleCode: string;
}

export interface AiSourceOfFundsInsight {
  declaredSource: string;
  normalizedCategory: string;
  amount: number;
  currency: string;
  alignment: string;
  confidence: number;
  evidenceDocuments: string[];
  checks: Array<{ code: string; label: string; status: string; reason: string }>;
  explanation: string;
  policyRef: string;
}

export interface AiRecommendation {
  decision: string;
  label: string;
  confidence: number;
  humanDecisionRequired: true | boolean;
  rationale: string[];
  nextSteps: Array<{ order: number; owner: string; action: string; reason: string }>;
}

export interface DocumentAiInsights {
  analysis: AiInsightAnalysis;
  pipeline: AiInsightPipelineStep[];
  executiveSummary: string;
  metrics: {
    documentsProcessed: number;
    fieldsExtracted: number;
    averageConfidence: number;
    consistencyRate: number;
    anomaliesDetected: number;
    estimatedManualMinutes: number;
    estimatedAutomatedSeconds: number;
    estimatedMinutesSaved: number;
  };
  documents: AiDocumentInsight[];
  extractedFields: AiExtractedField[];
  consistency: AiConsistencyCheck[];
  anomalies: AiAnomaly[];
  sourceOfFunds: AiSourceOfFundsInsight;
  recommendation: AiRecommendation;
}

export interface ActionResponse {
  case: CaseDetail;
  auditEvent: AuditEvent;
}

export interface ValidationResponse {
  case: CaseDetail;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    canApprove: boolean;
    route: string;
  };
}

export interface CreateCaseInput {
  agency: string;
  advisor: string;
  client: {
    fullName: string;
    idType: string;
    idNumber: string;
    nationality: string;
    residenceCountry: string;
    city: string;
  };
  product: {
    plan: string;
    currency: string;
    contributionAmount: number;
    frequency: string;
    paymentMethod: string;
    sourceOfFunds: string;
  };
  scenario?: string;
}

export type ApplicationPrefillFormPatch = {
  agency?: string;
  advisor?: string;
  client?: Partial<CreateCaseInput['client']>;
  product?: Partial<CreateCaseInput['product']>;
  scenario?: string;
};

export interface ApplicationPrefillField {
  path: string;
  label: string;
  value: string | number | boolean | null;
  confidence: number;
  page: number;
  evidence: string;
  status: string;
}

export interface ApplicationPrefillFile {
  name?: string;
  size?: number;
  type?: string;
  pages?: number;
}

export interface ApplicationPrefillResponse {
  provider: string;
  configured: boolean;
  file: ApplicationPrefillFile | string;
  summary: string | {
    totalFields?: number;
    appliedFields?: number;
    highConfidenceFields?: number;
    lowConfidenceFields?: number;
    averageConfidence?: number;
  };
  fields: ApplicationPrefillField[];
  formPatch: ApplicationPrefillFormPatch;
  warnings: string[];
  requiresHumanReview: boolean;
  disclaimer: string;
}

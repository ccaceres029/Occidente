export const CASE_STATUSES = [
  'RECIBIDO',
  'EN_REVISION',
  'DEVUELTO',
  'CORREGIDO',
  'ESCALADO_CUMPLIMIENTO',
  'APROBADO',
  'LISTO_CORE',
  'ARCHIVADO',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];
export type RiskLevel = 'BAJO' | 'MEDIO' | 'ALTO';
export type ValidationSeverity = 'error' | 'warning' | 'info';
export type DocumentStatus = 'VALID' | 'WARNING' | 'MISSING' | 'UPLOADED';
export type WorkflowAction =
  | 'return'
  | 'correct'
  | 'escalate'
  | 'approve'
  | 'ready-core'
  | 'archive';

export interface ClientProfile {
  fullName: string;
  idType: 'DNI' | 'PASSPORT' | 'RESIDENCE_CARD';
  idNumberMasked: string;
  birthDate?: string;
  nationality: string;
  residenceCountry: string;
  city: string;
  emailMasked?: string;
  phoneMasked?: string;
}

export interface ProductProfile {
  plan: string;
  currency: 'HNL' | 'USD';
  contributionAmount: number;
  frequency: string;
  paymentMethod: string;
  sourceOfFunds: string;
}

export interface CaseFacts {
  educationFinancialYear?: number;
  fatcaPositive: boolean;
  addressConsistent: boolean;
  sourceOfFundsDocumented: boolean;
  signaturesComplete: boolean;
  beneficiaryPercentTotal: number;
  identityVerified: boolean;
  pepDeclared: boolean;
  apnfdDeclared: boolean;
}

export interface CaseDocument {
  id: string;
  name: string;
  type: string;
  status: DocumentStatus;
  synthetic: true;
  uploadedAt: string;
  mimeType?: string;
  size?: number;
  storageKey?: string;
  pages?: number;
  confidence?: number;
  fieldsExtracted?: number;
}

export interface NormalizedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentClassification {
  documentId: string;
  name: string;
  predictedType: string;
  label: string;
  confidence: number;
  method: 'synthetic-template' | 'metadata-inference' | 'gemini-document';
  pages: number;
  source: 'seed-synthetic-metadata' | 'uploaded-synthetic-metadata' | 's3-private-document';
  contentUrl: string;
  quality: {
    readability: number;
    completeness: number;
    orientation: 'upright' | 'rotated' | 'unknown';
  };
}

export interface ExtractedDocumentField {
  id: string;
  documentId: string;
  documentType: string;
  field: string;
  label: string;
  value: string | number | boolean | null;
  confidence: number;
  page: number;
  evidence: string;
  boundingBox?: NormalizedBoundingBox;
  evidenceLocation: 'verified-pdf-text' | 'gemini-pdf-page' | 'unavailable';
  status: 'EXTRACTED' | 'MISSING' | 'LOW_CONFIDENCE' | 'CONFLICT';
  origin: 'synthetic-canonical-template' | 'gemini-document-extraction';
}

export interface ConsistencySource {
  documentType: string;
  documentId: string;
  value: string | number | boolean | null;
  confidence: number;
}

export interface ConsistencyCheck {
  field: string;
  label: string;
  verdict: 'MATCH' | 'MISMATCH' | 'MISSING' | 'REVIEW';
  confidence: number;
  explanation: string;
  sources: ConsistencySource[];
}

export interface DocumentAnomaly {
  id: string;
  severity: 'low' | 'medium' | 'high';
  category:
    | 'completeness'
    | 'consistency'
    | 'regulatory'
    | 'source-of-funds'
    | 'transaction-profile'
    | 'document-quality';
  title: string;
  explanation: string;
  evidenceRefs: string[];
  suggestedAction: string;
  ruleCode: string;
}

export interface SourceOfFundsInsight {
  declaredSource: string;
  normalizedCategory:
    | 'SALARY'
    | 'PROFESSIONAL_SERVICES'
    | 'ASSET_SALE'
    | 'SAVINGS'
    | 'REMITTANCES'
    | 'EMPLOYMENT_BENEFITS'
    | 'OTHER';
  amount: number;
  currency: string;
  alignment: 'CONSISTENT' | 'REVIEW' | 'INSUFFICIENT';
  confidence: number;
  evidenceDocuments: string[];
  checks: Array<{
    code: string;
    label: string;
    status: 'PASS' | 'REVIEW' | 'FAIL';
    reason: string;
  }>;
  explanation: string;
  policyRef: string;
}

export interface CaseRecommendation {
  decision: 'CONTINUE' | 'SUBSANATE' | 'ESCALATE_COMPLIANCE' | 'HUMAN_REVIEW';
  label: string;
  confidence: number;
  humanDecisionRequired: true;
  rationale: string[];
  nextSteps: Array<{
    order: number;
    owner: string;
    action: string;
    reason: string;
  }>;
}

export interface DocumentIntelligenceInsight {
  analysis: {
    id: string;
    fingerprint: string;
    engineVersion: string;
    generatedAt: string;
    provider: 'gemini' | 'local-fallback';
    configured: boolean;
    cached: boolean;
    syntheticOnly: boolean;
    mode: 'document-pipeline-demo' | 'generated-case-document-pipeline';
    dataOrigin: 'synthetic-canonical-snapshot' | 'private-s3-case-documents';
    extractionMethod: 'template-mapped-canonical-data' | 'gemini-multimodal-document-extraction';
    notOcrNotice: string;
    confidenceNotice: string;
  };
  pipeline: Array<{
    id: string;
    label: string;
    status: 'completed';
    durationMs: number;
    itemsProcessed: number;
  }>;
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
  documents: DocumentClassification[];
  extractedFields: ExtractedDocumentField[];
  consistency: ConsistencyCheck[];
  anomalies: DocumentAnomaly[];
  sourceOfFunds: SourceOfFundsInsight;
  recommendation: CaseRecommendation;
  limitations: string[];
}

export interface ValidationResult {
  id: string;
  code: string;
  severity: ValidationSeverity;
  title: string;
  message: string;
  field?: string;
  documentType?: string;
  policyRef?: string;
  resolved: boolean;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  route: 'REVISION_ESTANDAR' | 'REVISION_REFORZADA' | 'CUMPLIMIENTO';
  reasons: string[];
}

export interface SlaSnapshot {
  receivedAt: string;
  dueAt: string;
  ageHours: number;
  breached: boolean;
}

export interface AiSummary {
  provider: 'gemini' | 'local-fallback';
  configured: boolean;
  summary: string;
  generatedAt: string;
}

export interface AfpcCase {
  id: string;
  reference: string;
  synthetic: true;
  status: CaseStatus;
  statusLabel: string;
  currentStage: string;
  agency: string;
  advisor: string;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  client: ClientProfile;
  product: ProductProfile;
  facts: CaseFacts;
  risk: RiskAssessment;
  sla: SlaSnapshot;
  documents: CaseDocument[];
  validations: ValidationResult[];
  progress: number;
  aiSummary?: AiSummary;
  documentIntelligence?: DocumentIntelligenceInsight;
}

export interface AuditEvent {
  id: string;
  caseId: string;
  action: string;
  label: string;
  actor: string;
  note?: string;
  fromStatus?: CaseStatus;
  toStatus?: CaseStatus;
  createdAt: string;
}

export interface CaseDetail extends AfpcCase {
  auditTrail: AuditEvent[];
  canActions: WorkflowAction[];
}

export interface DemoDatabase {
  version: 3;
  cases: AfpcCase[];
  auditEvents: AuditEvent[];
}

export interface RuleEvaluation {
  validations: ValidationResult[];
  risk: RiskAssessment;
  progress: number;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    canApprove: boolean;
    route: RiskAssessment['route'];
  };
}

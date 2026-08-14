/**
 * Synthetic contract content for the local AFPC onboarding demo.
 *
 * This module deliberately excludes names, identity numbers, signatures and
 * corporate registry data from the reference case. It is not approved legal
 * text and must not be used to execute a real affiliation.
 */

export interface ContractMetadata {
  code: string;
  version: string;
  institution: string;
  issuer: string;
  product: string;
  preamble: string;
  purpose: "demo";
  sourcePageCount: number;
  clauseCount: number;
  currencies: readonly ["HNL", "USD"];
  minimumPermanenceYears: number;
  statementFrequency: "trimestral";
  legalNotice: string;
}

export interface ContractSection {
  id: string;
  ordinal: number;
  title: string;
  body: string;
}

export interface EarlyWithdrawalFeeBand {
  fromYearInclusive: number;
  toYearExclusive: number | null;
  demoRate: number;
}

export const CONTRACT_TITLE =
  "Contrato para la Administración de un Plan Individual de Pensiones";

export const CONTRACT_METADATA: Readonly<ContractMetadata> = {
  code: "AFPC-DEMO-CONTRACT-01",
  version: "DEMO-1.0",
  institution:
    "Administradora de Fondos Privados de Pensiones y Cesantías Occidente, S.A.",
  issuer:
    "Administradora de Fondos Privados de Pensiones y Cesantías Occidente, S.A.",
  product: "Plan Individual de Pensiones",
  preamble:
    "Para efectos exclusivos de esta demostración local, la Administradora y la persona afiliada identificada en el resumen simulan la contratación de un Plan Individual de Pensiones. La información, aceptación y firmas presentadas son sintéticas y no producen efectos legales.",
  purpose: "demo",
  sourcePageCount: 16,
  clauseCount: 27,
  currencies: ["HNL", "USD"],
  minimumPermanenceYears: 5,
  statementFrequency: "trimestral",
  legalNotice:
    "Documento sintético generado exclusivamente para una demostración local. No constituye una afiliación, oferta, aceptación ni contrato legal aprobado.",
};

export const CONTRACT_SIGNATURE_LABELS = {
  place: "Ciudad",
  date: "Fecha",
  affiliate: "Persona afiliada (demo)",
  administrator: "Representante autorizado (demo)",
} as const;

/**
 * Rates mirror the structure observed in the reference contract only so the
 * demo can render a coherent table. They are not production parameters.
 */
export const DEMO_EARLY_WITHDRAWAL_FEE_SCHEDULE: readonly EarlyWithdrawalFeeBand[] = [
  { fromYearInclusive: 0, toYearExclusive: 1, demoRate: 0.2 },
  { fromYearInclusive: 1, toYearExclusive: 2, demoRate: 0.15 },
  { fromYearInclusive: 2, toYearExclusive: 3, demoRate: 0.1 },
  { fromYearInclusive: 3, toYearExclusive: 4, demoRate: 0.05 },
  { fromYearInclusive: 4, toYearExclusive: 5, demoRate: 0.03 },
  { fromYearInclusive: 5, toYearExclusive: null, demoRate: 0 },
];

const CONTRACT_SECTION_PARAGRAPHS = [
  {
    id: "definitions",
    ordinal: 1,
    title: "Definiciones",
    body: [
      "Para este documento, la Administradora es la entidad que gestiona el fondo; la persona afiliada es quien contrata voluntariamente el plan; y la cuenta de capitalización individual registra aportes, rendimientos, comisiones, primas y retiros.",
      "También se reconocen aportes ordinarios y extraordinarios, beneficiarios directos y contingentes, valor cuota, retiros anticipados, seguro previsional, FATCA y controles de prevención de lavado de activos y financiamiento del terrorismo.",
    ],
  },
  {
    id: "affiliation-request",
    ordinal: 2,
    title: "Solicitud de afiliación",
    body: [
      "La solicitud de afiliación forma parte del expediente contractual y debe contener los datos requeridos para crear la cuenta. Cuando se elija el seguro previsional, se completará además la información exigida por la institución aseguradora.",
      "La designación de beneficiarios debe indicar porcentajes completos y permitir la sustitución por beneficiarios contingentes o, en su defecto, por quienes determine la normativa aplicable.",
    ],
  },
  {
    id: "changes",
    ordinal: 3,
    title: "Modificaciones",
    body: [
      "La persona afiliada podrá solicitar cambios de beneficiarios, forma de pago, aporte o domicilio por los canales habilitados, sujetos a validación, acuse de recibo y los plazos aplicables.",
    ],
  },
  {
    id: "affiliate-declaration",
    ordinal: 4,
    title: "Declaración de la persona afiliada",
    body: [
      "La persona afiliada declara que actúa por cuenta propia, que la información suministrada es completa y verificable, y que los aportes proceden de actividades lícitas y coherentes con su perfil declarado.",
      "La persona afiliada autoriza las verificaciones de debida diligencia y se obliga a atender solicitudes razonables de información y actualización.",
    ],
  },
  {
    id: "affiliate-obligations",
    ordinal: 5,
    title: "Obligaciones de la persona afiliada",
    body: [
      "La afiliación requiere solicitud completa, identificación vigente y los documentos de respaldo aplicables. Los aportes ordinarios se efectuarán con el monto y frecuencia acordados; los extraordinarios serán voluntarios y quedarán registrados por separado.",
      "Los beneficiarios directos deberán distribuir el cien por ciento del beneficio. La persona afiliada mantendrá actualizados empleo, domicilio, beneficiarios, condición FATCA y método de aportación.",
      "Para fines del demo, una cuenta sin aportes ordinarios durante seis meses consecutivos se mostrará como inactiva, sin perder la trazabilidad del saldo acumulado.",
    ],
  },
  {
    id: "fund-separation",
    ordinal: 6,
    title: "Separación patrimonial del fondo",
    body: [
      "Los recursos del fondo se registran separadamente del patrimonio de la Administradora y pertenecen a las personas afiliadas en proporción a su participación.",
    ],
  },
  {
    id: "affiliate-rights",
    ordinal: 7,
    title: "Derechos de la persona afiliada",
    body: [
      "La participación confiere derecho a beneficios previsionales, rendimientos proporcionales, estados de cuenta, aportes extraordinarios, solicitudes de retiro y presentación de reclamos conforme a las condiciones del plan.",
    ],
  },
  {
    id: "unit-value-date",
    ordinal: 8,
    title: "Asignación del valor cuota",
    body: [
      "Cada aporte recibirá el valor cuota que corresponda una vez cumplidas las reglas de compensación y liquidación aplicables al medio de pago.",
    ],
  },
  {
    id: "portfolio-valuation",
    ordinal: 9,
    title: "Valoración de la cartera",
    body: [
      "La cartera y el valor cuota se calcularán periódicamente conforme a la metodología autorizada. Las variaciones de mercado pueden producir ganancias o pérdidas al momento de un retiro.",
    ],
  },
  {
    id: "tax-treatment",
    ordinal: 10,
    title: "Tratamiento tributario",
    body: [
      "Aportes, rendimientos e inversiones estarán sujetos a la legislación tributaria vigente y a las disposiciones de las autoridades competentes. El demo no calcula beneficios fiscales reales.",
    ],
  },
  {
    id: "optional-insurance",
    ordinal: 11,
    title: "Seguro previsional opcional",
    body: [
      "La cobertura de vida e invalidez es voluntaria, requiere aceptación de la aseguradora, designación válida de beneficiarios y pago de la prima correspondiente.",
    ],
  },
  {
    id: "investment-responsibility",
    ordinal: 12,
    title: "Responsabilidad de inversión",
    body: [
      "La Administradora gestionará los recursos con criterios de seguridad, rentabilidad, liquidez y diversificación, dentro de los lineamientos regulatorios. Los resultados dependerán del comportamiento de la cartera.",
    ],
  },
  {
    id: "administrator-obligations",
    ordinal: 13,
    title: "Obligaciones de la Administradora",
    body: [
      "La Administradora mantendrá registros individuales, ejecutará diligentemente la gestión del fondo, conservará recursos y personal idóneos y aplicará las políticas de inversión aprobadas.",
      "Entregará copia del contrato cuando se solicite, comunicará modificaciones con la anticipación aplicable y reportará aportes, saldos, rendimientos y comisiones en estados de cuenta trimestrales.",
    ],
  },
  {
    id: "claims",
    ordinal: 14,
    title: "Reclamos",
    body: [
      "La persona afiliada podrá presentar reclamos sobre su estado de cuenta dentro del plazo configurado y escalar el caso por los canales regulatorios disponibles cuando no esté conforme con la respuesta.",
    ],
  },
  {
    id: "benefits-and-withdrawals",
    ordinal: 15,
    title: "Beneficios y modalidades de retiro",
    body: [
      "El beneficio depende del saldo de la cuenta. El demo contempla pago único, renta programada por período y retiro de rendimientos, sujetos a elegibilidad, saldo y validación humana.",
    ],
  },
  {
    id: "early-withdrawal",
    ordinal: 16,
    title: "Retiro anticipado",
    body: [
      "La persona afiliada podrá solicitar un retiro parcial o total. Un retiro parcial conserva la cuenta cuando queda saldo; un retiro total cancela la cuenta después de completar los controles y pagos correspondientes.",
    ],
  },
  {
    id: "early-withdrawal-fees",
    ordinal: 17,
    title: "Comisiones por retiro anticipado",
    body: [
      "El demo aplica una tabla ilustrativa decreciente durante los primeros cinco años y una tasa de cero a partir del quinto año. Toda tasa deberá ser validada y parametrizada por el Banco antes de un piloto.",
      "Las excepciones por edad, invalidez, enfermedad grave, fallecimiento o cambios contractuales requieren revisión documental y decisión humana.",
    ],
  },
  {
    id: "term",
    ordinal: 18,
    title: "Vigencia",
    body: [
      "El contrato permanecerá vigente mientras la persona afiliada mantenga participaciones en el fondo, salvo cancelación conforme a las condiciones aplicables.",
    ],
  },
  {
    id: "dispute-resolution",
    ordinal: 19,
    title: "Resolución de controversias",
    body: [
      "Las controversias no resueltas directamente se tramitarán por el mecanismo aprobado y conforme a la legislación hondureña. El texto definitivo debe ser revisado por el área Legal.",
    ],
  },
  {
    id: "severability",
    ordinal: 20,
    title: "Nulidad parcial",
    body: [
      "La invalidez de una disposición no afectará las restantes, siempre que el objeto del contrato pueda mantenerse conforme a derecho.",
    ],
  },
  {
    id: "addenda",
    ordinal: 21,
    title: "Adendas",
    body: [
      "Las partes podrán ampliar o modificar condiciones mediante adenda aceptada y vinculada al expediente, sin menoscabar los derechos de la persona afiliada.",
    ],
  },
  {
    id: "aml-cft",
    ordinal: 22,
    title: "Prevención de lavado de activos y financiamiento del terrorismo",
    body: [
      "La persona afiliada declara la procedencia lícita de sus aportes y autoriza la aplicación de debida diligencia, monitoreo, actualización de datos y reportes obligatorios a las autoridades competentes.",
      "Las alertas automatizadas del demo son auxiliares; toda decisión de escalamiento, aceptación o rechazo corresponde a personal autorizado.",
    ],
  },
  {
    id: "account-cancellation",
    ordinal: 23,
    title: "Cancelación de la cuenta",
    body: [
      "La cuenta podrá cerrarse por incumplimiento contractual o por las causas legalmente aplicables, con justificación, notificación y evidencia registradas en el expediente.",
    ],
  },
  {
    id: "headings",
    ordinal: 24,
    title: "Títulos de las cláusulas",
    body: [
      "Los títulos facilitan la lectura y no alteran el alcance del contenido contractual aprobado.",
    ],
  },
  {
    id: "returns",
    ordinal: 25,
    title: "Rendimientos",
    body: [
      "Los rendimientos se calcularán y acreditarán según la metodología aplicable. Pueden variar y no se garantiza una tasa determinada.",
    ],
  },
  {
    id: "confidentiality",
    ordinal: 26,
    title: "Confidencialidad",
    body: [
      "La información de identidad, cuenta y movimientos se tratará de forma confidencial y solo se revelará por autorización válida, obligación legal o requerimiento de autoridad competente.",
    ],
  },
  {
    id: "acceptance",
    ordinal: 27,
    title: "Declaración de aceptación",
    body: [
      "Para la demostración, la aceptación se representa mediante nombres sintéticos, fecha, ciudad y marcas de firma simuladas. No produce consentimiento ni efectos legales.",
    ],
  },
] as const;

export const CONTRACT_SECTIONS: readonly ContractSection[] =
  CONTRACT_SECTION_PARAGRAPHS.map((section) => ({
    ...section,
    body: section.body.join("\n\n"),
  }));

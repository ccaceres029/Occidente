import { type FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, MailCheck, PlugZap, Save, Server, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, ErrorState, LoadingState, Toast } from '../components/ui';
import type { MailSettings } from '../types';

type EditableSettings = Omit<MailSettings, 'hasPassword' | 'lastSyncAt' | 'lastImapStatus' | 'lastSmtpStatus' | 'lastError' | 'updatedAt'> & { password: string };

function editable(settings: MailSettings): EditableSettings {
  return {
    emailAddress: settings.emailAddress,
    username: settings.username,
    password: '',
    incomingHost: settings.incomingHost,
    incomingPort: settings.incomingPort,
    incomingSecure: settings.incomingSecure,
    outgoingHost: settings.outgoingHost,
    outgoingPort: settings.outgoingPort,
    outgoingSecure: settings.outgoingSecure,
    enabled: settings.enabled,
    moveProcessedToTrash: settings.moveProcessedToTrash,
  };
}

export default function EmailSettingsPage() {
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [form, setForm] = useState<EditableSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.emailSettings();
      setSettings(response);
      setForm(editable(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible cargar la configuración.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const update = <K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.saveEmailSettings({
        ...form,
        ...(form.password ? { password: form.password } : {}),
      });
      setSettings(response);
      setForm(editable(response));
      setToast({ message: 'Configuración de correo guardada de forma segura.', tone: 'success' });
    } catch (saveError) {
      setToast({ message: saveError instanceof Error ? saveError.message : 'No fue posible guardar.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await api.testEmailSettings();
      await load();
      setToast({ message: 'Conexiones IMAP y SMTP verificadas correctamente.', tone: 'success' });
    } catch (testError) {
      await load();
      setToast({ message: testError instanceof Error ? testError.message : 'Falló la verificación.', tone: 'danger' });
    } finally {
      setTesting(false);
    }
  };

  if (loading && !form) return <LoadingState label="Cargando parámetros del correo…" />;
  if (error && !form) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!form || !settings) return null;

  return (
    <div className="email-settings-page">
      <section className="page-lead page-lead--compact">
        <div>
          <div className="eyebrow"><span /> Integraciones</div>
          <h2>Correo de entrada y salida</h2>
          <p>Parametriza el buzón que recibe las solicitudes de afiliación y envía las respuestas del portal.</p>
        </div>
        <div className="page-lead__actions">
          <Badge tone={settings.hasPassword ? 'success' : 'warning'} dot>
            {settings.hasPassword ? 'Credencial protegida' : 'Falta contraseña'}
          </Badge>
          <Button variant="secondary" icon={<PlugZap size={17} />} loading={testing} disabled={!settings.hasPassword} onClick={() => void test()}>
            Probar conexiones
          </Button>
        </div>
      </section>

      <div className="mail-status-strip">
        <div><MailCheck size={19} /><span><small>Cuenta operativa</small><strong>{settings.emailAddress}</strong></span></div>
        <div><Server size={19} /><span><small>IMAP entrante</small><strong>{settings.lastImapStatus}</strong></span></div>
        <div><Server size={19} /><span><small>SMTP saliente</small><strong>{settings.lastSmtpStatus}</strong></span></div>
        <div><ShieldCheck size={19} /><span><small>Transporte</small><strong>TLS activo</strong></span></div>
      </div>

      {settings.lastError && <div className="inline-error">{settings.lastError}</div>}

      <form className="mail-settings-form" onSubmit={save}>
        <section className="settings-band">
          <header><div className="settings-band__icon"><MailCheck size={20} /></div><div><h3>Identidad del buzón</h3><p>Dirección utilizada por el portal para recibir y enviar solicitudes.</p></div></header>
          <div className="settings-form-grid">
            <label><span>Dirección de correo</span><input type="email" required value={form.emailAddress} onChange={(event) => update('emailAddress', event.target.value)} /></label>
            <label><span>Nombre de usuario</span><input type="text" required autoComplete="username" value={form.username} onChange={(event) => update('username', event.target.value)} /></label>
            <label className="settings-field--wide"><span>Contraseña {settings.hasPassword && <em>ya configurada</em>}</span><div className="settings-password"><KeyRound size={17} /><input type="password" autoComplete="new-password" placeholder={settings.hasPassword ? 'Dejar vacío para conservarla' : 'Ingrese la contraseña del buzón'} value={form.password} onChange={(event) => update('password', event.target.value)} /></div></label>
          </div>
        </section>

        <section className="settings-band">
          <header><div className="settings-band__icon"><Server size={20} /></div><div><h3>Entrada IMAP</h3><p>Lectura segura de la bandeja donde llegan las solicitudes.</p></div></header>
          <div className="settings-form-grid settings-form-grid--server">
            <label><span>Servidor entrante</span><input required value={form.incomingHost} onChange={(event) => update('incomingHost', event.target.value)} /></label>
            <label><span>Puerto IMAP</span><input type="number" min="1" max="65535" required value={form.incomingPort} onChange={(event) => update('incomingPort', Number(event.target.value))} /></label>
            <label className="settings-toggle"><input type="checkbox" checked={form.incomingSecure} onChange={(event) => update('incomingSecure', event.target.checked)} /><span><strong>TLS directo</strong><small>Conexión cifrada desde el inicio</small></span></label>
            <label className="settings-toggle"><input type="checkbox" checked={form.moveProcessedToTrash} onChange={(event) => update('moveProcessedToTrash', event.target.checked)} /><span><strong>Mover procesados a Papelera</strong><small>Solo después de guardar la solicitud y sus documentos</small></span></label>
          </div>
        </section>

        <section className="settings-band">
          <header><div className="settings-band__icon settings-band__icon--orange"><Server size={20} /></div><div><h3>Salida SMTP</h3><p>Servidor utilizado para las comunicaciones salientes del proceso.</p></div></header>
          <div className="settings-form-grid settings-form-grid--server">
            <label><span>Servidor de salida</span><input required value={form.outgoingHost} onChange={(event) => update('outgoingHost', event.target.value)} /></label>
            <label><span>Puerto SMTP</span><input type="number" min="1" max="65535" required value={form.outgoingPort} onChange={(event) => update('outgoingPort', Number(event.target.value))} /></label>
            <label className="settings-toggle"><input type="checkbox" checked={form.outgoingSecure} onChange={(event) => update('outgoingSecure', event.target.checked)} /><span><strong>TLS directo</strong><small>Requerido para el puerto configurado</small></span></label>
          </div>
        </section>

        <footer className="settings-actions">
          <label className="settings-toggle settings-toggle--enabled"><input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /><span><strong>Sincronización activa</strong><small>Consultar periódicamente la bandeja de entrada</small></span></label>
          <Button type="submit" icon={<Save size={17} />} loading={saving}>Guardar configuración</Button>
        </footer>
      </form>

      <div className="mail-security-note"><CheckCircle2 size={18} /><p>La contraseña se cifra en el servidor antes de almacenarse. La aplicación nunca la devuelve al navegador ni la incluye en registros.</p></div>
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </div>
  );
}

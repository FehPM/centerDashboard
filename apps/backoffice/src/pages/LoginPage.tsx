import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { ApiError, backofficeApi, setOperatorToken, type LoginResult } from '../lib/api-client.js';

const INPUT_STYLE = {
  borderColor: 'var(--hairline)', backgroundColor: 'var(--page-plane)', color: 'var(--text-primary)',
};

function Field(props: {
  id: string; label: string; type?: string; value: string; onChange: (v: string) => void;
  autoComplete?: string; inputMode?: 'numeric'; maxLength?: number;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="block text-sm" style={{ color: 'var(--text-secondary)' }}>
        {props.label}
      </label>
      <input id={props.id} type={props.type ?? 'text'} value={props.value}
        autoComplete={props.autoComplete} inputMode={props.inputMode} maxLength={props.maxLength}
        onChange={(event) => props.onChange(event.target.value)}
        className="w-full rounded-md border px-3 py-2" style={INPUT_STYLE} />
    </div>
  );
}

const GENERIC_ERROR = 'Não foi possível entrar agora. Tente novamente.';

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'E-mail ou senha inválidos';
    if (err.status === 429) return err.message;
  }
  return GENERIC_ERROR;
}

function totpErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 400) return 'Código inválido';
    if (err.status === 429) return err.message;
  }
  return GENERIC_ERROR;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<LoginResult | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const otpauthUri = step?.stage === 'enroll' ? step.otpauthUri : null;
  useEffect(() => {
    if (!otpauthUri) return;
    let cancelled = false;
    setQrFailed(false);
    QRCode.toDataURL(otpauthUri)
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setQrFailed(true); });
    return () => { cancelled = true; };
  }, [otpauthUri]);

  async function handleCredentials(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    try {
      setStep(await backofficeApi.login(email, password));
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Descarta o desafio (token temporário) para não deixar beco sem saída se expirar.
  function backToCredentials(): void {
    setStep(null);
    setQr(null);
    setCode('');
    setError(null);
  }

  async function handleCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!step || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const result = await backofficeApi.verifyTotp(step.token, code);
      setOperatorToken(result.token);
      navigate('/clientes', { replace: true });
    } catch (err) {
      setError(totpErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const cardStyle = { backgroundColor: 'var(--surface-1)', borderColor: 'var(--hairline)' };
  const button = 'w-full rounded-md px-3 py-2 font-medium disabled:opacity-50';
  const buttonStyle = { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      {step === null ? (
        <form onSubmit={handleCredentials} className="w-full max-w-sm space-y-4 rounded-lg border p-6" style={cardStyle}>
          <h1 className="text-xl font-semibold">Center Back-office</h1>
          <Field id="email" label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="username" />
          <Field id="password" label="Senha" type="password" value={password} onChange={setPassword}
            autoComplete="current-password" />
          {error && <p role="alert" className="text-sm" style={{ color: 'var(--critical)' }}>{error}</p>}
          <button type="submit" disabled={busy} className={button} style={buttonStyle}>Entrar</button>
        </form>
      ) : (
        <form onSubmit={handleCode} className="w-full max-w-sm space-y-4 rounded-lg border p-6" style={cardStyle}>
          {step.stage === 'enroll' ? (
            <>
              <h1 className="text-xl font-semibold">Configure o autenticador</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Escaneie o QR code no seu aplicativo autenticador ou digite o segredo manualmente.
              </p>
              {qrFailed && (
                <p role="alert" className="text-sm" style={{ color: 'var(--critical)' }}>
                  Não foi possível gerar o QR code; use o código abaixo.
                </p>
              )}
              {qr && <img src={qr} alt="QR code do autenticador" className="mx-auto h-48 w-48 rounded bg-white p-2" />}
              <p className="break-all text-center font-mono text-sm">{step.secret}</p>
            </>
          ) : (
            <h1 className="text-xl font-semibold">Verificação em duas etapas</h1>
          )}
          <Field id="code" label="Código" value={code} inputMode="numeric" maxLength={6}
            autoComplete="one-time-code" onChange={(v) => setCode(v.replace(/\D/g, ''))} />
          {error && <p role="alert" className="text-sm" style={{ color: 'var(--critical)' }}>{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className={button} style={buttonStyle}>
            Confirmar
          </button>
          <button type="button" onClick={backToCredentials} className="w-full text-sm"
            style={{ color: 'var(--text-secondary)' }}>
            Voltar
          </button>
        </form>
      )}
    </div>
  );
}

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { encode as base64Encode } from "base-64";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API_ROOT = "https://www.lucky-me.app/admin/api";
const CREDENTIAL_KEY = "luckyme-admin-credentials-v1";

type Credentials = { username: string; password: string };
type UnitState = {
  ActiveState?: string;
  SubState?: string;
  UnitFileState?: string;
  Result?: string;
  ExecMainStatus?: string;
  NextElapseUSecRealtime?: string;
};
type Round = { pool: string; roundId: number | null; startTs: number; endTs: number; settled: boolean; outcome: string | null };
type AdminStatus = {
  ok: boolean;
  timestamp: string;
  actionNonce: string;
  actionInProgress: boolean;
  monitor: {
    ok?: boolean;
    timestamp?: string;
    alerts?: Array<{ code: string; message: string }>;
    checks?: {
      api?: { ok?: boolean; cluster?: string };
      rpc?: { ok?: boolean; slot?: number };
      keeper?: { address?: string; balanceLamports?: number };
      rounds?: Round[];
    };
  };
  controls: {
    settlement: { timer: UnitState; service: UnitState };
    notifications: { timer: UnitState; service: UnitState };
  };
};

function authorization(credentials: Credentials) {
  return `Basic ${base64Encode(`${credentials.username}:${credentials.password}`)}`;
}

async function request<T>(credentials: Credentials, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: authorization(credentials),
      ...(options.body ? { "Content-Type": "application/json", "X-LuckyMe-Admin-Request": "1" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? payload.error ?? `Server returned HTTP ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return payload as T;
}

function shortAddress(value?: string) {
  if (!value || value.length < 14) return value ?? "—";
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function timerHealthy(timer: UnitState) {
  return timer.ActiveState === "active" && timer.UnitFileState === "enabled";
}

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState("");

  useEffect(() => {
    void restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const saved = await SecureStore.getItemAsync(CREDENTIAL_KEY, {
        requireAuthentication: true,
        authenticationPrompt: "Unlock LuckyMe Admin",
      });
      if (saved) {
        const restored = JSON.parse(saved) as Credentials;
        await request(restored, "/status");
        setCredentials(restored);
      }
    } catch {
      // A cancelled biometric prompt simply returns to the login screen.
    } finally {
      setBooting(false);
    }
  }

  async function login(next: Credentials, remember: boolean) {
    setBusy(true);
    setError("");
    try {
      const nextStatus = await request<AdminStatus>(next, "/status");
      if (remember) {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!compatible || !enrolled) {
          Alert.alert("Biometrics unavailable", "The login works, but credentials were not saved because no biometric lock is configured.");
        } else {
          await SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify(next), { requireAuthentication: true });
        }
      }
      setCredentials(next);
      setStatus(nextStatus);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await SecureStore.deleteItemAsync(CREDENTIAL_KEY).catch(() => undefined);
    setCredentials(null);
    setStatus(null);
    setLogs("");
    setError("");
  }

  if (booting) return <LoadingScreen label="Unlocking admin…" />;
  if (!credentials) return <LoginScreen busy={busy} error={error} onLogin={login} />;

  return (
    <Dashboard
      credentials={credentials}
      status={status}
      busy={busy}
      error={error}
      logs={logs}
      onStatus={setStatus}
      onBusy={setBusy}
      onError={setError}
      onLogs={setLogs}
      onLogout={logout}
    />
  );
}

function LoadingScreen({ label }: { label: string }) {
  return <SafeAreaView style={styles.center}><StatusBar barStyle="light-content" /><ActivityIndicator color="#14f195" size="large" /><Text style={styles.muted}>{label}</Text></SafeAreaView>;
}

function LoginScreen({ busy, error, onLogin }: { busy: boolean; error: string; onLogin: (credentials: Credentials, remember: boolean) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const ready = username.trim().length > 0 && password.length > 0 && !busy;
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.loginWrap} keyboardShouldPersistTaps="handled">
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>LM</Text></View>
        <Text style={styles.eyebrow}>PRIVATE OPERATIONS</Text>
        <Text style={styles.title}>LuckyMe Admin</Text>
        <Text style={styles.subtitle}>Protected control for keeper, notifications and mainnet monitoring.</Text>
        <View style={styles.loginCard}>
          <Text style={styles.label}>Username</Text>
          <TextInput autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} style={styles.input} placeholder="Admin username" placeholderTextColor="#64748b" />
          <Text style={styles.label}>Password</Text>
          <TextInput autoCapitalize="none" autoCorrect={false} secureTextEntry value={password} onChangeText={setPassword} style={styles.input} placeholder="Password" placeholderTextColor="#64748b" onSubmitEditing={() => ready && void onLogin({ username: username.trim(), password }, remember)} />
          <Pressable style={styles.rememberRow} onPress={() => setRemember((value) => !value)}>
            <View style={[styles.checkbox, remember && styles.checkboxOn]}>{remember ? <Text style={styles.check}>✓</Text> : null}</View>
            <Text style={styles.rememberText}>Protect saved login with biometrics</Text>
          </Pressable>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={!ready} style={[styles.primaryButton, !ready && styles.buttonDisabled]} onPress={() => void onLogin({ username: username.trim(), password }, remember)}>
            {busy ? <ActivityIndicator color="#04120d" /> : <Text style={styles.primaryButtonText}>Secure login</Text>}
          </Pressable>
        </View>
        <Text style={styles.footnote}>No Solana key or seed phrase is stored in this application.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

type DashboardProps = {
  credentials: Credentials;
  status: AdminStatus | null;
  busy: boolean;
  error: string;
  logs: string;
  onStatus: (status: AdminStatus) => void;
  onBusy: (busy: boolean) => void;
  onError: (error: string) => void;
  onLogs: (logs: string) => void;
  onLogout: () => Promise<void>;
};

function Dashboard(props: DashboardProps) {
  const { credentials, status, busy, error, logs, onStatus, onBusy, onError, onLogs, onLogout } = props;
  const keeperSol = Number(status?.monitor.checks?.keeper?.balanceLamports ?? 0) / 1_000_000_000;
  const alerts = status?.monitor.alerts ?? [];
  const overallHealthy = status?.monitor.ok === true;
  const updated = useMemo(() => status?.monitor.timestamp ? new Date(status.monitor.timestamp).toLocaleString() : "—", [status?.monitor.timestamp]);

  useEffect(() => {
    if (!status) void refresh();
    const timer = setInterval(() => void refresh(true), 15_000);
    return () => clearInterval(timer);
  }, []);

  async function refresh(silent = false) {
    if (!silent) onBusy(true);
    try {
      onStatus(await request<AdminStatus>(credentials, "/status"));
      onError("");
    } catch (refreshError) {
      onError(refreshError instanceof Error ? refreshError.message : "Status unavailable");
    } finally {
      if (!silent) onBusy(false);
    }
  }

  function confirmAction(action: string, title: string, message: string) {
    if (!status?.actionNonce) return;
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: action.includes("stop") ? "destructive" : "default", onPress: () => void runAction(action) },
    ]);
  }

  async function runAction(action: string) {
    if (!status?.actionNonce) return;
    onBusy(true);
    onError("");
    try {
      const result = await request<{ status: AdminStatus }>(credentials, "/actions", {
        method: "POST",
        body: JSON.stringify({ action, confirmation: action, nonce: status.actionNonce }),
      });
      onStatus(result.status);
      if (action === "settlement_preview") await loadLogs("preview");
      Alert.alert("Completed", "The server accepted and completed the protected action.");
    } catch (actionError) {
      onError(actionError instanceof Error ? actionError.message : "Action failed");
      await refresh(true);
    } finally {
      onBusy(false);
    }
  }

  async function loadLogs(unit: string) {
    onBusy(true);
    try {
      const result = await request<{ logs: string }>(credentials, `/logs?unit=${encodeURIComponent(unit)}&lines=80`);
      onLogs(result.logs || "No journal entries.");
      onError("");
    } catch (logError) {
      onError(logError instanceof Error ? logError.message : "Logs unavailable");
    } finally {
      onBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void refresh()} tintColor="#14f195" />} contentContainerStyle={styles.dashboard}>
        <View style={styles.headerRow}>
          <View><Text style={styles.eyebrow}>LUCKYME OPERATIONS</Text><Text style={styles.dashboardTitle}>Admin control</Text></View>
          <Pressable style={styles.logout} onPress={() => void onLogout()}><Text style={styles.logoutText}>Lock</Text></Pressable>
        </View>
        <View style={[styles.healthBanner, overallHealthy ? styles.healthGood : styles.healthBad]}>
          <Text style={styles.healthTitle}>{overallHealthy ? "All systems healthy" : `${alerts.length || 1} alert${alerts.length === 1 ? "" : "s"}`}</Text>
          <Text style={styles.healthCopy}>Updated {updated}</Text>
        </View>
        {error ? <Text style={styles.errorPanel}>{error}</Text> : null}
        {alerts.map((alert) => <View key={alert.code} style={styles.alert}><Text style={styles.alertCode}>{alert.code}</Text><Text style={styles.alertMessage}>{alert.message}</Text></View>)}

        <View style={styles.metricGrid}>
          <Metric label="API" value={status?.monitor.checks?.api?.ok ? "Healthy" : "Attention"} />
          <Metric label="RPC" value={status?.monitor.checks?.rpc?.ok ? "Healthy" : "Attention"} />
          <Metric label="Keeper" value={`${keeperSol.toFixed(6)} SOL`} copy={shortAddress(status?.monitor.checks?.keeper?.address)} />
          <Metric label="Slot" value={String(status?.monitor.checks?.rpc?.slot ?? "—")} />
        </View>

        <SectionTitle title="Pool rounds" copy="Live on-chain lifecycle" />
        <View style={styles.panel}>
          {(status?.monitor.checks?.rounds ?? []).map((round) => (
            <View key={round.pool} style={styles.roundRow}>
              <View><Text style={styles.roundPool}>{round.pool.toUpperCase()}</Text><Text style={styles.roundCopy}>Round {round.roundId ?? "—"}</Text></View>
              <View style={styles.roundRight}><Text style={styles.roundOutcome}>{round.outcome ?? "—"}</Text><Text style={styles.roundCopy}>{round.startTs > 0 ? "Running" : "Waiting"}</Text></View>
            </View>
          ))}
        </View>

        <SectionTitle title="Settlement keeper" copy="Mainnet lifecycle automation" />
        <ServicePanel state={status?.controls.settlement} />
        <View style={styles.actionRow}>
          <ActionButton label="Dry-run preview" onPress={() => confirmAction("settlement_preview", "Run keeper preview?", "This is read-only. It inspects every pool and sends no transaction.")} disabled={busy} />
          {timerHealthy(status?.controls.settlement.timer ?? {}) ?
            <ActionButton danger label="Stop timer" onPress={() => confirmAction("settlement_timer_stop", "Stop keeper timer?", "Automatic round processing will stop until you enable it again.")} disabled={busy} /> :
            <ActionButton label="Start timer" onPress={() => confirmAction("settlement_timer_start", "Start keeper timer?", "Automatic processing will resume with one simulated transaction maximum per run.")} disabled={busy} />}
        </View>
        <Pressable style={styles.logButton} onPress={() => void loadLogs("settlement")}><Text style={styles.logButtonText}>View keeper journal</Text></Pressable>

        <SectionTitle title="Push notifications" copy="Round start and final countdown alerts" />
        <ServicePanel state={status?.controls.notifications} />
        <View style={styles.actionRow}>
          <ActionButton label="Run once" onPress={() => confirmAction("notifications_run_once", "Run notification check?", "The sender will check all pools. Duplicate notifications remain protected by server state.")} disabled={busy} />
          {timerHealthy(status?.controls.notifications.timer ?? {}) ?
            <ActionButton danger label="Stop timer" onPress={() => confirmAction("notifications_timer_stop", "Stop notification timer?", "Phones will not receive automatic round alerts while it is stopped.")} disabled={busy} /> :
            <ActionButton label="Start timer" onPress={() => confirmAction("notifications_timer_start", "Start notification timer?", "Automatic notification checks will resume.")} disabled={busy} />}
        </View>
        <Pressable style={styles.logButton} onPress={() => void loadLogs("notifications")}><Text style={styles.logButtonText}>View notification journal</Text></Pressable>

        {logs ? <View style={styles.logs}><View style={styles.logsHeader}><Text style={styles.logsTitle}>Recent journal</Text><Pressable onPress={() => onLogs("")}><Text style={styles.logsClose}>Close</Text></Pressable></View><ScrollView horizontal><Text selectable style={styles.logsText}>{logs}</Text></ScrollView></View> : null}
        <Text style={styles.footnote}>All control actions are fixed, confirmed and recorded on the server. The APK cannot execute arbitrary commands.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text>{copy ? <Text style={styles.metricCopy}>{copy}</Text> : null}</View>;
}

function SectionTitle({ title, copy }: { title: string; copy: string }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text><Text style={styles.sectionCopy}>{copy}</Text></View>;
}

function ServicePanel({ state }: { state?: { timer: UnitState; service: UnitState } }) {
  const healthy = timerHealthy(state?.timer ?? {});
  return <View style={styles.panel}><View style={styles.serviceTop}><Text style={styles.serviceTitle}>{healthy ? "Enabled and active" : "Stopped"}</Text><View style={[styles.dot, healthy ? styles.dotGood : styles.dotBad]} /></View><View style={styles.serviceGrid}><Text style={styles.serviceKey}>Timer</Text><Text style={styles.serviceValue}>{state?.timer.ActiveState ?? "—"}</Text><Text style={styles.serviceKey}>Enabled</Text><Text style={styles.serviceValue}>{state?.timer.UnitFileState ?? "—"}</Text><Text style={styles.serviceKey}>Last result</Text><Text style={styles.serviceValue}>{state?.service.Result ?? "—"}</Text><Text style={styles.serviceKey}>Exit</Text><Text style={styles.serviceValue}>{state?.service.ExecMainStatus ?? "—"}</Text></View></View>;
}

function ActionButton({ label, onPress, danger = false, disabled = false }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.actionButton, danger && styles.actionDanger, disabled && styles.buttonDisabled]}><Text style={[styles.actionText, danger && styles.actionDangerText]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#071018" },
  center: { flex: 1, gap: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#071018" },
  muted: { color: "#94a3b8", fontSize: 14 },
  loginWrap: { flexGrow: 1, padding: 24, justifyContent: "center" },
  brandMark: { width: 72, height: 72, borderRadius: 22, backgroundColor: "#14f195", alignItems: "center", justifyContent: "center", marginBottom: 24, shadowColor: "#14f195", shadowOpacity: 0.3, shadowRadius: 18 },
  brandMarkText: { color: "#04120d", fontSize: 24, fontWeight: "900" },
  eyebrow: { color: "#22d3ee", fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  title: { color: "#f8fafc", fontSize: 34, lineHeight: 42, fontWeight: "900", marginTop: 8 },
  subtitle: { color: "#94a3b8", fontSize: 16, lineHeight: 24, marginTop: 8, marginBottom: 24 },
  loginCard: { backgroundColor: "#101b27", borderColor: "#213246", borderWidth: 1, borderRadius: 22, padding: 20 },
  label: { color: "#cbd5e1", fontSize: 13, fontWeight: "700", marginBottom: 8, marginTop: 10 },
  input: { color: "#f8fafc", backgroundColor: "#071018", borderColor: "#2b3c50", borderWidth: 1, borderRadius: 12, minHeight: 52, paddingHorizontal: 14, fontSize: 16 },
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 18 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderColor: "#475569", borderWidth: 1, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: "#14f195", borderColor: "#14f195" },
  check: { color: "#04120d", fontWeight: "900" },
  rememberText: { color: "#cbd5e1", fontSize: 13, flex: 1 },
  error: { color: "#fb7185", marginBottom: 12 },
  primaryButton: { backgroundColor: "#14f195", minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#04120d", fontWeight: "900", fontSize: 16 },
  buttonDisabled: { opacity: 0.45 },
  footnote: { color: "#64748b", textAlign: "center", lineHeight: 19, fontSize: 12, marginTop: 20, marginBottom: 12 },
  dashboard: { padding: 18, paddingBottom: 40 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  dashboardTitle: { color: "#f8fafc", fontSize: 28, fontWeight: "900", marginTop: 4 },
  logout: { borderColor: "#334155", borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  logoutText: { color: "#cbd5e1", fontWeight: "800" },
  healthBanner: { padding: 18, borderRadius: 18, borderWidth: 1 },
  healthGood: { backgroundColor: "#0b2a24", borderColor: "#167d64" },
  healthBad: { backgroundColor: "#32151c", borderColor: "#9f3045" },
  healthTitle: { color: "#f8fafc", fontSize: 20, fontWeight: "900" },
  healthCopy: { color: "#a7b5c5", fontSize: 12, marginTop: 6 },
  errorPanel: { color: "#fecdd3", backgroundColor: "#3b1720", borderRadius: 12, padding: 14, marginTop: 12 },
  alert: { backgroundColor: "#301b13", borderColor: "#854d20", borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 10 },
  alertCode: { color: "#fdba74", fontWeight: "900", fontSize: 12 },
  alertMessage: { color: "#fed7aa", marginTop: 4, lineHeight: 20 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  metric: { width: "48%", flexGrow: 1, minHeight: 102, backgroundColor: "#101b27", borderColor: "#213246", borderWidth: 1, borderRadius: 16, padding: 14 },
  metricLabel: { color: "#64748b", fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  metricValue: { color: "#f8fafc", fontWeight: "900", fontSize: 17, marginTop: 10 },
  metricCopy: { color: "#94a3b8", fontSize: 11, marginTop: 6 },
  sectionTitle: { marginTop: 26, marginBottom: 10 },
  sectionHeading: { color: "#f8fafc", fontWeight: "900", fontSize: 20 },
  sectionCopy: { color: "#64748b", marginTop: 3, fontSize: 12 },
  panel: { backgroundColor: "#101b27", borderColor: "#213246", borderWidth: 1, borderRadius: 18, padding: 15 },
  roundRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, borderBottomColor: "#1e293b", borderBottomWidth: StyleSheet.hairlineWidth },
  roundPool: { color: "#22d3ee", fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  roundCopy: { color: "#64748b", fontSize: 11, marginTop: 4 },
  roundRight: { alignItems: "flex-end" },
  roundOutcome: { color: "#e2e8f0", fontWeight: "800", fontSize: 12 },
  serviceTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  serviceTitle: { color: "#f8fafc", fontWeight: "900", fontSize: 17 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  dotGood: { backgroundColor: "#14f195" },
  dotBad: { backgroundColor: "#fb7185" },
  serviceGrid: { flexDirection: "row", flexWrap: "wrap" },
  serviceKey: { width: "50%", color: "#64748b", paddingVertical: 6 },
  serviceValue: { width: "50%", color: "#cbd5e1", textAlign: "right", paddingVertical: 6, fontWeight: "800" },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  actionButton: { flex: 1, minHeight: 48, borderRadius: 13, backgroundColor: "#123f37", borderColor: "#167d64", borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  actionDanger: { backgroundColor: "#32151c", borderColor: "#9f3045" },
  actionText: { color: "#5eeabf", fontWeight: "900", textAlign: "center" },
  actionDangerText: { color: "#fda4af" },
  logButton: { marginTop: 10, borderRadius: 12, borderColor: "#334155", borderWidth: 1, paddingVertical: 13, alignItems: "center" },
  logButtonText: { color: "#cbd5e1", fontWeight: "800" },
  logs: { backgroundColor: "#03070b", borderColor: "#334155", borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 20 },
  logsHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  logsTitle: { color: "#f8fafc", fontWeight: "900" },
  logsClose: { color: "#22d3ee", fontWeight: "800" },
  logsText: { color: "#94a3b8", fontFamily: "monospace", fontSize: 10, lineHeight: 15, minWidth: 700 },
});


import { create } from 'zustand';
import type { HardwareAction, HardwareRequest, HardwareSnapshot } from '../services/hardware';
import { buildKey, circuitKey } from '../domain/semantics';
import { useWorkspace } from './store';
let preparingController: AbortController | null = null;
export function cancelPreparation() {
  preparingController?.abort();
  const id = useHardware.getState().preparationId;
  if (id) void window.trace?.hardware.cancel(id).catch(() => undefined);
}
export const useHardware = create<{
  snapshot: HardwareSnapshot | null;
  portKey: string;
  baud: number;
  delimiter: 'lf' | 'cr' | 'crlf';
  resume: boolean;
  preparing: boolean;
  warning: boolean;
  preparationId: string | null;
  approvalId: string | null;
  setPort: (key: string) => void;
}>((set) => ({
  snapshot: null,
  portKey: '',
  baud: 115200,
  delimiter: 'lf',
  resume: false,
  preparing: false,
  preparationId: null,
  warning: false,
  approvalId: null,
  setPort: (portKey) => {
    const state = useHardware.getState();
    if (state.preparing) cancelPreparation();
    for (const r of state.snapshot?.requests ?? [])
      if (r.status === 'pending') void window.trace?.hardware.cancel(r.id);
    set({ portKey, approvalId: null });
  },
}));
export function receiveHardware(snapshot: HardwareSnapshot) {
  const old = useHardware.getState().snapshot;
  const selected = useHardware.getState().portKey;
  if (
    selected &&
    old?.ports.some((p) => p.key === selected) &&
    !snapshot.ports.some((p) => p.key === selected)
  )
    useHardware.setState({ portKey: '' });
  const completed = snapshot.requests.find(
    (r) =>
      ['failed', 'cancelled', 'completed'].includes(r.status) &&
      old?.requests.some((p) => p.id === r.id && p.status !== r.status),
  );
  if (completed && (completed.error || completed.warning || completed.status === 'completed'))
    useWorkspace.setState({
      notice: (
        completed.error ??
        completed.warning ??
        `${completed.operation.action === 'upload' ? 'Programmed' : 'Operation complete'}${completed.operation.action === 'upload' ? ' · Start monitoring in Debug.' : ''}`
      )
        .split('\n')[0]
        .slice(0, 220),
    });
  const upload = snapshot.requests.find(
    (r) =>
      r.operation.action === 'upload' &&
      r.status === 'completed' &&
      old?.requests.some((p) => p.id === r.id && p.status !== 'completed'),
  );
  useHardware.setState({ snapshot });
  if (upload) useWorkspace.setState({ workspace: 'debug' });
}
export function verificationCurrent() {
  const { project } = useWorkspace.getState(),
    v = useHardware.getState().snapshot?.verification;
  return !!v && v.circuitKey === circuitKey(project) && v.buildKey === buildKey(project);
}
export async function verifyProject() {
  const s = useWorkspace.getState();
  if (!window.trace?.hardware) {
    useWorkspace.setState({ notice: 'Verification with compilation requires the desktop app.' });
    return;
  }
  const requestId = crypto.randomUUID();
  useWorkspace.setState({
    building: true,
    buildRequestId: requestId,
    outputOpen: true,
    outputTab: 'build',
  });
  try {
    const snapshot = await window.trace.hardware.verify(s.project, requestId);
    receiveHardware(snapshot);
    if (snapshot.verification) useWorkspace.setState({ result: snapshot.verification.result });
  } catch (e) {
    useWorkspace.setState({ notice: String(e) });
  } finally {
    useWorkspace.setState({ building: false, buildRequestId: null });
  }
}
export async function requestHardware(
  operation: HardwareAction,
  reason: string,
  origin: 'human' | 'agent' = 'human',
  providedRequestId?: string,
  abortSignal?: AbortSignal,
): Promise<HardwareRequest> {
  if (!window.trace?.hardware) throw new Error('Hardware operations require the desktop app.');
  if (useHardware.getState().preparing) throw new Error('Another operation is being prepared.');
  const requestId = providedRequestId ?? crypto.randomUUID();
  const controller = new AbortController();
  preparingController = controller;
  const cancel = () => {
    controller.abort();
    void window.trace?.hardware.cancel(requestId).catch(() => undefined);
  };
  abortSignal?.addEventListener('abort', cancel, { once: true });
  if (abortSignal?.aborted) cancel();
  useHardware.setState({ preparing: true, preparationId: requestId });
  try {
    if (controller.signal.aborted) throw new Error('Preparation cancelled.');
    await window.trace.hardware.syncProject(useWorkspace.getState().project);
    if (controller.signal.aborted) throw new Error('Preparation cancelled.');
    const request = await window.trace.hardware.request({ operation, reason, origin, requestId });
    useHardware.setState({ approvalId: request.id });
    receiveHardware(await window.trace.hardware.snapshot());
    return request;
  } finally {
    abortSignal?.removeEventListener('abort', cancel);
    if (preparingController === controller) preparingController = null;
    useHardware.setState({ preparing: false, preparationId: null });
  }
}
export async function programBoard() {
  if (!useHardware.getState().portKey) {
    useWorkspace.setState({ notice: 'Select a physical serial port.' });
    return;
  }
  if (!verificationCurrent()) {
    useHardware.setState({ warning: true });
    return;
  }
  await requestHardware(
    {
      action: 'upload',
      portKey: useHardware.getState().portKey,
      resumeMonitor: useHardware.getState().resume,
    },
    'Program the current project firmware.',
  );
}
export function hardwareError(e: unknown) {
  useWorkspace.setState({ notice: e instanceof Error ? e.message : String(e) });
}
let initialized = false;
export function initializeHardware() {
  if (initialized || !window.trace?.hardware) return;
  initialized = true;
  window.trace.hardware.onSnapshot(receiveHardware);
  void window.trace.hardware.snapshot().then(receiveHardware).catch(hardwareError);
  void window.trace.hardware
    .syncProject(useWorkspace.getState().project)
    .then(receiveHardware)
    .catch(hardwareError);
  useWorkspace.subscribe((s, previous) => {
    if (s.project !== previous.project)
      void window.trace!.hardware.syncProject(s.project).then(receiveHardware).catch(hardwareError);
  });
}

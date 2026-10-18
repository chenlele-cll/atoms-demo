import { useEffect, useRef, useState } from 'react';
import type { ProjectDetail, Version, VersionReview } from '@atoms/contracts';
import { adoptVersion, getProject, getVersion, VersionApiError } from '../api/versions';
import { previewKey } from '../preview/state';
import type { PreviewState } from '../preview/state';
import { confirmation, initialAdoption } from './adoption';
import type { AdoptionState } from './adoption';

export function useCandidateReview(initialProject: ProjectDetail, initialReview: VersionReview, callbacks: { onProject?: (project: ProjectDetail) => void; onSelection?: (version: Version) => void; onUnauthorized?: () => void } = {}) {
  const facts = useRef(callbacks);
  const [authorized, setAuthorized] = useState(true);
  function denied(error: unknown) { if (error instanceof VersionApiError && error.status === 401) { lifecycle.current?.abort(); setAuthorized(false); facts.current.onUnauthorized?.(); return true; } return false; }
  const [project, setProject] = useState(initialProject); const [review, setReview] = useState(initialReview);
  const [view, setView] = useState<'candidate' | 'current'>('candidate'); const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [adoption, setAdoption] = useState<AdoptionState>(() => initialProject.project.currentVersionId === initialReview.version.id
    ? confirmation(initialReview.version.id, initialReview.version.id, initialReview.version.parentVersionId ?? '') : initialAdoption);
  const [refreshError, setRefreshError] = useState(''); const [refreshing, setRefreshing] = useState(false);
  const operation = useRef(false); const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifecycle.current = controller; return () => controller.abort(); }, []);
  const projectId = initialProject.project.id; const target = initialReview.version.id;
  const expected = initialReview.version.parentVersionId;
  const selected = view === 'candidate' ? review.version : project.currentVersion;
  const key = previewKey(projectId, selected.id, selected.snapshot.digest, attempt);
  const compiled = preview?.key === key && preview.status === 'compiled';
  const eligible = review.adoptionAvailability === 'eligible' && project.project.currentVersionId === expected;
  const canSubmit = view === 'candidate' && compiled && eligible && !refreshing && !['submitting', 'unknown', 'confirmed', 'conflict'].includes(adoption.status);
  const message = (error: unknown) => error instanceof VersionApiError ? error.message : '请求未能完成，请重试。';
  async function refresh(confirm = false) {
    if (operation.current) return;
    const signal = lifecycle.current?.signal; if (!signal || signal.aborted) return;
    operation.current = true;
    setRefreshing(true); setRefreshError('');
    try {
      const [current, candidate] = await Promise.all([getProject(projectId, { signal }), getVersion(projectId, target, { signal })]);
      if (signal.aborted) return;
      setProject(current); setReview(candidate);
      if (confirm || current.project.currentVersionId === target || ['unknown', 'confirmed', 'conflict'].includes(adoption.status)) {
        setAdoption(confirmation(current.project.currentVersionId, target, expected ?? ''));
      }
    } catch (error) { if (!denied(error) && !signal.aborted) setRefreshError(message(error)); }
    finally { operation.current = false; if (!signal.aborted) setRefreshing(false); }
  }
  async function submit(manualRetry = false) {
    if (operation.current || !expected || (!canSubmit && !(manualRetry && adoption.status === 'unknown' && compiled && eligible))) return;
    const signal = lifecycle.current?.signal; if (!signal || signal.aborted) return;
    operation.current = true; setAdoption({ status: 'submitting', message: '正在请求采用并确认当前版本…' });
    try {
      const saved = await adoptVersion(projectId, target, expected, { signal }); if (signal.aborted) return;
      setProject(current => ({ ...current, project: { ...current.project, currentVersionId: target, updatedAt: saved.updatedAt }, currentVersion: review.version }));
      setAdoption({ status: 'confirmed', message: '服务端已确认使用这个版本。' });
      try {
        const [current, candidate] = await Promise.all([getProject(projectId, { signal }), getVersion(projectId, target, { signal })]);
        if (signal.aborted) return;
        setProject(current); setReview(candidate); setAdoption(confirmation(current.project.currentVersionId, target, expected));
      } catch (error) { if (!denied(error) && !signal.aborted) setRefreshError('采用已确认，当前信息刷新失败。可再次刷新核对。'); }
    } catch (error) {
      if (denied(error) || signal.aborted) return;
      const known = error instanceof VersionApiError && error.kind === 'http';
      setAdoption({ status: known ? error.status === 409 ? 'conflict' : 'error' : 'unknown',
        message: known ? message(error) : '采用结果待确认，正在查询当前版本…' });
      try {
        const current = await getProject(projectId, { signal }); if (signal.aborted) return;
        setProject(current);
        if (!known || current.project.currentVersionId === target || current.project.currentVersionId !== expected) {
          setAdoption(confirmation(current.project.currentVersionId, target, expected));
        }
        const candidate = await getVersion(projectId, target, { signal }); if (!signal.aborted) setReview(candidate);
      } catch (error) { if (!denied(error) && !signal.aborted) setRefreshError('当前状态查询失败，请使用“查询采用结果”。'); }
    } finally { operation.current = false; }
  }
  function switchView(next: 'candidate' | 'current') { setPreview(null); setView(next); setAttempt(value => value + 1); }
  useEffect(() => { facts.current = callbacks; }, [callbacks]);
  useEffect(() => { if (authorized) facts.current.onProject?.(project); }, [project, authorized]);
  useEffect(() => { if (authorized) facts.current.onSelection?.(selected); }, [selected, authorized]);
  return { authorized, project, review, view, attempt, preview, adoption, refreshError, refreshing, projectId, target, expected, selected, key, compiled, eligible,
    canSubmit, refresh, submit, switchView, setPreview, setAttempt };
}

import { idSchema } from '@atoms/contracts';
export type Route = { kind: 'home' | 'template' | 'diagnostics' | 'missing'; path: string } |
  { kind: 'project'; projectId: string; path: string } | { kind: 'candidate'; projectId: string; versionId: string; path: string };
export function routeFor(path: string): Route {
  if (path === '/') return { kind: 'home', path };
  if (path === '/templates/company-landing') return { kind: 'template', path };
  if (path === '/diagnostics/connection') return { kind: 'diagnostics', path };
  const parts = path.split('/');
  if (parts[1] === 'projects' && idSchema.safeParse(parts[2]).success) {
    const projectId = parts[2]; if (projectId && parts.length === 3) return { kind: 'project', projectId, path };
    const versionId = parts[4]; if (projectId && parts[3] === 'candidates' && versionId && idSchema.safeParse(versionId).success && parts.length === 5) return { kind: 'candidate', projectId, versionId, path };
  }
  return { kind: 'missing', path };
}
export function internalClick(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

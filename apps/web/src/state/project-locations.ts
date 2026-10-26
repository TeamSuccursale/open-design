import type {
  ProjectLocation,
  ProjectLocationsResponse,
  ScanProjectLocationsResponse,
  UpdateProjectLocationsRequest,
} from '@open-design/contracts';
import { withRequestDeadline } from '../runtime/request-deadline';

export async function fetchProjectLocations(options: { signal?: AbortSignal; throwOnError?: boolean } = {}): Promise<ProjectLocation[]> {
  try {
    return await withRequestDeadline(async (signal) => {
      const resp = await fetch('/api/project-locations', { signal });
      if (!resp.ok) throw new Error('Could not load project storage locations');
      const json = (await resp.json()) as ProjectLocationsResponse;
      return Array.isArray(json.locations) ? json.locations : [];
    }, options);
  } catch (error) {
    if (options.throwOnError) throw error;
    return [];
  }
}

export async function updateProjectLocations(
  locations: UpdateProjectLocationsRequest['locations'],
): Promise<ProjectLocation[] | null> {
  try {
    const resp = await fetch('/api/project-locations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as ProjectLocationsResponse;
    return Array.isArray(json.locations) ? json.locations : [];
  } catch {
    return null;
  }
}

export async function scanProjectLocations(): Promise<ScanProjectLocationsResponse | null> {
  try {
    const resp = await fetch('/api/project-locations/scan', { method: 'POST' });
    if (!resp.ok) return null;
    return (await resp.json()) as ScanProjectLocationsResponse;
  } catch {
    return null;
  }
}

export async function openProjectLocationFolderDialog(): Promise<string | null> {
  try {
    const resp = await fetch('/api/dialog/open-folder', { method: 'POST' });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { path?: string | null };
    return typeof json.path === 'string' && json.path.trim() ? json.path : null;
  } catch {
    return null;
  }
}

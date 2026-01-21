import { useState, useEffect } from 'react';
import { Detection, AIReport, DashboardStats, CachePattern } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function fetchJson<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`);
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// Simulated "React Query" simulator hook (keeping existing interface)
export function useQuery<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    fetcher()
      .then(res => {
        if (isMounted) {
          setData(res);
          setIsLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          console.error("Fetch error:", err);
          setError(err);
          setIsLoading(false);
        }
      });
    return () => { isMounted = false; };
  }, [key]);

  return { data, isLoading, error };
}

export const api = {
  getStats: async () => {
    const res = await fetchJson<{ ok: boolean; stats: DashboardStats }>('/v1/dashboard/stats');
    return res.stats;
  },
  getDetections: async () => {
    const res = await fetchJson<{ ok: boolean; data: Detection[] }>('/v1/detections?limit=50');
    return res.data;
  },
  getReports: async () => {
    // Mapping backend response to frontend interface
    const res = await fetchJson<{ ok: boolean; data: any[] }>('/v1/ai/reports?limit=10');
    return res.data.map((r: any) => ({
      id: r.id,
      subject: r.subject || 'Sin Asunto',
      body: r.body || '',
      model_used: r.model_used || 'Unknown',
      created_at: r.created_at
    }));
  },
  getCachePatterns: async () => {
    const res = await fetchJson<{ ok: boolean; data: any[] }>('/v1/ai/cache/patterns?limit=10');
    return res.data.map((p: any) => ({
      id: p.id,
      signature: p.pattern_signature.substring(0, 8),
      threat_type: p.threat_type || p.detection_type,
      hits: parseInt(p.hit_count)
    }));
  }
};
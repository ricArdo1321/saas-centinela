import { Detection, AIReport, DashboardStats, CachePattern } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Centinela API Service
 *
 * Provides real communication with the Fastify backend.
 */
export const api = {
  /**
   * Fetch aggregated statistics for the dashboard
   */
  getStats: async (): Promise<DashboardStats> => {
    const response = await fetch(`${API_BASE_URL}/v1/dashboard/stats`);
    if (!response.ok) throw new Error('Failed to fetch dashboard stats');

    const result = await response.json();
    const s = result.stats;

    // Map backend response to frontend DashboardStats interface
    return {
      detections: {
        critical: s.detections.critical,
        total_24h: s.detections.total_24h
      },
      events: {
        processed_24h: s.events.last_24h
      },
      cache: {
        hit_rate: s.cache.hit_rate * 100, // Convert to percentage
        total_hits: s.cache.total_hits
      },
      agents: {
        healthy: s.agents.healthy
      },
    };
  },

  /**
   * Fetch list of recent detections
   */
  getDetections: async (): Promise<Detection[]> => {
    const response = await fetch(`${API_BASE_URL}/v1/detections?limit=50`);
    if (!response.ok) throw new Error('Failed to fetch detections');

    const result = await response.json();

    // Map backend Detection to frontend interface
    return result.data.map((d: any) => ({
      id: d.id,
      severity: d.severity,
      detection_type: d.detection_type,
      source_ip: d.group_key.includes('.') ? d.group_key : 'N/A', // Simple heuristic for group_key
      status: d.reported_digest_id ? 'resolved' : 'new', // Logic for status in MVP
      created_at: d.created_at,
      evidence: d.evidence || {}
    }));
  },

  /**
   * Fetch AI generated reports
   */
  getReports: async (): Promise<AIReport[]> => {
    const response = await fetch(`${API_BASE_URL}/v1/ai/reports?limit=20`);
    if (!response.ok) throw new Error('Failed to fetch AI reports');

    const result = await response.json();

    return result.data.map((r: any) => ({
      id: r.id,
      subject: r.subject,
      body: r.body,
      model_used: r.model_used,
      created_at: r.created_at
    }));
  },

  /**
   * Fetch AI knowledge cache patterns
   */
  getCachePatterns: async (): Promise<CachePattern[]> => {
    const response = await fetch(`${API_BASE_URL}/v1/ai/cache/patterns?limit=20`);
    if (!response.ok) throw new Error('Failed to fetch cache patterns');

    const result = await response.json();

    return result.data.map((p: any) => ({
      id: p.id,
      signature: p.pattern_signature,
      threat_type: p.threat_type || p.detection_type,
      hits: p.hit_count
    }));
  },

  /**
   * Get full details for a specific detection including AI analysis
   */
  getDetectionDetails: async (id: string) => {
    const response = await fetch(`${API_BASE_URL}/v1/detections/${id}`);
    if (!response.ok) throw new Error('Failed to fetch detection details');
    return await response.json();
  }
};

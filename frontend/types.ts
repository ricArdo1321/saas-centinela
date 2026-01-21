export interface Detection {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detection_type: string;
  source_ip: string;
  status: 'new' | 'investigating' | 'resolved';
  created_at: string;
  evidence: Record<string, any>;
}

export interface AIReport {
  id: string;
  subject: string;
  body: string; // markdown content
  model_used: string;
  created_at: string;
}

export interface DashboardStats {
  detections: { critical: number; total_24h: number };
  events: { processed_24h: number };
  cache: { hit_rate: number; total_hits: number };
  agents: { healthy: boolean };
}

export interface CachePattern {
  id: string;
  signature: string;
  threat_type: string;
  hits: number;
}

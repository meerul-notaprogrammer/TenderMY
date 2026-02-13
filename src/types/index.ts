/**
 * Core types for tender scraper system
 */

export interface Tender {
  bil: number;
  tarikh: string; // YYYY-MM-DD
  daftar: string;
  bidang: string;
  kod_bidang: string; // 6-digit code
  keterangan: string;
  status: 'Aktif' | 'Tidak Aktif';
}

export interface ExtractionResult {
  tender: Partial<Tender>;
  confidence: {
    overall: number; // 0-1
    per_field: Record<string, number>;
  };
  warnings: string[];
  errors: string[];
  raw_gemini_response?: string;
}

export interface TrainingExample {
  id: string;
  pdf_url: string;
  pdf_path: string;
  screenshot_path?: string;
  gemini_extraction: ExtractionResult;
  manual_validation?: Tender; // Ground truth after manual review
  confidence_score: number;
  is_validated: boolean;
  created_at: Date;
  improved_at?: Date;
  learning_iteration: number;
}

export interface LearningSession {
  id: string;
  started_at: Date;
  examples_collected: number;
  validation_accuracy: number;
  status: 'in_progress' | 'completed' | 'paused';
  iterations: LearningIteration[];
}

export interface LearningIteration {
  iteration_number: number;
  examples_processed: number;
  accuracy_before: number;
  accuracy_after: number;
  improvements: string[];
  timestamp: Date;
}

export interface WebsiteBehavior {
  total_pages: number;
  pagination_pattern: string; // URL pattern with {page} placeholder
  filters_available: string[];
  content_loading_time_ms: number;
  table_structure: {
    rows_per_page: number;
    columns: string[];
    has_dynamic_content: boolean;
  };
  observed_at: Date;
}

export interface ScrapingMetrics {
  total_tenders_found: number;
  successfully_extracted: number;
  failed_extractions: number;
  average_confidence: number;
  extraction_accuracy: number;
  processing_time_ms: number;
  timestamp: Date;
}

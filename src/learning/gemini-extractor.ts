/**
 * PHASE 3: GEMINI VISION EXTRACTION
 * This module handles:
 * - PDF to Gemini Vision API
 * - Data extraction with confidence scoring
 * - Iterative prompt refinement
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import logger from '../utils/logger.js';
import { ExtractionResult, Tender } from '../types/index.js';
import {
  validateTender,
  normalizeDate,
  cleanText,
  isValidKodBidang,
  isValidStatus,
  calculateFieldConfidence,
} from '../utils/validation.js';

export class GeminiExtractor {
  private client: GoogleGenerativeAI;
  private model: any;
  private extractionPrompt: string;
  private iteration: number = 0;

  constructor(apiKey: string = process.env.GEMINI_API_KEY || '') {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not provided');
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({ model: 'gemini-1.5-flash' });
    this.extractionPrompt = this.getDefaultPrompt();
  }

  /**
   * Default extraction prompt
   */
  private getDefaultPrompt(): string {
    return `Extract tender information from this Malaysian government website screenshot/PDF.

REQUIRED FIELDS (extract exactly as shown):
1. BIL - Item number (integer)
2. TARIKH - Date in DD/MM/YYYY format
3. DAFTAR - Registration/Reference code
4. BIDANG - Category/Field description (full text)
5. KOD BIDANG - Code (6-digit number, e.g., 010302)
6. KETERANGAN - Description (full text)
7. STATUS - Status (either "Aktif" or "Tidak Aktif")

CRITICAL RULES:
- Extract EVERY visible row/entry from the table
- Preserve original Malay text exactly
- For dates: convert to DD/MM/YYYY format
- For codes: must be exactly 6 digits
- Do NOT invent or guess missing data
- If a field is unclear or missing, return null for that field
- Return as JSON array with objects for each tender

OUTPUT FORMAT:
Return ONLY valid JSON array. NO explanations.
[
  {
    "bil": 1,
    "tarikh": "03/07/2024",
    "daftar": "010302",
    "bidang": "PENERBITAN DAN PENYIARAN/ PERALATAN PENERBITAN/PERCETAKAN",
    "kod_bidang": "010302",
    "keterangan": "Full description",
    "status": "Aktif"
  },
  ...
]

If extraction fails or data is unclear, return: []
`;
  }

  /**
   * Update prompt based on learning
   */
  updatePrompt(newPrompt: string): void {
    this.extractionPrompt = newPrompt;
    this.iteration++;
    logger.info('Extraction prompt updated', { iteration: this.iteration });
  }

  /**
   * Extract data from PDF
   */
  async extractFromPDF(pdfPath: string): Promise<ExtractionResult[]> {
    try {
      logger.info('Extracting data from PDF', { path: pdfPath });

      // Read PDF file
      const pdfBuffer = await fs.readFile(pdfPath);
      const base64Pdf = pdfBuffer.toString('base64');

      // Call Gemini Vision API
      const response = await this.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: this.extractionPrompt },
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: base64Pdf,
                },
              },
            ],
          },
        ],
      });

      const responseText = response.response.text();
      logger.info('Gemini response received', {
        length: responseText.length,
      });

      // Parse JSON response
      return this.parseGeminiResponse(responseText);
    } catch (error) {
      logger.error('PDF extraction failed', { error });
      throw error;
    }
  }

  /**
   * Parse and validate Gemini response
   */
  private parseGeminiResponse(responseText: string): ExtractionResult[] {
    try {
      // Extract JSON from response (handle cases where Gemini returns text before/after JSON)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('No JSON found in response', { response: responseText.substring(0, 200) });
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed)) {
        logger.warn('Response is not an array');
        return [];
      }

      return parsed.map((item) => this.validateAndScoreTender(item));
    } catch (error) {
      logger.error('JSON parsing failed', { error });
      return [];
    }
  }

  /**
   * Validate and score individual tender
   */
  private validateAndScoreTender(data: any): ExtractionResult {
    const extraction: Partial<Tender> = {};
    const perFieldConfidence: Record<string, number> = {};
    const warnings: string[] = [];
    const errors: string[] = [];

    // Validate BIL
    if (typeof data.bil === 'number' && data.bil > 0) {
      extraction.bil = data.bil;
      perFieldConfidence.bil = 1;
    } else {
      perFieldConfidence.bil = 0;
      errors.push('Invalid BIL');
    }

    // Validate TARIKH
    const normalizedDate = normalizeDate(data.tarikh || '');
    if (normalizedDate) {
      extraction.tarikh = normalizedDate;
      perFieldConfidence.tarikh = 1;
    } else {
      perFieldConfidence.tarikh = 0;
      errors.push(`Invalid date format: ${data.tarikh}`);
    }

    // Validate DAFTAR
    if (data.daftar && typeof data.daftar === 'string') {
      extraction.daftar = cleanText(data.daftar);
      perFieldConfidence.daftar = 0.9; // Slight uncertainty due to possible variations
    } else {
      perFieldConfidence.daftar = 0;
      errors.push('Missing DAFTAR');
    }

    // Validate BIDANG
    if (data.bidang && typeof data.bidang === 'string' && data.bidang.length > 5) {
      extraction.bidang = cleanText(data.bidang);
      perFieldConfidence.bidang = 0.95;
    } else {
      perFieldConfidence.bidang = 0;
      errors.push('Invalid BIDANG');
    }

    // Validate KOD BIDANG (critical field)
    if (isValidKodBidang(data.kod_bidang)) {
      extraction.kod_bidang = data.kod_bidang;
      perFieldConfidence.kod_bidang = 1;
    } else {
      perFieldConfidence.kod_bidang = 0;
      errors.push(`Invalid KOD BIDANG format: ${data.kod_bidang}`);
    }

    // Validate KETERANGAN
    if (data.keterangan && typeof data.keterangan === 'string' && data.keterangan.length > 5) {
      extraction.keterangan = cleanText(data.keterangan);
      perFieldConfidence.keterangan = 0.9;
    } else {
      perFieldConfidence.keterangan = 0;
      errors.push('Invalid KETERANGAN');
    }

    // Validate STATUS
    if (isValidStatus(data.status)) {
      extraction.status = data.status;
      perFieldConfidence.status = 1;
    } else {
      perFieldConfidence.status = 0;
      errors.push(`Invalid STATUS: ${data.status}`);
    }

    // Calculate overall confidence
    const confidenceValues = Object.values(perFieldConfidence);
    const overallConfidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((a, b) => a + b) / confidenceValues.length
        : 0;

    if (errors.length > 0) {
      warnings.push(`Extraction had ${errors.length} validation errors`);
    }

    return {
      tender: extraction,
      confidence: {
        overall: parseFloat(overallConfidence.toFixed(3)),
        per_field: perFieldConfidence,
      },
      warnings,
      errors,
      raw_gemini_response: JSON.stringify(data),
    };
  }

  /**
   * Refine extraction based on manual validation
   */
  async refineWithValidation(
    originalExtraction: ExtractionResult,
    validatedData: Tender
  ): Promise<{
    improved_confidence: number;
    field_improvements: Record<string, number>;
  }> {
    const improvements: Record<string, number> = {};

    // Calculate field-by-field confidence improvements
    const fields: (keyof Tender)[] = ['bil', 'tarikh', 'daftar', 'bidang', 'kod_bidang', 'keterangan', 'status'];

    for (const field of fields) {
      const extractedValue = originalExtraction.tender[field];
      const validatedValue = validatedData[field];

      const confidence = calculateFieldConfidence(extractedValue, validatedValue);
      improvements[field] = confidence;
    }

    const avgImprovement = Object.values(improvements).reduce((a, b) => a + b) / Object.values(improvements).length;

    logger.info('Extraction refined with validation', {
      original_confidence: originalExtraction.confidence.overall,
      improved_confidence: avgImprovement,
      field_improvements: improvements,
    });

    return {
      improved_confidence: avgImprovement,
      field_improvements: improvements,
    };
  }
}

export default GeminiExtractor;

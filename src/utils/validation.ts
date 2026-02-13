import { z } from 'zod';
import logger from './logger.js';

// Schema for tender validation
export const tenderSchema = z.object({
  bil: z.number().int().positive('BIL must be positive integer'),
  tarikh: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  daftar: z.string().min(1, 'Daftar cannot be empty'),
  bidang: z.string().min(5, 'Bidang must be at least 5 characters'),
  kod_bidang: z
    .string()
    .regex(/^\d{6}$/, 'Kod Bidang must be exactly 6 digits'),
  keterangan: z.string().min(10, 'Keterangan must be at least 10 characters'),
  status: z.enum(['Aktif', 'Tidak Aktif']),
});

export type TenderSchemaType = z.infer<typeof tenderSchema>;

/**
 * Validate tender data
 */
export function validateTender(data: unknown) {
  try {
    return {
      success: true,
      data: tenderSchema.parse(data),
      errors: [],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      logger.warn('Tender validation failed', { errors });
      return {
        success: false,
        data: null,
        errors,
      };
    }
    throw error;
  }
}

/**
 * Normalize date to YYYY-MM-DD format
 */
export function normalizeDate(dateStr: string): string | null {
  try {
    // Try DD/MM/YYYY format
    const ddmmyyMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyMatch) {
      const [, day, month, year] = ddmmyyMatch;
      return `${year}-${month}-${day}`;
    }

    // Try DD-MM-YYYY format
    const ddmmyy2Match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyy2Match) {
      const [, day, month, year] = ddmmyy2Match;
      return `${year}-${month}-${day}`;
    }

    // Try YYYY-MM-DD (already correct)
    const yyyymmddMatch = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
    if (yyyymmddMatch) {
      return dateStr;
    }

    return null;
  } catch (error) {
    logger.error('Date normalization failed', { dateStr, error });
    return null;
  }
}

/**
 * Clean and normalize text
 */
export function cleanText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ');
}

/**
 * Validate Kod Bidang format
 */
export function isValidKodBidang(kod: string): boolean {
  return /^\d{6}$/.test(kod);
}

/**
 * Check if status is valid
 */
export function isValidStatus(status: string): boolean {
  return ['Aktif', 'Tidak Aktif'].includes(status);
}

/**
 * Calculate field-level confidence
 */
export function calculateFieldConfidence(
  extracted: unknown,
  validated: unknown
): number {
  if (extracted === null || validated === null) return 0;
  if (extracted === validated) return 1;
  
  // For strings, use similarity ratio
  const str1 = String(extracted).toLowerCase();
  const str2 = String(validated).toLowerCase();
  
  if (str1 === str2) return 1;
  
  // Levenshtein similarity
  const similarity = 1 - levenshteinDistance(str1, str2) / Math.max(str1.length, str2.length);
  return Math.max(0, similarity);
}

/**
 * Levenshtein distance for string comparison
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * CONTINUOUS TRAINING LOOP
 * Improves extraction accuracy iteration by iteration
 * Run this after each validation phase to improve results
 */

import 'dotenv/config';
import logger from './utils/logger.js';
import TrainingDataManager from './learning/training-manager.js';
import GeminiExtractor from './learning/gemini-extractor.js';
import PDFCapture from './learning/pdf-capture.js';

class ContinuousTrainer {
  private trainingManager: TrainingDataManager;
  private extractor: GeminiExtractor;
  private pdfCapture: PDFCapture;
  private iteration: number = 0;

  constructor() {
    this.trainingManager = new TrainingDataManager();
    this.extractor = new GeminiExtractor();
    this.pdfCapture = new PDFCapture();
  }

  /**
   * Main training loop
   */
  async train(): Promise<void> {
    try {
      logger.info('Starting Continuous Training...');
      await this.trainingManager.initialize();

      // Get current accuracy
      const currentAccuracy = await this.trainingManager.calculateAccuracy();
      logger.info(`Current Extraction Accuracy: ${currentAccuracy}%`);

      // Get validated examples to analyze failures
      const validated = await this.trainingManager.getValidatedExamples();

      if (validated.length === 0) {
        console.log('No validated examples found. Run learn.ts first.');
        return;
      }

      this.iteration = Math.max(
        ...validated.map((e) => e.learning_iteration),
        0
      ) + 1;

      logger.info(`Starting iteration ${this.iteration}`);

      // Analyze failures
      const failures = this.analyzeFailures(validated);
      logger.info(`Found ${failures.length} failed extractions`);

      if (failures.length === 0) {
        console.log('✓ All extractions are accurate! No improvements needed.');
        return;
      }

      // Generate improved prompt based on failures
      const improvedPrompt = this.generateImprovedPrompt(failures);
      this.extractor.updatePrompt(improvedPrompt);

      console.log('\n=== IMPROVED EXTRACTION PROMPT ===');
      console.log(improvedPrompt);
      console.log('\n');

      // Re-extract failed examples with improved prompt
      logger.info('Re-extracting failed examples with improved prompt...');
      let reprocessedCount = 0;
      let improvementCount = 0;

      for (const failedExample of failures.slice(0, 10)) {
        // Reprocess top 10 failures
        try {
          const reextractions = await this.extractor.extractFromPDF(
            failedExample.pdf_path
          );

          if (reextractions.length > 0) {
            const newConfidence = reextractions[0].confidence.overall;
            const oldConfidence = failedExample.confidence_score;

            if (newConfidence > oldConfidence) {
              improvementCount++;
              logger.info(
                `Improvement: ${oldConfidence.toFixed(3)} → ${newConfidence.toFixed(3)}`
              );
            }

            reprocessedCount++;
          }
        } catch (error) {
          logger.error(`Failed to reprocess example`, { error });
        }
      }

      // Create iteration record
      const iterationRecord: any = {
        iteration_number: this.iteration,
        examples_processed: validated.length,
        accuracy_before: currentAccuracy,
        accuracy_after: await this.trainingManager.calculateAccuracy(),
        improvements: [
          `Improved prompt based on ${failures.length} failures`,
          `Reprocessed ${reprocessedCount} examples with ${improvementCount} showing improvement`,
        ],
        timestamp: new Date(),
      };

      const sessions = await this.trainingManager.getSessions();
      if (sessions.length > 0) {
        const lastSession = sessions[sessions.length - 1];
        await this.trainingManager.addIteration(lastSession.id, iterationRecord);
      }

      // Generate new report
      console.log('\n=== TRAINING RESULTS ===');
      console.log(`Iteration: ${this.iteration}`);
      console.log(`Accuracy Before: ${iterationRecord.accuracy_before}%`);
      console.log(`Accuracy After: ${iterationRecord.accuracy_after}%`);
      console.log(
        `Improvement: ${(iterationRecord.accuracy_after - iterationRecord.accuracy_before).toFixed(2)}%`
      );

      if (iterationRecord.accuracy_after >= 95) {
        console.log('\n✓ Target accuracy (95%) achieved!');
      } else {
        console.log(`\nRun train.ts again to continue improving (Target: 95%)`);
      }

      await this.trainingManager.generateReport();
    } catch (error) {
      logger.error('Training failed', { error });
      throw error;
    }
  }

  /**
   * Analyze which extractions failed
   */
  private analyzeFailures(
    validated: any[]
  ): any[] {
    const failures = [];

    for (const example of validated) {
      if (!example.manual_validation) continue;

      const extracted = example.gemini_extraction.tender;
      const validated_ = example.manual_validation;

      // Check critical fields
      const criticalFieldsMismatch =
        extracted.bil !== validated_.bil ||
        extracted.kod_bidang !== validated_.kod_bidang ||
        extracted.status !== validated_.status;

      if (criticalFieldsMismatch) {
        failures.push({
          ...example,
          field_mismatches: {
            bil: extracted.bil !== validated_.bil,
            kod_bidang: extracted.kod_bidang !== validated_.kod_bidang,
            status: extracted.status !== validated_.status,
            tarikh: extracted.tarikh !== validated_.tarikh,
            bidang: extracted.bidang !== validated_.bidang,
          },
        });
      }
    }

    return failures;
  }

  /**
   * Generate improved extraction prompt based on failures
   */
  private generateImprovedPrompt(failures: any[]): string {
    const failurePatterns = this.identifyFailurePatterns(failures);

    let improvedPrompt = `Extract tender information from this Malaysian government website screenshot/PDF.

REQUIRED FIELDS (extract exactly as shown):
1. BIL - Item number (integer, e.g., 1, 2, 3)
2. TARIKH - Date in DD/MM/YYYY format (e.g., 03/07/2024)
3. DAFTAR - Registration/Reference code
4. BIDANG - Category/Field description (FULL TEXT - preserve all details)
5. KOD BIDANG - Code (exactly 6 digits, e.g., 010302)
6. KETERANGAN - Description (FULL TEXT - include all details)
7. STATUS - Status (must be exactly "Aktif" or "Tidak Aktif")

CRITICAL RULES:
`;

    if (failurePatterns.includes('code_format')) {
      improvedPrompt += `
- KOD BIDANG MUST be exactly 6 numeric digits. Verify twice.
- Do not include spaces, dashes, or special characters in codes.`;
    }

    if (failurePatterns.includes('status_format')) {
      improvedPrompt += `
- STATUS field is critical: Must be EXACTLY "Aktif" or "Tidak Aktif" (case-sensitive).
- Do not include extra text, numbers, or symbols.`;
    }

    if (failurePatterns.includes('text_content')) {
      improvedPrompt += `
- BIDANG and KETERANGAN contain full Malay descriptions.
- Preserve all text exactly as shown, including all special characters.
- Do not shorten or modify descriptions.`;
    }

    if (failurePatterns.includes('date_format')) {
      improvedPrompt += `
- TARIKH (date) must be in DD/MM/YYYY format (e.g., 03/07/2024).
- Convert from any other format if needed.`;
    }

    improvedPrompt += `

OUTPUT FORMAT:
Return ONLY valid JSON array. NO other text.
[
  {
    "bil": 1,
    "tarikh": "03/07/2024",
    "daftar": "code",
    "bidang": "Full description text",
    "kod_bidang": "010302",
    "keterangan": "Full description text",
    "status": "Aktif"
  }
]

If NO data found or extraction fails: return []
`;

    return improvedPrompt;
  }

  /**
   * Identify patterns in failures
   */
  private identifyFailurePatterns(failures: any[]): string[] {
    const patterns: Set<string> = new Set();

    for (const failure of failures) {
      const mismatches = failure.field_mismatches;

      if (mismatches.kod_bidang) patterns.add('code_format');
      if (mismatches.status) patterns.add('status_format');
      if (mismatches.bidang || mismatches.keterangan) patterns.add('text_content');
      if (mismatches.tarikh) patterns.add('date_format');
    }

    return Array.from(patterns);
  }
}

// Run trainer
const trainer = new ContinuousTrainer();
trainer.train().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});

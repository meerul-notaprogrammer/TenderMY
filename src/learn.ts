/**
 * MASTER LEARNING ORCHESTRATOR
 * Coordinates all learning phases to progressively improve extraction accuracy
 */

import 'dotenv/config';
import logger from './utils/logger.js';
import WebsiteBehaviorLearner from './learning/website-behavior.js';
import PDFCapture from './learning/pdf-capture.js';
import GeminiExtractor from './learning/gemini-extractor.js';
import TrainingDataManager from './learning/training-manager.js';
import { Tender } from './types/index.js';
import * as readline from 'readline';

class LearningOrchestrator {
  private websiteLearner: WebsiteBehaviorLearner;
  private pdfCapture: PDFCapture;
  private extractor: GeminiExtractor;
  private trainingManager: TrainingDataManager;
  private rl: readline.Interface;

  constructor() {
    this.websiteLearner = new WebsiteBehaviorLearner();
    this.pdfCapture = new PDFCapture();
    this.extractor = new GeminiExtractor();
    this.trainingManager = new TrainingDataManager();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Main learning flow
   */
  async learnAndImprove(): Promise<void> {
    try {
      logger.info('Starting Learning Orchestrator...');

      // Phase 1: Learn website behavior
      logger.info('PHASE 1: LEARNING WEBSITE BEHAVIOR');
      const behavior = await this.websiteLearner.learn();
      logger.info('Website behavior learned', {
        pages: behavior.total_pages,
        columns: behavior.table_structure?.columns,
      });

      // Phase 2: Initialize storage
      logger.info('PHASE 2: INITIALIZING STORAGE');
      await this.pdfCapture.initialize();
      await this.trainingManager.initialize();

      // Phase 3: Capture PDFs
      logger.info('PHASE 3: CAPTURING PDFs FROM WEBSITE');
      await this.pdfCapture.launchBrowser();

      const pagesToCapture = Math.min(
        behavior.total_pages,
        parseInt(process.env.BATCH_SIZE || '10')
      );

      const captures = await this.pdfCapture.captureMultiplePages(
        process.env.GOV_WEBSITE_URL || '',
        pagesToCapture,
        behavior.pagination_pattern
      );

      logger.info(`Captured ${captures.length} PDFs`);

      // Phase 4: Extract data from PDFs
      logger.info('PHASE 4: EXTRACTING DATA WITH GEMINI');
      const session = await this.trainingManager.createSession();
      let iteration = 1;

      let cumulativeAccuracy = 0;
      const allExtractions = [];

      for (const capture of captures) {
        try {
          const extractions = await this.extractor.extractFromPDF(capture.pdf_path);
          allExtractions.push(...extractions);

          // Save training examples
          await this.trainingManager.saveTrainingExample(
            capture.pdf_path,
            capture.url,
            extractions,
            iteration
          );

          logger.info(`Extracted from PDF`, {
            page: capture.page_number,
            tenders_found: extractions.length,
            avg_confidence: (
              extractions.reduce((sum, e) => sum + e.confidence.overall, 0) /
              extractions.length
            ).toFixed(3),
          });
        } catch (error) {
          logger.error(`Failed to extract from PDF`, {
            page: capture.page_number,
            error,
          });
        }
      }

      // Phase 5: Manual validation loop
      logger.info('PHASE 5: MANUAL VALIDATION & ITERATIVE IMPROVEMENT');
      await this.manualValidationLoop(session.id, iteration);

      // Phase 6: Calculate improvements and generate report
      const accuracy = await this.trainingManager.calculateAccuracy();
      logger.info(`Accuracy after iteration ${iteration}: ${accuracy}%`);

      // Save metrics
      await this.trainingManager.saveMetrics({
        total_tenders_found: allExtractions.length,
        successfully_extracted: allExtractions.filter(
          (e) => e.confidence.overall > 0.85
        ).length,
        failed_extractions: allExtractions.filter(
          (e) => e.confidence.overall <= 0.85
        ).length,
        average_confidence: parseFloat(
          (
            allExtractions.reduce((sum, e) => sum + e.confidence.overall, 0) /
            allExtractions.length
          ).toFixed(3)
        ),
        extraction_accuracy: accuracy,
        processing_time_ms: 0,
        timestamp: new Date(),
      });

      // Generate report
      await this.trainingManager.generateReport();

      logger.info('Learning phase complete. Ready for next iteration!');
    } catch (error) {
      logger.error('Learning orchestrator failed', { error });
      throw error;
    } finally {
      await this.pdfCapture.close();
      this.rl.close();
    }
  }

  /**
   * Manual validation loop - user validates extracted data
   */
  private async manualValidationLoop(sessionId: string, iteration: number): Promise<void> {
    const unvalidated = await this.trainingManager.getUnvalidatedExamples();

    if (unvalidated.length === 0) {
      logger.info('No unvalidated examples');
      return;
    }

    logger.info(`Found ${unvalidated.length} examples requiring validation`);
    console.log('\n=== MANUAL VALIDATION ===');
    console.log(`You have ${unvalidated.length} extractions to validate`);
    console.log('For each, review the extracted data and provide corrections if needed.\n');

    for (let i = 0; i < Math.min(unvalidated.length, 5); i++) {
      const example = unvalidated[i];

      console.log(`\n--- Example ${i + 1} of ${Math.min(unvalidated.length, 5)} ---`);
      console.log('EXTRACTED DATA:');
      console.log(JSON.stringify(example.gemini_extraction.tender, null, 2));
      console.log('CONFIDENCE:', example.gemini_extraction.confidence.overall);

      const validated = await this.promptForValidation();

      if (validated) {
        try {
          await this.trainingManager.validateExample(example.id, validated);
          logger.info('Example validated and saved', { id: example.id });
        } catch (error) {
          logger.error('Failed to save validation', { error });
        }
      }
    }
  }

  /**
   * Prompt user to validate tender data
   */
  private promptForValidation(): Promise<Tender | null> {
    return new Promise((resolve) => {
      this.rl.question(
        'Is this correct? (y/n/edit): ',
        async (answer) => {
          if (answer.toLowerCase() === 'y') {
            resolve(null); // Keep extracted as-is
          } else if (answer.toLowerCase() === 'edit') {
            const edited = await this.promptForManualEdit();
            resolve(edited);
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Allow user to manually edit tender data
   */
  private promptForManualEdit(): Promise<Tender | null> {
    return new Promise((resolve) => {
      const tender: Partial<Tender> = {};

      const prompts = [
        'BIL (number): ',
        'TARIKH (YYYY-MM-DD): ',
        'DAFTAR: ',
        'BIDANG: ',
        'KOD BIDANG (6 digits): ',
        'KETERANGAN: ',
        'STATUS (Aktif/Tidak Aktif): ',
      ];

      const keys: (keyof Tender)[] = [
        'bil',
        'tarikh',
        'daftar',
        'bidang',
        'kod_bidang',
        'keterangan',
        'status',
      ];

      let index = 0;

      const askNext = () => {
        if (index >= prompts.length) {
          resolve(tender as Tender);
          return;
        }

        this.rl.question(prompts[index], (answer) => {
          if (answer.trim()) {
            const key = keys[index];
            if (key === 'bil') {
              tender[key] = parseInt(answer);
            } else {
              tender[key] = answer.trim() as any;
            }
          }
          index++;
          askNext();
        });
      };

      askNext();
    });
  }
}

// Run orchestrator
const orchestrator = new LearningOrchestrator();
orchestrator.learnAndImprove().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});

/**
 * VALIDATION ANALYSIS
 * Analyzes extraction quality and identifies improvement areas
 */

import 'dotenv/config';
import logger from './utils/logger.js';
import TrainingDataManager from './learning/training-manager.js';
import { ExtractionResult, Tender } from './types/index.js';

class ValidationAnalyzer {
  private trainingManager: TrainingDataManager;

  constructor() {
    this.trainingManager = new TrainingDataManager();
  }

  /**
   * Analyze all validations and identify patterns
   */
  async analyzeValidations(): Promise<void> {
    try {
      await this.trainingManager.initialize();

      const validated = await this.trainingManager.getValidatedExamples();

      if (validated.length === 0) {
        console.log('No validated examples found. Run learn.ts first.');
        return;
      }

      console.log('\n=== VALIDATION ANALYSIS ===\n');

      // Field-by-field analysis
      const fieldErrors: Record<string, number> = {
        bil: 0,
        tarikh: 0,
        daftar: 0,
        bidang: 0,
        kod_bidang: 0,
        keterangan: 0,
        status: 0,
      };

      const errorDetails: Record<string, string[]> = {
        bil: [],
        tarikh: [],
        daftar: [],
        bidang: [],
        kod_bidang: [],
        keterangan: [],
        status: [],
      };

      let perfectExtractions = 0;

      for (const example of validated) {
        if (!example.manual_validation) continue;

        const extracted = example.gemini_extraction.tender;
        const validated_ = example.manual_validation;

        let fieldsMismatched = false;

        // Check each field
        const fields: (keyof Tender)[] = [
          'bil',
          'tarikh',
          'daftar',
          'bidang',
          'kod_bidang',
          'keterangan',
          'status',
        ];

        for (const field of fields) {
          if (extracted[field] !== validated_[field]) {
            fieldErrors[field]++;
            fieldsMismatched = true;
            errorDetails[field].push(
              `Expected: ${validated_[field]}, Got: ${extracted[field]}`
            );
          }
        }

        if (!fieldsMismatched) {
          perfectExtractions++;
        }
      }

      // Print analysis
      console.log(`Total Validated: ${validated.length}`);
      console.log(`Perfect Extractions: ${perfectExtractions} (${((perfectExtractions / validated.length) * 100).toFixed(2)}%)\n`);

      console.log('Field Error Rates:');
      console.log('---');
      for (const [field, errors] of Object.entries(fieldErrors)) {
        const errorRate = ((errors / validated.length) * 100).toFixed(2);
        const status = errors === 0 ? '✓' : '✗';
        console.log(`${status} ${field.padEnd(15)} : ${errorRate}% errors (${errors}/${validated.length})`);

        if (errors > 0 && errorDetails[field].length > 0) {
          console.log(`   Examples:`);
          errorDetails[field].slice(0, 2).forEach((detail) => {
            console.log(`   - ${detail}`);
          });
        }
      }

      // Calculate accuracy
      const accuracy = await this.trainingManager.calculateAccuracy();
      console.log(`\nOverall Extraction Accuracy: ${accuracy}%`);

      if (accuracy < 95) {
        console.log('\n⚠️ RECOMMENDATIONS:');
        console.log('- Fields with >5% error rate need improvement');
        console.log('- Consider refining Gemini extraction prompt');
        console.log('- Add more training examples with manual corrections');
        console.log('- Run learn.ts again for next iteration');
      } else {
        console.log('\n✓ Extraction quality is excellent!');
      }

      // Generate full report
      await this.trainingManager.generateReport();
    } catch (error) {
      logger.error('Validation analysis failed', { error });
    }
  }
}

// Run analyzer
const analyzer = new ValidationAnalyzer();
analyzer.analyzeValidations().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});

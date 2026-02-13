/**
 * PHASE 4: TRAINING DATA MANAGEMENT
 * This module handles:
 * - Storage and retrieval of training examples
 * - Manual validation tracking
 * - Learning iteration management
 * - Performance metrics
 */

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import {
  TrainingExample,
  LearningSession,
  LearningIteration,
  ExtractionResult,
  Tender,
  ScrapingMetrics,
} from '../types/index.js';

export class TrainingDataManager {
  private trainingDir: string;
  private metricsFile: string;
  private sessionsFile: string;

  constructor(trainingDir: string = process.env.TRAINING_DATA_DIR || './training_data') {
    this.trainingDir = trainingDir;
    this.metricsFile = path.join(trainingDir, 'metrics.json');
    this.sessionsFile = path.join(trainingDir, 'sessions.json');
  }

  /**
   * Initialize training data directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(path.join(this.trainingDir, 'examples'), { recursive: true });
      await fs.mkdir(path.join(this.trainingDir, 'validations'), { recursive: true });
      await fs.mkdir(path.join(this.trainingDir, 'iterations'), { recursive: true });

      // Create metrics file if doesn't exist
      try {
        await fs.access(this.metricsFile);
      } catch {
        await fs.writeFile(this.metricsFile, JSON.stringify([], null, 2));
      }

      // Create sessions file if doesn't exist
      try {
        await fs.access(this.sessionsFile);
      } catch {
        await fs.writeFile(this.sessionsFile, JSON.stringify([], null, 2));
      }

      logger.info('Training data manager initialized', { dir: this.trainingDir });
    } catch (error) {
      logger.error('Failed to initialize training data', { error });
      throw error;
    }
  }

  /**
   * Save training example
   */
  async saveTrainingExample(
    pdfPath: string,
    pdfUrl: string,
    extraction: ExtractionResult[],
    iteration: number
  ): Promise<TrainingExample[]> {
    const examples: TrainingExample[] = [];

    for (let i = 0; i < extraction.length; i++) {
      const exampleId = uuidv4();
      const example: TrainingExample = {
        id: exampleId,
        pdf_url: pdfUrl,
        pdf_path: pdfPath,
        gemini_extraction: extraction[i],
        confidence_score: extraction[i].confidence.overall,
        is_validated: false,
        created_at: new Date(),
        learning_iteration: iteration,
      };

      const exampleFile = path.join(this.trainingDir, 'examples', `${exampleId}.json`);
      await fs.writeFile(exampleFile, JSON.stringify(example, null, 2));

      examples.push(example);
      logger.info('Training example saved', { id: exampleId });
    }

    return examples;
  }

  /**
   * Save manual validation for example
   */
  async validateExample(
    exampleId: string,
    validatedTender: Tender
  ): Promise<TrainingExample> {
    const exampleFile = path.join(this.trainingDir, 'examples', `${exampleId}.json`);

    const content = await fs.readFile(exampleFile, 'utf-8');
    const example: TrainingExample = JSON.parse(content);

    example.manual_validation = validatedTender;
    example.is_validated = true;
    example.improved_at = new Date();

    await fs.writeFile(exampleFile, JSON.stringify(example, null, 2));

    // Save validation separately for analysis
    const validationFile = path.join(
      this.trainingDir,
      'validations',
      `${exampleId}_validation.json`
    );
    await fs.writeFile(validationFile, JSON.stringify(validatedTender, null, 2));

    logger.info('Example validated', { id: exampleId });
    return example;
  }

  /**
   * Get all unvalidated examples
   */
  async getUnvalidatedExamples(): Promise<TrainingExample[]> {
    try {
      const examplesDir = path.join(this.trainingDir, 'examples');
      const files = await fs.readdir(examplesDir);

      const examples: TrainingExample[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const content = await fs.readFile(path.join(examplesDir, file), 'utf-8');
        const example: TrainingExample = JSON.parse(content);

        if (!example.is_validated) {
          examples.push(example);
        }
      }

      return examples;
    } catch (error) {
      logger.error('Failed to get unvalidated examples', { error });
      return [];
    }
  }

  /**
   * Get all validated examples for current iteration
   */
  async getValidatedExamples(iteration?: number): Promise<TrainingExample[]> {
    try {
      const examplesDir = path.join(this.trainingDir, 'examples');
      const files = await fs.readdir(examplesDir);

      const examples: TrainingExample[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const content = await fs.readFile(path.join(examplesDir, file), 'utf-8');
        const example: TrainingExample = JSON.parse(content);

        if (example.is_validated && (!iteration || example.learning_iteration === iteration)) {
          examples.push(example);
        }
      }

      return examples.sort((a, b) => a.learning_iteration - b.learning_iteration);
    } catch (error) {
      logger.error('Failed to get validated examples', { error });
      return [];
    }
  }

  /**
   * Create new learning session
   */
  async createSession(): Promise<LearningSession> {
    const session: LearningSession = {
      id: uuidv4(),
      started_at: new Date(),
      examples_collected: 0,
      validation_accuracy: 0,
      status: 'in_progress',
      iterations: [],
    };

    const sessions = await this.getSessions();
    sessions.push(session);

    await fs.writeFile(this.sessionsFile, JSON.stringify(sessions, null, 2));
    logger.info('Learning session created', { id: session.id });

    return session;
  }

  /**
   * Get all learning sessions
   */
  async getSessions(): Promise<LearningSession[]> {
    try {
      const content = await fs.readFile(this.sessionsFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Add iteration to session
   */
  async addIteration(
    sessionId: string,
    iteration: LearningIteration
  ): Promise<LearningSession> {
    const sessions = await this.getSessions();
    const session = sessions.find((s) => s.id === sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.iterations.push(iteration);
    session.validation_accuracy = iteration.accuracy_after;

    await fs.writeFile(this.sessionsFile, JSON.stringify(sessions, null, 2));
    logger.info('Iteration added to session', {
      sessionId,
      iterationNumber: iteration.iteration_number,
      accuracy: iteration.accuracy_after,
    });

    return session;
  }

  /**
   * Save metrics snapshot
   */
  async saveMetrics(metrics: ScrapingMetrics): Promise<void> {
    try {
      const allMetrics = await this.getMetrics();
      allMetrics.push(metrics);

      // Keep only last 100 metrics to avoid file bloat
      if (allMetrics.length > 100) {
        allMetrics.splice(0, allMetrics.length - 100);
      }

      await fs.writeFile(this.metricsFile, JSON.stringify(allMetrics, null, 2));
      logger.info('Metrics saved', {
        accuracy: metrics.extraction_accuracy,
        successful: metrics.successfully_extracted,
      });
    } catch (error) {
      logger.error('Failed to save metrics', { error });
    }
  }

  /**
   * Get all metrics
   */
  async getMetrics(): Promise<ScrapingMetrics[]> {
    try {
      const content = await fs.readFile(this.metricsFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Calculate accuracy improvement
   */
  async calculateAccuracy(): Promise<number> {
    const validated = await this.getValidatedExamples();

    if (validated.length === 0) return 0;

    let correctCount = 0;

    for (const example of validated) {
      if (!example.manual_validation) continue;

      // Check if all critical fields match
      const extracted = example.gemini_extraction.tender;
      const validated_ = example.manual_validation;

      const fieldsMatch =
        extracted.bil === validated_.bil &&
        extracted.tarikh === validated_.tarikh &&
        extracted.kod_bidang === validated_.kod_bidang &&
        extracted.status === validated_.status;

      if (fieldsMatch) {
        correctCount++;
      }
    }

    const accuracy = (correctCount / validated.length) * 100;
    return parseFloat(accuracy.toFixed(2));
  }

  /**
   * Generate training report
   */
  async generateReport(): Promise<void> {
    try {
      const validated = await this.getValidatedExamples();
      const unvalidated = await this.getUnvalidatedExamples();
      const accuracy = await this.calculateAccuracy();
      const metrics = await this.getMetrics();
      const sessions = await this.getSessions();

      const report = {
        timestamp: new Date(),
        total_examples: validated.length + unvalidated.length,
        validated_examples: validated.length,
        unvalidated_examples: unvalidated.length,
        extraction_accuracy_percentage: accuracy,
        learning_sessions: sessions.length,
        latest_session: sessions[sessions.length - 1] || null,
        latest_metrics: metrics[metrics.length - 1] || null,
        average_confidence: validated.length > 0
          ? (validated.reduce((sum, ex) => sum + ex.confidence_score, 0) / validated.length).toFixed(3)
          : '0',
      };

      const reportFile = path.join(this.trainingDir, 'report.json');
      await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

      logger.info('Training report generated', {
        validated: validated.length,
        accuracy: accuracy,
      });

      console.log('\n=== TRAINING REPORT ===');
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      logger.error('Failed to generate report', { error });
    }
  }
}

export default TrainingDataManager;

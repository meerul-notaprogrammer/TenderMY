/**
 * PHASE 2: PDF CAPTURE & STORAGE
 * This module handles:
 * - PDF generation from web pages
 * - Screenshot capture
 * - Storage management
 * - Metadata tracking
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';

export interface CaptureResult {
  id: string;
  pdf_path: string;
  screenshot_path?: string;
  url: string;
  timestamp: Date;
  page_number?: number;
}

export class PDFCapture {
  private browser: Browser | null = null;
  private storageDir: string;

  constructor(storageDir: string = process.env.PDF_STORAGE_DIR || './storage/pdfs') {
    this.storageDir = storageDir;
  }

  /**
   * Initialize storage directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.mkdir(path.join(this.storageDir, 'screenshots'), { recursive: true });
      logger.info('Storage directory initialized', { dir: this.storageDir });
    } catch (error) {
      logger.error('Failed to initialize storage', { error });
      throw error;
    }
  }

  /**
   * Launch browser for PDF capture
   */
  async launchBrowser(): Promise<void> {
    try {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      });
      logger.info('Browser launched for PDF capture');
    } catch (error) {
      logger.error('Failed to launch browser', { error });
      throw error;
    }
  }

  /**
   * Capture page as PDF with high quality
   */
  async capturePDF(url: string, pageNumber: number = 1): Promise<CaptureResult> {
    if (!this.browser) {
      await this.launchBrowser();
    }

    const captureId = uuidv4();
    const page = await this.browser!.newPage();

    try {
      logger.info('Capturing PDF', { url, pageNumber });

      // Set viewport for consistent rendering
      await page.setViewport({ width: 1920, height: 1080 });

      // Navigate to page
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Wait for tables to render
      await page.waitForSelector('table', { timeout: 10000 }).catch(() => {
        logger.warn('No table found, proceeding with capture');
      });

      // Wait for any dynamic content
      await page.waitForTimeout(2000);

      // Capture PDF
      const pdfPath = path.join(this.storageDir, `${captureId}.pdf`);
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        margin: {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
        printBackground: true,
        scale: 1.0,
      });

      logger.info('PDF captured successfully', { id: captureId, path: pdfPath });

      // Capture screenshot for visual reference
      const screenshotPath = path.join(
        this.storageDir,
        'screenshots',
        `${captureId}.png`
      );
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
        type: 'png',
      });

      return {
        id: captureId,
        pdf_path: pdfPath,
        screenshot_path: screenshotPath,
        url,
        timestamp: new Date(),
        page_number: pageNumber,
      };
    } catch (error) {
      logger.error('PDF capture failed', { url, error });
      throw error;
    } finally {
      await page.close();
    }
  }

  /**
   * Capture multiple pages sequentially
   */
  async captureMultiplePages(
    baseUrl: string,
    totalPages: number,
    paginationPattern: string
  ): Promise<CaptureResult[]> {
    const results: CaptureResult[] = [];

    for (let page = 1; page <= totalPages; page++) {
      try {
        const url = paginationPattern.replace('{page}', page.toString());
        const delay = parseInt(process.env.DELAY_BETWEEN_REQUESTS || '3000');
        
        logger.info(`Capturing page ${page}/${totalPages}`);
        
        const result = await this.capturePDF(url, page);
        results.push(result);

        // Delay between requests to avoid rate limiting
        if (page < totalPages) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        logger.error(`Failed to capture page ${page}`, { error });
        // Continue with next page on error
        continue;
      }
    }

    logger.info('Multi-page capture complete', { captured: results.length, total: totalPages });
    return results;
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      logger.info('Browser closed');
    }
  }
}

export default PDFCapture;

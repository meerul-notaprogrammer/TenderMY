/**
 * PHASE 1: WEBSITE BEHAVIOR LEARNING
 * This module observes the government website to understand:
 * - Pagination patterns
 * - Dynamic content loading
 * - Table structure inconsistencies
 * - Rate limiting behavior
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import logger from '../utils/logger.js';
import { WebsiteBehavior } from '../types/index.js';

export class WebsiteBehaviorLearner {
  private browser: Browser | null = null;
  private baseUrl: string;
  private behavior: Partial<WebsiteBehavior> = {};

  constructor(baseUrl: string = process.env.GOV_WEBSITE_URL || '') {
    this.baseUrl = baseUrl;
  }

  /**
   * Launch browser and learn website behavior
   */
  async learn(): Promise<WebsiteBehavior> {
    try {
      logger.info('Starting website behavior learning...');
      
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await this.browser.newPage();
      
      // Step 1: Detect pagination
      await this.detectPagination(page);
      
      // Step 2: Detect table structure
      await this.detectTableStructure(page);
      
      // Step 3: Test dynamic content loading
      await this.testDynamicContent(page);
      
      // Step 4: Measure page load times
      await this.measureLoadTimes(page);
      
      // Step 5: Identify available filters
      await this.identifyFilters(page);

      await page.close();

      return this.behavior as WebsiteBehavior;
    } catch (error) {
      logger.error('Website behavior learning failed', { error });
      throw error;
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  /**
   * Step 1: Detect pagination pattern
   */
  private async detectPagination(page: Page): Promise<void> {
    logger.info('Detecting pagination pattern...');
    
    try {
      await page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Look for pagination elements
      const paginationUrl = page.url();
      logger.info('Current URL', { url: paginationUrl });

      // Try to find next page button
      const nextPageExists = await page.$('a[aria-label*="next"], a.next, .pagination a:last-child');
      
      if (nextPageExists) {
        logger.info('Pagination detected: Found next button');
        this.behavior.pagination_pattern = paginationUrl.includes('?') 
          ? paginationUrl + '&page={page}'
          : paginationUrl + '?page={page}';
      } else {
        logger.warn('Could not auto-detect pagination pattern');
        this.behavior.pagination_pattern = paginationUrl;
      }

      // Count total pages by examining pagination
      const pageLinks = await page.$$eval(
        '.pagination a, nav a, [role="navigation"] a',
        (links) => links.map((a) => a.textContent?.trim())
      );
      
      const pageNumbers = pageLinks
        .filter((text) => text && /^\d+$/.test(text))
        .map((text) => parseInt(text || '0'));
      
      const maxPage = Math.max(...pageNumbers, 1);
      this.behavior.total_pages = maxPage;
      logger.info('Pagination analysis complete', { total_pages: maxPage });
    } catch (error) {
      logger.error('Pagination detection error', { error });
      this.behavior.pagination_pattern = this.baseUrl;
      this.behavior.total_pages = 1;
    }
  }

  /**
   * Step 2: Detect table structure
   */
  private async detectTableStructure(page: Page): Promise<void> {
    logger.info('Detecting table structure...');
    
    try {
      // Wait for table to be visible
      await page.waitForSelector('table', { timeout: 10000 }).catch(() => {
        logger.warn('No table found on page');
      });

      const tableInfo = await page.evaluate(() => {
        const table = document.querySelector('table');
        if (!table) return null;

        // Get all headers
        const headers = Array.from(table.querySelectorAll('th')).map(
          (th) => th.textContent?.trim() || ''
        );

        // Count rows (excluding header)
        const bodyRows = table.querySelectorAll('tbody tr');
        const rowCount = bodyRows.length;

        return {
          columns: headers,
          rows_per_page: rowCount,
          has_dynamic_content: false,
        };
      });

      if (tableInfo) {
        this.behavior.table_structure = {
          ...tableInfo,
          has_dynamic_content: false,
        };
        logger.info('Table structure detected', { structure: tableInfo });
      }
    } catch (error) {
      logger.error('Table structure detection error', { error });
    }
  }

  /**
   * Step 3: Test dynamic content loading
   */
  private async testDynamicContent(page: Page): Promise<void> {
    logger.info('Testing dynamic content loading...');
    
    try {
      // Check if content is loaded via JavaScript
      const initialContent = await page.content();
      
      // Wait a bit for JavaScript to potentially load more content
      await page.waitForTimeout(3000);
      
      const laterContent = await page.content();
      
      const isDynamic = initialContent !== laterContent;
      
      if (isDynamic) {
        logger.info('Dynamic content detected');
        if (this.behavior.table_structure) {
          this.behavior.table_structure.has_dynamic_content = true;
        }
      } else {
        logger.info('No dynamic content detected');
      }
    } catch (error) {
      logger.error('Dynamic content test error', { error });
    }
  }

  /**
   * Step 4: Measure page load times
   */
  private async measureLoadTimes(page: Page): Promise<void> {
    logger.info('Measuring page load times...');
    
    try {
      const metrics = await page.metrics();
      const loadTime = metrics.Timestamp * 1000; // Convert to ms
      
      this.behavior.content_loading_time_ms = Math.round(loadTime);
      logger.info('Load time measured', { time_ms: this.behavior.content_loading_time_ms });
    } catch (error) {
      logger.error('Load time measurement error', { error });
      this.behavior.content_loading_time_ms = 0;
    }
  }

  /**
   * Step 5: Identify available filters
   */
  private async identifyFilters(page: Page): Promise<void> {
    logger.info('Identifying available filters...');
    
    try {
      const filters = await page.evaluate(() => {
        // Look for select dropdowns, input fields, buttons that suggest filtering
        const filterElements = document.querySelectorAll(
          'select, input[type="text"], input[type="search"], button'
        );
        
        const labels: string[] = [];
        
        filterElements.forEach((el) => {
          const label = el.getAttribute('aria-label') ||
                       el.getAttribute('name') ||
                       el.getAttribute('placeholder') ||
                       el.textContent?.trim();
          
          if (label && !labels.includes(label)) {
            labels.push(label);
          }
        });
        
        return labels;
      });

      this.behavior.filters_available = filters.filter(
        (f) => f && f.length > 0
      );
      logger.info('Filters identified', { filters: this.behavior.filters_available });
    } catch (error) {
      logger.error('Filter identification error', { error });
      this.behavior.filters_available = [];
    }
  }
}

export default WebsiteBehaviorLearner;

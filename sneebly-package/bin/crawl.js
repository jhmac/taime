#!/usr/bin/env node

'use strict';

const { crawlSite } = require('../src/subagents/site-crawler.js');
const path = require('path');

const appUrl = process.env.APP_URL || 'http://localhost:5000';
const maxPages = parseInt(process.env.CRAWL_MAX_PAGES) || 50;
const dataDir = path.join(process.cwd(), '.sneebly');

console.log(`Crawling ${appUrl} (max ${maxPages} pages)...`);

crawlSite({ appUrl, maxPages, dataDir })
  .then(r => {
    console.log(`Crawled ${r.pagesVisited} pages, found ${r.errors.length} errors`);
    if (r.errors.length > 0) {
      console.log(JSON.stringify(r.errors, null, 2));
    }
    process.exit(r.errors.length > 0 ? 1 : 0);
  })
  .catch(e => {
    console.error('Crawl failed:', e.message);
    process.exit(1);
  });

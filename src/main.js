/**
 * Zoopla Property Scraper - Production Ready v2.3.0
 * Uses PlaywrightCrawler with Camoufox for Cloudflare bypass
 * 
 * CRITICAL FIX: 
 * - useFingerprints: false to prevent conflict with Camoufox
 * - Don't pass proxy to camoufoxLaunchOptions (let PlaywrightCrawler handle it)
 */

import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, Dataset, log } from 'apify';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { firefox } from 'playwright';
import { load as cheerioLoad } from 'cheerio';

// ============================================================================
// CONFIGURATION
// ============================================================================
const BASE_URL = 'https://www.zoopla.co.uk';
const DEFAULT_START_URL = 'https://www.zoopla.co.uk/for-sale/property/london/?q=London&search_source=home&recent_search=true';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const cleanText = (text) => (text ? String(text).replace(/\s+/g, ' ').trim() : null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureAbsoluteUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('http')) return url;
    return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

const extractListingId = (url) => {
    if (!url) return null;
    const match =
        url.match(/\/details\/(\d+)/) ||
        url.match(/\/property\/[^/]+\/(\d+)/) ||
        url.match(/\/(\d{6,})\/?$/);
    return match ? match[1] : null;
};

const parsePriceValue = (value) => {
    if (typeof value === 'number') return value;
    if (!value) return null;
    const numeric = String(value).replace(/[^\d.]/g, '');
    return numeric ? Number(numeric) : null;
};

const parseNumber = (value) => {
    if (value === null || value === undefined) return null;
    const numeric = String(value).replace(/[^\d.]/g, '');
    if (!numeric) return null;
    return Number(numeric);
};

const extractUkPostcode = (value) => {
    if (!value) return null;
    const match = String(value).match(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i);
    return match ? match[0].toUpperCase() : null;
};

const safeParseJson = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

// ============================================================================
// JSON-LD EXTRACTION (PRIMARY METHOD)
// ============================================================================
const extractListingsFromJsonLd = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).html();
        if (!raw) return;

        const data = safeParseJson(raw);
        if (!data) return;

        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
            // ItemList structure
            if (item['@type'] === 'ItemList' && item.itemListElement) {
                for (const listItem of item.itemListElement) {
                    const property = listItem.item || listItem;
                    const url = ensureAbsoluteUrl(property.url || property['@id']);
                    const listingId = extractListingId(url);
                    const key = listingId || url;

                    if (!key || seen.has(key)) continue;
                    seen.add(key);

                    const addr = property.address || {};
                    const offers = property.offers || {};

                    listings.push({
                        listingId,
                        url,
                        title: cleanText(property.name),
                        description: cleanText(property.description),
                        image: property.image,
                        address: cleanText(typeof addr === 'string' ? addr : addr.streetAddress),
                        locality: cleanText(addr.addressLocality),
                        price: offers.price || null,
                        priceCurrency: offers.priceCurrency || 'GBP',
                        source: 'json-ld',
                    });
                }
            }

            // SearchResultsPage structure
            if (item['@type'] === 'SearchResultsPage' && item.mainEntity) {
                const listItems = item.mainEntity.itemListElement || [];
                for (const listItem of listItems) {
                    const property = listItem.item || listItem;
                    const url = ensureAbsoluteUrl(property.url || property['@id']);
                    const listingId = extractListingId(url);
                    const key = listingId || url;

                    if (!key || seen.has(key)) continue;
                    seen.add(key);

                    const addr = property.address || {};
                    const offers = property.offers || {};

                    listings.push({
                        listingId,
                        url,
                        title: cleanText(property.name),
                        description: cleanText(property.description),
                        image: property.image,
                        address: cleanText(typeof addr === 'string' ? addr : addr.streetAddress),
                        locality: cleanText(addr.addressLocality),
                        price: offers.price || null,
                        priceCurrency: offers.priceCurrency || 'GBP',
                        source: 'json-ld',
                    });
                }
            }

            // @graph structures
            if (item['@graph'] && Array.isArray(item['@graph'])) {
                for (const graphItem of item['@graph']) {
                    if (graphItem['@type'] === 'ItemList' && graphItem.itemListElement) {
                        for (const listItem of graphItem.itemListElement) {
                            const property = listItem.item || listItem;
                            const url = ensureAbsoluteUrl(property.url || property['@id']);
                            const listingId = extractListingId(url);
                            const key = listingId || url;

                            if (!key || seen.has(key)) continue;
                            seen.add(key);

                            const addr = property.address || {};
                            const offers = property.offers || {};

                            listings.push({
                                listingId,
                                url,
                                title: cleanText(property.name),
                                description: cleanText(property.description),
                                image: property.image,
                                address: cleanText(typeof addr === 'string' ? addr : addr.streetAddress),
                                locality: cleanText(addr.addressLocality),
                                price: offers.price || null,
                                priceCurrency: offers.priceCurrency || 'GBP',
                                source: 'json-ld',
                            });
                        }
                    }
                }
            }
        }
    });

    return listings;
};

// ============================================================================
// HTML EXTRACTION (FALLBACK with correct data-testid selectors)
// ============================================================================
const extractListingsFromHtml = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    // Find all property links
    $('a[href^="/for-sale/details/"]').each((_, el) => {
        const href = $(el).attr('href');

        // Skip contact/enquiry links
        if (href && href.includes('/contact/')) return;

        const url = ensureAbsoluteUrl(href);
        const listingId = extractListingId(url);
        const key = listingId || url;

        if (!key || seen.has(key)) return;
        seen.add(key);

        // Navigate up to find the card container
        let card = $(el);
        for (let i = 0; i < 10; i++) {
            card = card.parent();
            if (!card.length) break;

            const testId = card.attr('data-testid') || '';
            if (testId.includes('result') || testId.includes('listing') || card.is('article')) break;
            if (card.find('[data-testid="listing-price"]').length > 0) break;
        }

        // Extract using data-testid selectors
        const title = cleanText(
            card.find('[data-testid="listing-title"]').first().text() ||
            card.find('h2').first().text() ||
            card.find('h3').first().text()
        );

        const priceText = cleanText(
            card.find('[data-testid="listing-price"]').first().text() ||
            card.find('[data-testid="price"]').first().text()
        );

        const address = cleanText(
            card.find('[data-testid="listing-address"]').first().text() ||
            card.find('address').first().text()
        );

        const beds = parseNumber(
            card.find('[data-testid="bed"]').first().text() ||
            card.find('[data-testid="beds"]').first().text()
        );

        const baths = parseNumber(
            card.find('[data-testid="bath"]').first().text() ||
            card.find('[data-testid="baths"]').first().text()
        );

        const image = ensureAbsoluteUrl(
            card.find('[data-testid="listing-photo"]').first().attr('src') ||
            card.find('img').first().attr('src')
        );

        const description = cleanText(
            card.find('[data-testid="listing-description"]').first().text()
        );

        const agentName = cleanText(
            card.find('[data-testid="listing-agent"]').first().text() ||
            card.find('[data-testid="agent-name"]').first().text()
        );

        listings.push({
            listingId,
            url,
            title,
            price: parsePriceValue(priceText),
            priceText,
            address,
            postalCode: extractUkPostcode(address),
            beds,
            baths,
            image,
            description,
            agentName,
            priceCurrency: 'GBP',
            source: 'html',
        });
    });

    return listings;
};

// ============================================================================
// MERGE LISTINGS FROM BOTH SOURCES
// ============================================================================
const mergeListings = (jsonLdListings, htmlListings) => {
    const merged = new Map();

    for (const listing of jsonLdListings) {
        const key = listing.listingId || listing.url;
        if (key) merged.set(key, { ...listing });
    }

    for (const listing of htmlListings) {
        const key = listing.listingId || listing.url;
        if (!key) continue;

        if (merged.has(key)) {
            const existing = merged.get(key);
            for (const [field, value] of Object.entries(listing)) {
                if (existing[field] === null || existing[field] === undefined) {
                    existing[field] = value;
                }
            }
        } else {
            merged.set(key, { ...listing });
        }
    }

    return Array.from(merged.values());
};

// ============================================================================
// PAGINATION
// ============================================================================
const buildSearchUrlForPage = (startUrl, page) => {
    const url = new URL(startUrl);
    if (page > 1) {
        url.searchParams.set('pn', String(page));
    } else {
        url.searchParams.delete('pn');
    }
    return url.toString();
};

// ============================================================================
// MAIN ACTOR
// ============================================================================
await Actor.init();

try {
    const input = (await Actor.getInput()) || {};

    // Input validation
    const startUrls = Array.isArray(input.startUrls) && input.startUrls.length ? input.startUrls : null;
    const startUrl = input.startUrl || (startUrls ? null : DEFAULT_START_URL);

    if (!startUrl && !startUrls) {
        const message = 'Missing required field: startUrl or startUrls.';
        log.error(message);
        await Actor.setStatusMessage(message);
        await Actor.exit({ exitCode: 1 });
    }

    const resultsWanted = Math.max(1, Number.isFinite(+input.results_wanted) ? +input.results_wanted : 50);
    const maxPages = Math.max(1, Number.isFinite(+input.max_pages) ? +input.max_pages : 5);
    // CRITICAL: Use only 1 concurrent browser to avoid detection
    const maxConcurrency = 1;

    // Proxy configuration - UK residential proxies required
    const proxyConfiguration = await Actor.createProxyConfiguration({
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        countryCode: 'GB',
        ...input.proxyConfiguration,
    });

    log.info('Zoopla Scraper Starting', {
        targets: startUrls?.length || 1,
        resultsWanted,
        maxPages,
        maxConcurrency,
        usingCamoufox: true,
    });

    // State management
    const seen = new Set();
    const stats = {
        pagesProcessed: 0,
        listingsSaved: 0,
        methodsUsed: new Set(),
    };
    let saved = 0;

    // Build initial request queue
    const targets = startUrls || [startUrl];
    const initialRequests = [];

    for (const target of targets) {
        for (let page = 1; page <= maxPages; page++) {
            initialRequests.push({
                url: buildSearchUrlForPage(target, page),
                userData: { type: 'search', page },
            });
        }
    }

    // Get Camoufox launch options
    // CRITICAL: Do NOT pass proxy here - let PlaywrightCrawler handle it
    const camoufoxOptions = await camoufoxLaunchOptions({
        headless: true,
        // geoip: true will use the proxy to determine location
        geoip: true,
        // DO NOT pass proxy here - it causes NS_ERROR_PROXY_CONNECTION_REFUSED
        // proxy: REMOVED - PlaywrightCrawler manages proxy via proxyConfiguration
    });

    log.info('Camoufox options configured', {
        headless: true,
        geoip: true,
        proxyHandledBy: 'PlaywrightCrawler'
    });

    // Create PlaywrightCrawler with Camoufox
    const crawler = new PlaywrightCrawler({
        // Proxy is handled here, NOT in camoufoxLaunchOptions
        proxyConfiguration,
        maxConcurrency,
        maxRequestRetries: 5,
        requestHandlerTimeoutSecs: 120,
        navigationTimeoutSecs: 90,

        // Camoufox launch configuration
        launchContext: {
            launcher: firefox,
            launchOptions: camoufoxOptions,
        },

        // CRITICAL: Disable Crawlee's fingerprinting - Camoufox handles it
        browserPoolOptions: {
            useFingerprints: false,  // <-- REQUIRED for Camoufox
            maxOpenPagesPerBrowser: 1,
            retireBrowserAfterPageCount: 2,
        },

        // Pre-navigation for human-like behavior
        preNavigationHooks: [
            async ({ page }) => {
                // Random delay before navigation (2-5 seconds)
                const delay = 2000 + Math.random() * 3000;
                log.debug(`Pre-navigation delay: ${Math.round(delay)}ms`);
                await sleep(delay);
            },
        ],

        // Post-navigation for page interaction
        postNavigationHooks: [
            async ({ page }) => {
                // Wait for page to stabilize
                await page.waitForLoadState('domcontentloaded');
                await sleep(2000 + Math.random() * 1000);

                // Human-like scrolling
                await page.evaluate(() => window.scrollBy(0, 300));
                await sleep(500);
                await page.evaluate(() => window.scrollBy(0, 500));
                await sleep(1000);
                await page.evaluate(() => window.scrollBy(0, 300));
                await sleep(500);
            },
        ],

        // Main request handler
        async requestHandler({ request, page }) {
            const { type, page: pageNum } = request.userData;

            if (saved >= resultsWanted) {
                log.debug('Results limit reached, skipping');
                return;
            }

            // Check for Cloudflare challenge
            const pageContent = await page.content();
            if (pageContent.includes('Just a moment') ||
                pageContent.includes('Verify you are human') ||
                pageContent.includes('Checking your browser')) {
                log.warning(`Cloudflare challenge detected on page ${pageNum}, waiting for resolution...`);

                // Wait for challenge to resolve
                await sleep(8000);
                await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });

                // Check again after waiting
                const newContent = await page.content();
                if (newContent.includes('Just a moment') || newContent.includes('Verify you are human')) {
                    log.error(`Cloudflare challenge not resolved on page ${pageNum}`);
                    return;
                }
            }

            if (type === 'search') {
                log.info(`Processing search page ${pageNum}: ${request.url}`);

                const html = await page.content();

                // Dual extraction: JSON-LD + HTML
                const jsonLdListings = extractListingsFromJsonLd(html);
                const htmlListings = extractListingsFromHtml(html);
                const listings = mergeListings(jsonLdListings, htmlListings);

                if (jsonLdListings.length > 0) stats.methodsUsed.add('json-ld');
                if (htmlListings.length > 0) stats.methodsUsed.add('html');

                log.info(`Found ${listings.length} listings on page ${pageNum} (JSON-LD: ${jsonLdListings.length}, HTML: ${htmlListings.length})`);

                if (!listings.length) {
                    log.warning(`No listings found on page ${pageNum} - may be blocked`);

                    // Save debug info
                    const title = await page.title();
                    log.debug(`Page title: ${title}`);

                    return;
                }

                stats.pagesProcessed++;

                // Process listings
                for (const listing of listings) {
                    if (saved >= resultsWanted) break;

                    const key = listing.listingId || listing.url;
                    if (!key || seen.has(key)) continue;
                    seen.add(key);

                    const property = {
                        listingId: listing.listingId || null,
                        url: listing.url,
                        title: listing.title || null,
                        price: listing.price || null,
                        priceValue: parsePriceValue(listing.price) || null,
                        priceCurrency: listing.priceCurrency || 'GBP',
                        priceText: listing.priceText || (listing.price ? `£${listing.price.toLocaleString()}` : null),
                        address: listing.address || null,
                        postalCode: listing.postalCode || extractUkPostcode(listing.address),
                        locality: listing.locality || null,
                        beds: listing.beds || null,
                        baths: listing.baths || null,
                        propertyType: listing.propertyType || null,
                        description: listing.description || null,
                        image: listing.image || null,
                        agentName: listing.agentName || null,
                        source: listing.source,
                        scrapedAt: new Date().toISOString(),
                    };

                    await Dataset.pushData(property);
                    saved++;
                    stats.listingsSaved = saved;

                    if (saved % 10 === 0) {
                        log.info(`Progress: ${saved}/${resultsWanted} listings saved`);
                    }
                }
            }
        },

        // Error handling
        async failedRequestHandler({ request, error }) {
            log.error(`Request failed: ${request.url}`, {
                error: error.message,
                retryCount: request.retryCount
            });
        },
    });

    // Run crawler
    await crawler.run(initialRequests);

    // Final status
    if (saved === 0) {
        const message = 'No listings scraped. Zoopla may be blocking all requests. Try again later.';
        log.warning(message);
        await Actor.setStatusMessage(message);
    } else {
        const summary = {
            listingsSaved: saved,
            pagesProcessed: stats.pagesProcessed,
            methodsUsed: Array.from(stats.methodsUsed),
        };
        log.info('Scraping complete!', summary);
        await Actor.setStatusMessage(`Successfully scraped ${saved} listings`);
        await Actor.setValue('RUN_SUMMARY', summary);
    }

} catch (error) {
    log.error(`Actor failed: ${error.message}`, { stack: error.stack });
    await Actor.setStatusMessage(`Failed: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}

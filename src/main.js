/**
 * Zoopla Property Scraper - Production Ready v2.4.0
 * Uses PlaywrightCrawler with Camoufox for Cloudflare bypass
 * 
 * CORRECT SELECTORS (from scrapingdog.com research):
 * - Card container: div.dkr2t86
 * - Price: p._64if862
 * - Address: address.m6hnz62
 * - Description: p.m6hnz63
 * - Title: h2.m6hnz61
 * - Beds: span.num-beds OR data with beds icon
 * - Baths: span.num-baths OR data with baths icon
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
    const text = String(value);
    // Extract first number from text like "2 beds" or "2"
    const match = text.match(/(\d+)/);
    return match ? Number(match[1]) : null;
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
// JSON-LD EXTRACTION (BACKUP - may not always be present)
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
        }
    });

    return listings;
};

// ============================================================================
// HTML EXTRACTION - CORRECT SELECTORS FROM RESEARCH
// Class names: dkr2t86 (card), _64if862 (price), m6hnz62 (address), m6hnz63 (desc)
// ============================================================================
const extractListingsFromHtml = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    // CORRECT: Find all listing cards by the container class
    const cards = $('div.dkr2t86');

    log.debug(`Found ${cards.length} listing cards with class dkr2t86`);

    cards.each((_, cardEl) => {
        const card = $(cardEl);

        // Find the listing URL within the card
        const linkEl = card.find('a[href^="/for-sale/details/"]').first();
        const href = linkEl.attr('href');

        // Skip if no valid link or if it's a contact link
        if (!href || href.includes('/contact/')) return;

        const url = ensureAbsoluteUrl(href);
        const listingId = extractListingId(url);
        const key = listingId || url;

        if (!key || seen.has(key)) return;
        seen.add(key);

        // CORRECT SELECTORS from scrapingdog research:
        // Price: p._64if862
        const priceText = cleanText(card.find('p._64if862').first().text());

        // Address: address.m6hnz62
        const address = cleanText(card.find('address.m6hnz62').first().text());

        // Description/Title: p.m6hnz63 or h2.m6hnz61
        const description = cleanText(card.find('p.m6hnz63').first().text());
        const title = cleanText(
            card.find('h2.m6hnz61').first().text() ||
            card.find('h2').first().text() ||
            description
        );

        // Beds and Baths - look for various patterns
        // Pattern 1: span.num-beds, span.num-baths
        let beds = parseNumber(card.find('span.num-beds').first().text());
        let baths = parseNumber(card.find('span.num-baths').first().text());

        // Pattern 2: Look for elements with bed/bath icons or text
        if (!beds) {
            // Try finding text that contains "bed"
            card.find('span, p, div').each((_, el) => {
                const text = $(el).text().toLowerCase();
                if (!beds && text.includes('bed') && !text.includes('bath')) {
                    const match = text.match(/(\d+)\s*bed/i);
                    if (match) beds = Number(match[1]);
                }
                if (!baths && text.includes('bath')) {
                    const match = text.match(/(\d+)\s*bath/i);
                    if (match) baths = Number(match[1]);
                }
            });
        }

        // Pattern 3: data-testid attributes
        if (!beds) {
            beds = parseNumber(card.find('[data-testid="bed"]').first().text());
        }
        if (!baths) {
            baths = parseNumber(card.find('[data-testid="bath"]').first().text());
        }

        // Property type from description or dedicated element
        let propertyType = null;
        if (title) {
            const typeMatch = title.match(/\d+\s*bed\s+(\w+)/i);
            if (typeMatch) {
                propertyType = cleanText(typeMatch[1]);
            }
        }

        // Image
        const image = ensureAbsoluteUrl(
            card.find('img').first().attr('src') ||
            card.find('picture source').first().attr('srcset')?.split(',')[0]?.trim()?.split(' ')[0]
        );

        // Agent name
        const agentName = cleanText(
            card.find('[data-testid="agent-name"]').first().text() ||
            card.find('.agent-name').first().text()
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
            propertyType,
            description,
            image,
            agentName,
            priceCurrency: 'GBP',
            source: 'html',
        });
    });

    // FALLBACK: If no cards found with div.dkr2t86, try finding links directly
    if (listings.length === 0) {
        log.debug('No div.dkr2t86 cards found, falling back to link-based extraction');

        $('a[href^="/for-sale/details/"]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href || href.includes('/contact/')) return;

            const url = ensureAbsoluteUrl(href);
            const listingId = extractListingId(url);
            const key = listingId || url;

            if (!key || seen.has(key)) return;
            seen.add(key);

            // Try to find parent container
            let card = $(el);
            for (let i = 0; i < 8; i++) {
                card = card.parent();
                if (!card.length) break;
            }

            // Extract what we can
            const priceText = cleanText(
                card.find('p._64if862').first().text() ||
                card.find('[data-testid="listing-price"]').first().text()
            );

            const address = cleanText(
                card.find('address.m6hnz62').first().text() ||
                card.find('address').first().text()
            );

            listings.push({
                listingId,
                url,
                title: null,
                price: parsePriceValue(priceText),
                priceText,
                address,
                postalCode: extractUkPostcode(address),
                beds: null,
                baths: null,
                propertyType: null,
                description: null,
                image: null,
                agentName: null,
                priceCurrency: 'GBP',
                source: 'html-fallback',
            });
        });
    }

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
    const maxConcurrency = 1; // Single concurrency for stealth

    // Proxy configuration
    const proxyConfiguration = await Actor.createProxyConfiguration({
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        countryCode: 'GB',
        ...input.proxyConfiguration,
    });

    log.info('Zoopla Scraper Starting v2.4.0', {
        targets: startUrls?.length || 1,
        resultsWanted,
        maxPages,
        maxConcurrency,
    });

    const seen = new Set();
    const stats = { pagesProcessed: 0, listingsSaved: 0, methodsUsed: new Set() };
    let saved = 0;

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

    const camoufoxOptions = await camoufoxLaunchOptions({
        headless: true,
        geoip: true,
    });

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency,
        maxRequestRetries: 5,
        requestHandlerTimeoutSecs: 120,
        navigationTimeoutSecs: 90,

        launchContext: {
            launcher: firefox,
            launchOptions: camoufoxOptions,
        },

        browserPoolOptions: {
            useFingerprints: false,
            maxOpenPagesPerBrowser: 1,
            retireBrowserAfterPageCount: 2,
        },

        preNavigationHooks: [
            async ({ page }) => {
                await sleep(2000 + Math.random() * 3000);
            },
        ],

        postNavigationHooks: [
            async ({ page }) => {
                await page.waitForLoadState('domcontentloaded');
                await sleep(2000 + Math.random() * 1000);

                // Scroll to load all content
                await page.evaluate(() => window.scrollBy(0, 500));
                await sleep(500);
                await page.evaluate(() => window.scrollBy(0, 800));
                await sleep(500);
                await page.evaluate(() => window.scrollBy(0, 500));
                await sleep(1000);
            },
        ],

        async requestHandler({ request, page }) {
            const { type, page: pageNum } = request.userData;

            if (saved >= resultsWanted) return;

            // Check for Cloudflare
            const pageContent = await page.content();
            if (pageContent.includes('Just a moment') || pageContent.includes('Verify you are human')) {
                log.warning(`Cloudflare challenge on page ${pageNum}, waiting...`);
                await sleep(8000);
                await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
            }

            if (type === 'search') {
                log.info(`Processing search page ${pageNum}: ${request.url}`);

                // Wait for content to render
                await page.waitForSelector('div.dkr2t86', { timeout: 15000 }).catch(() => {
                    log.debug('div.dkr2t86 not found, trying alternatives');
                });

                const html = await page.content();

                // Extract using both methods
                const jsonLdListings = extractListingsFromJsonLd(html);
                const htmlListings = extractListingsFromHtml(html);
                const listings = mergeListings(jsonLdListings, htmlListings);

                if (jsonLdListings.length > 0) stats.methodsUsed.add('json-ld');
                if (htmlListings.length > 0) stats.methodsUsed.add('html');

                log.info(`Found ${listings.length} listings on page ${pageNum} (JSON-LD: ${jsonLdListings.length}, HTML: ${htmlListings.length})`);

                if (!listings.length) {
                    log.warning(`No listings on page ${pageNum}`);
                    // Debug: Save page content for analysis
                    const title = await page.title();
                    log.debug(`Page title: ${title}`);
                    return;
                }

                stats.pagesProcessed++;

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

        async failedRequestHandler({ request, error }) {
            log.error(`Failed: ${request.url}`, { error: error.message });
        },
    });

    await crawler.run(initialRequests);

    if (saved === 0) {
        await Actor.setStatusMessage('No listings scraped. Check logs.');
    } else {
        log.info('Complete!', { saved, pages: stats.pagesProcessed, methods: Array.from(stats.methodsUsed) });
        await Actor.setStatusMessage(`Scraped ${saved} listings`);
        await Actor.setValue('RUN_SUMMARY', { saved, pages: stats.pagesProcessed });
    }

} catch (error) {
    log.error(`Error: ${error.message}`, { stack: error.stack });
    await Actor.setStatusMessage(`Error: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}

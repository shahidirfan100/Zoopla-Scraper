/**
 * Zoopla Property Scraper - Production Ready v2.7.0
 * 
 * CORRECT SELECTORS (from live browser inspection):
 * - Listing container: div[id^="listing_"]
 * - Price: p[class*="price_priceText"]
 * - Address: address[class*="summary_address"]
 * - Description: p[class*="summary_summary"]
 * - Amenities: p[class*="amenities_amenityList"] → "1 bed 1 bath 1 reception"
 * - Image: div[class*="layoutMediaWrapper"] img
 * - Agent: img[alt*="Estate Agents"] (alt attribute)
 * - Property type: Extract from summary text
 * - Postal code: Extract from end of address
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

// Property types to search for
const PROPERTY_TYPES = ['flat', 'apartment', 'house', 'maisonette', 'bungalow', 'studio', 'duplex', 'penthouse', 'townhouse', 'land', 'detached', 'semi-detached', 'terraced', 'cottage'];

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

const extractListingIdFromDivId = (divId) => {
    if (!divId) return null;
    const match = divId.match(/listing_(\d+)/);
    return match ? match[1] : null;
};

const parsePriceValue = (value) => {
    if (typeof value === 'number') return value;
    if (!value) return null;
    const numeric = String(value).replace(/[^\d.]/g, '');
    return numeric ? Number(numeric) : null;
};

const extractUkPostcode = (value) => {
    if (!value) return null;
    // UK postcode pattern: 1-2 letters, 1-2 digits, optional space, digit, 2 letters
    const match = String(value).match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/i);
    return match ? match[1].toUpperCase() : null;
};

const extractPropertyType = (text) => {
    if (!text) return null;
    const lowerText = text.toLowerCase();
    for (const type of PROPERTY_TYPES) {
        if (lowerText.includes(type)) {
            return type.charAt(0).toUpperCase() + type.slice(1);
        }
    }
    return null;
};

// ============================================================================
// HTML EXTRACTION
// ============================================================================
const extractListingsFromHtml = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    // CORRECT: div[id^="listing_"] - each listing has id like "listing_71962539"
    const cards = $('div[id^="listing_"]');

    log.info(`Found ${cards.length} listing cards with div[id^="listing_"]`);

    cards.each((_, cardEl) => {
        const card = $(cardEl);
        const divId = card.attr('id');

        const listingId = extractListingIdFromDivId(divId);
        if (!listingId || seen.has(listingId)) return;
        seen.add(listingId);

        // Link
        const linkEl = card.find('a[href*="/for-sale/details/"]').first();
        const href = linkEl.attr('href');
        const url = ensureAbsoluteUrl(href) || `${BASE_URL}/for-sale/details/${listingId}/`;

        // Price: p[class*="price_priceText"]
        let priceText = cleanText(card.find('p[class*="price_priceText"]').first().text());
        if (!priceText) {
            card.find('p').each((_, el) => {
                const text = $(el).text();
                if (!priceText && text.includes('£')) {
                    const match = text.match(/£[\d,]+/);
                    if (match) priceText = match[0];
                }
            });
        }

        // Address: address[class*="summary_address"]
        const address = cleanText(
            card.find('address[class*="summary_address"]').first().text() ||
            card.find('address').first().text()
        );

        // Postal code: Extract from end of address
        const postalCode = extractUkPostcode(address);

        // Description: p[class*="summary_summary"]
        const description = cleanText(
            card.find('p[class*="summary_summary"]').first().text()
        );

        // Amenities: p[class*="amenities_amenityList"]
        const amenitiesText = cleanText(
            card.find('p[class*="amenities_amenityList"]').first().text() ||
            card.find('p[class*="amenities"]').first().text()
        );

        // Parse beds, baths, receptions from amenities
        let beds = null;
        let baths = null;
        let receptions = null;

        if (amenitiesText) {
            const bedsMatch = amenitiesText.match(/(\d+)\s*bed/i);
            const bathsMatch = amenitiesText.match(/(\d+)\s*bath/i);
            const receptionsMatch = amenitiesText.match(/(\d+)\s*reception/i);

            if (bedsMatch) beds = Number(bedsMatch[1]);
            if (bathsMatch) baths = Number(bathsMatch[1]);
            if (receptionsMatch) receptions = Number(receptionsMatch[1]);
        }

        // Fallback: search card text
        if (!beds || !baths) {
            const cardText = card.text();
            if (!beds) {
                const match = cardText.match(/(\d+)\s*bed/i);
                if (match) beds = Number(match[1]);
            }
            if (!baths) {
                const match = cardText.match(/(\d+)\s*bath/i);
                if (match) baths = Number(match[1]);
            }
        }

        // Property type: Extract from summary/description
        const propertyType = extractPropertyType(description) ||
            extractPropertyType(amenitiesText) ||
            extractPropertyType(card.text());

        // Title: Construct from beds + property type, or use address
        let title = null;
        if (beds && propertyType) {
            title = `${beds} bed ${propertyType} for sale`;
        } else if (beds) {
            title = `${beds} bedroom property for sale`;
        } else {
            title = cleanText(card.find('h2, h3').first().text()) || address;
        }

        // Image: div[class*="layoutMediaWrapper"] img
        let image = null;
        const imgEl = card.find('div[class*="layoutMediaWrapper"] img').first();
        if (imgEl.length) {
            image = imgEl.attr('src') || imgEl.attr('data-src');
        }
        if (!image) {
            // Fallback: first img in card
            const firstImg = card.find('img').first();
            image = firstImg.attr('src') || firstImg.attr('data-src');
        }
        // Clean up image URL
        if (image) {
            image = ensureAbsoluteUrl(image.split('?')[0]);
        }

        // Agent name: img[alt*="Estate Agents"] or img[class*="agent"]
        let agentName = null;
        const agentImg = card.find('img[alt*="Estate Agent"], img[alt*="logo"]').first();
        if (agentImg.length) {
            agentName = cleanText(agentImg.attr('alt')?.replace(/\s*logo\s*/gi, '').replace(/Estate Agents?/gi, '').trim());
        }
        // Fallback: look for agent-related text
        if (!agentName) {
            const agentEl = card.find('[class*="agent"], [class*="branch"]').first();
            agentName = cleanText(agentEl.text());
        }

        listings.push({
            listingId,
            url,
            title,
            price: parsePriceValue(priceText),
            priceText,
            address,
            postalCode,
            beds,
            baths,
            receptions,
            propertyType,
            description,
            image,
            agentName,
            priceCurrency: 'GBP',
            source: 'html',
        });
    });

    return listings;
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
        log.error('Missing startUrl');
        await Actor.exit({ exitCode: 1 });
    }

    const resultsWanted = Math.max(1, Number.isFinite(+input.results_wanted) ? +input.results_wanted : 50);
    const maxPages = Math.max(1, Number.isFinite(+input.max_pages) ? +input.max_pages : 5);

    const proxyConfiguration = await Actor.createProxyConfiguration({
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        countryCode: 'GB',
        ...input.proxyConfiguration,
    });

    log.info('Zoopla Scraper v2.7.0 Starting', { resultsWanted, maxPages });

    const seen = new Set();
    let saved = 0;
    let shouldStop = false;

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

    const camoufoxOptions = await camoufoxLaunchOptions({ headless: true, geoip: true });

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency: 1,
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
            async () => { await sleep(2000 + Math.random() * 3000); },
        ],

        postNavigationHooks: [
            async ({ page }) => {
                await page.waitForLoadState('domcontentloaded');
                await sleep(2000);

                // Wait for listing cards
                await page.waitForSelector('div[id^="listing_"]', { timeout: 15000 }).catch(() => { });

                // Scroll to load content
                for (let i = 0; i < 5; i++) {
                    await page.evaluate(() => window.scrollBy(0, 500));
                    await sleep(400);
                }
                await sleep(1000);
            },
        ],

        async requestHandler({ request, page, crawler: crawlerInstance }) {
            const { page: pageNum } = request.userData;

            // EARLY EXIT: Check if we already have enough
            if (saved >= resultsWanted || shouldStop) {
                log.info(`Skipping page ${pageNum} - already have ${saved}/${resultsWanted} listings`);
                return;
            }

            const pageContent = await page.content();

            // Cloudflare check
            if (pageContent.includes('Just a moment') || pageContent.includes('Verify you are human')) {
                log.warning(`Cloudflare on page ${pageNum}, waiting...`);
                await sleep(10000);
                await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
            }

            log.info(`Processing page ${pageNum}: ${request.url}`);

            const html = await page.content();
            const listings = extractListingsFromHtml(html);

            log.info(`Page ${pageNum}: Found ${listings.length} listings`);

            if (!listings.length) {
                log.warning(`No listings on page ${pageNum}`);
                return;
            }

            for (const listing of listings) {
                if (saved >= resultsWanted) {
                    shouldStop = true;
                    break;
                }

                const key = listing.listingId || listing.url;
                if (!key || seen.has(key)) continue;
                seen.add(key);

                await Dataset.pushData({
                    ...listing,
                    priceValue: parsePriceValue(listing.price) || null,
                    scrapedAt: new Date().toISOString(),
                });

                saved++;
                if (saved % 10 === 0) log.info(`Progress: ${saved}/${resultsWanted}`);
            }

            // STOP CRAWLER if we have enough
            if (saved >= resultsWanted) {
                shouldStop = true;
                log.info(`Reached ${saved}/${resultsWanted} listings, stopping crawler...`);
                // Abort remaining requests
                const queue = await crawlerInstance.getRequestQueue();
                await queue.drop();
            }
        },

        async failedRequestHandler({ request, error }) {
            log.error(`Failed: ${request.url} - ${error.message}`);
        },
    });

    await crawler.run(initialRequests);

    log.info(`Complete! Saved ${saved} listings`);
    await Actor.setStatusMessage(`Scraped ${saved} listings`);

} catch (error) {
    log.error(error.message);
    throw error;
} finally {
    await Actor.exit();
}

/**
 * Zoopla Property Scraper - Production Ready v2.8.0
 * 
 * CORRECT SELECTORS (from live browser inspection):
 * - Listing container: div[id^="listing_"]
 * - Price: p[class*="price_priceText"]
 * - Address: address[class*="summary_address"]
 * - Description: p[class*="summary_summary"]
 * - Amenities: p[class*="amenities_amenityList"] → "1 bed 1 bath 1 reception"
 * - Image: div[class*="layoutMediaWrapper"] img
 * - Agent: img[alt*="Estate Agents"] (alt attribute)
 * 
 * FIXES in v2.8.0:
 * - Removed queue.drop() which caused errors - use simple flag instead
 * - Improved postal code extraction with multiple patterns
 * - Better baths extraction with fallback to generic patterns
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

// Improved postal code extraction
const extractUkPostcode = (value) => {
    if (!value) return null;
    const text = String(value);

    // UK postcode patterns (with and without space)
    const patterns = [
        // Standard format: SW1A 1AA, EC1A 1BB
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s+\d[A-Z]{2})\b/i,
        // Without space: SW1A1AA
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2})\b/i,
        // Just outcode at end: SW1, E1, W1A
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*$/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1].toUpperCase();
        }
    }

    // Try extracting from the last part of address after comma
    const parts = text.split(',');
    if (parts.length > 1) {
        const lastPart = parts[parts.length - 1].trim();
        for (const pattern of patterns) {
            const match = lastPart.match(pattern);
            if (match) {
                return match[1].toUpperCase();
            }
        }
    }

    return null;
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

        // Price
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

        // Address
        const address = cleanText(
            card.find('address[class*="summary_address"]').first().text() ||
            card.find('address').first().text()
        );

        // Postal code - improved extraction
        const postalCode = extractUkPostcode(address);

        // Description
        const description = cleanText(
            card.find('p[class*="summary_summary"]').first().text()
        );

        // Amenities - try multiple selectors
        let amenitiesText = cleanText(
            card.find('p[class*="amenities_amenityList"]').first().text()
        );
        if (!amenitiesText) {
            amenitiesText = cleanText(card.find('p[class*="amenities"]').first().text());
        }
        if (!amenitiesText) {
            // Try finding any element with bed/bath info
            card.find('p, span, div').each((_, el) => {
                const text = $(el).text();
                if (!amenitiesText && text.match(/\d+\s*bed/i)) {
                    amenitiesText = cleanText(text);
                }
            });
        }

        // Parse beds, baths, receptions
        let beds = null;
        let baths = null;
        let receptions = null;

        // First try from amenities text
        if (amenitiesText) {
            const bedsMatch = amenitiesText.match(/(\d+)\s*bed/i);
            const bathsMatch = amenitiesText.match(/(\d+)\s*bath/i);
            const receptionsMatch = amenitiesText.match(/(\d+)\s*reception/i);

            if (bedsMatch) beds = Number(bedsMatch[1]);
            if (bathsMatch) baths = Number(bathsMatch[1]);
            if (receptionsMatch) receptions = Number(receptionsMatch[1]);
        }

        // Fallback: search entire card text
        const cardText = card.text();
        if (!beds) {
            const match = cardText.match(/(\d+)\s*bed(?:room)?s?/i);
            if (match) beds = Number(match[1]);
        }
        if (!baths) {
            const match = cardText.match(/(\d+)\s*bath(?:room)?s?/i);
            if (match) baths = Number(match[1]);
        }
        if (!receptions) {
            const match = cardText.match(/(\d+)\s*reception/i);
            if (match) receptions = Number(match[1]);
        }

        // Property type
        const propertyType = extractPropertyType(description) ||
            extractPropertyType(amenitiesText) ||
            extractPropertyType(cardText);

        // Title
        let title = null;
        if (beds && propertyType) {
            title = `${beds} bed ${propertyType} for sale`;
        } else if (beds) {
            title = `${beds} bedroom property for sale`;
        } else {
            title = cleanText(card.find('h2, h3').first().text()) || address;
        }

        // Image
        let image = null;
        const imgEl = card.find('div[class*="layoutMediaWrapper"] img').first();
        if (imgEl.length) {
            image = imgEl.attr('src') || imgEl.attr('data-src');
        }
        if (!image) {
            const firstImg = card.find('img').first();
            image = firstImg.attr('src') || firstImg.attr('data-src');
        }
        if (image) {
            image = ensureAbsoluteUrl(image.split('?')[0]);
        }

        // Agent name
        let agentName = null;
        const agentImg = card.find('img[alt*="Estate Agent"], img[alt*="logo"]').first();
        if (agentImg.length) {
            agentName = cleanText(agentImg.attr('alt')?.replace(/\s*logo\s*/gi, '').replace(/Estate Agents?/gi, '').trim());
        }
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

    log.info('Zoopla Scraper v2.8.0 Starting', { resultsWanted, maxPages });

    const seen = new Set();
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

    const camoufoxOptions = await camoufoxLaunchOptions({ headless: true, geoip: true });

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency: 1,
        maxRequestRetries: 3,
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
                await page.waitForSelector('div[id^="listing_"]', { timeout: 15000 }).catch(() => { });
                for (let i = 0; i < 5; i++) {
                    await page.evaluate(() => window.scrollBy(0, 500));
                    await sleep(400);
                }
                await sleep(1000);
            },
        ],

        async requestHandler({ request, page }) {
            const { page: pageNum } = request.userData;

            // SIMPLE SKIP: Just return early if we have enough
            if (saved >= resultsWanted) {
                log.info(`Skipping page ${pageNum} - already have ${saved}/${resultsWanted} listings`);
                return;
            }

            const pageContent = await page.content();

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
                if (saved >= resultsWanted) break;

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

            // Log when target reached (but don't try to drop queue)
            if (saved >= resultsWanted) {
                log.info(`Reached ${saved}/${resultsWanted} listings. Remaining pages will be skipped.`);
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

/**
 * Zoopla Property Scraper - Production Ready v3.0.0
 * 
 * OPTIMIZED FOR SPEED & COST:
 * - Reduced delays (1-2s instead of 2-5s)
 * - Block unnecessary resources (images, CSS, fonts)
 * - Faster scrolling
 * - Minimal waits
 * 
 * SELECTORS:
 * - Listing container: div[id^="listing_"]
 * - Price: p[class*="price_priceText"]
 * - Address: address[class*="summary_address"]
 * - Description: p[class*="summary_summary"]
 * - Amenities: p[class*="amenities_amenityList"]
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
const LISTINGS_PER_PAGE = 28;
const MAX_CONCURRENCY = 1;

const PROPERTY_TYPES = ['flat', 'apartment', 'house', 'maisonette', 'bungalow', 'studio', 'duplex', 'penthouse', 'townhouse', 'land', 'detached', 'semi-detached', 'terraced', 'cottage'];

// Resources to block for speed
const BLOCKED_RESOURCES = ['image', 'media', 'font', 'stylesheet'];
const BLOCKED_URLS = [
    'google-analytics.com',
    'googletagmanager.com',
    'facebook.com',
    'doubleclick.net',
    'hotjar.com',
    'newrelic.com',
    'optimizely.com',
    'segment.com',
    'amplitude.com',
    'mixpanel.com',
];

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
    const text = String(value);
    const patterns = [
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s+\d[A-Z]{2})\b/i,
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2})\b/i,
        /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*$/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].toUpperCase();
    }
    const parts = text.split(',');
    if (parts.length > 1) {
        const lastPart = parts[parts.length - 1].trim();
        for (const pattern of patterns) {
            const match = lastPart.match(pattern);
            if (match) return match[1].toUpperCase();
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
// HTML EXTRACTION (Optimized - minimal operations)
// ============================================================================
const extractListingsFromHtml = (html) => {
    const $ = cheerioLoad(html);
    const listings = [];
    const seen = new Set();

    const cards = $('div[id^="listing_"]');

    cards.each((_, cardEl) => {
        const card = $(cardEl);
        const divId = card.attr('id');

        const listingId = extractListingIdFromDivId(divId);
        if (!listingId || seen.has(listingId)) return;
        seen.add(listingId);

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

        // Description
        const description = cleanText(
            card.find('p[class*="summary_summary"]').first().text()
        );

        // Amenities
        let amenitiesText = cleanText(
            card.find('p[class*="amenities_amenityList"]').first().text() ||
            card.find('p[class*="amenities"]').first().text()
        );

        // Parse beds, baths
        let beds = null, baths = null, receptions = null;
        const cardText = card.text();

        const bedsMatch = cardText.match(/(\d+)\s*bed/i);
        const bathsMatch = cardText.match(/(\d+)\s*bath/i);
        const receptionsMatch = cardText.match(/(\d+)\s*reception/i);

        if (bedsMatch) beds = Number(bedsMatch[1]);
        if (bathsMatch) baths = Number(bathsMatch[1]);
        if (receptionsMatch) receptions = Number(receptionsMatch[1]);

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
            title = address;
        }

        // Image URL (from srcset or src)
        let image = null;
        const imgEl = card.find('img').first();
        const imgSrc = imgEl.attr('src') || imgEl.attr('data-src');
        if (imgSrc) {
            image = ensureAbsoluteUrl(imgSrc.split('?')[0]);
        }

        // Agent name
        let agentName = null;
        const agentImg = card.find('img[alt*="Estate Agent"], img[alt*="logo"]').first();
        if (agentImg.length) {
            agentName = cleanText(agentImg.attr('alt')?.replace(/\s*logo\s*/gi, '').replace(/Estate Agents?/gi, '').trim());
        }

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
            receptions,
            propertyType,
            description,
            image,
            agentName,
            priceCurrency: 'GBP',
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
    const maxPages = Math.ceil(resultsWanted / LISTINGS_PER_PAGE);

    const proxyConfiguration = await Actor.createProxyConfiguration({
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        countryCode: 'GB',
        ...input.proxyConfiguration,
    });

    log.info('Zoopla Scraper v3.0.0 (Optimized)', {
        resultsWanted,
        maxPages,
        mode: 'FAST',
    });

    const seen = new Set();
    let saved = 0;

    const targets = startUrls || [startUrl];
    const initialRequests = [];

    for (const target of targets) {
        for (let page = 1; page <= maxPages; page++) {
            initialRequests.push({
                url: buildSearchUrlForPage(target, page),
                userData: { page },
            });
        }
    }

    const camoufoxOptions = await camoufoxLaunchOptions({ headless: true, geoip: true });

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency: MAX_CONCURRENCY,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,
        navigationTimeoutSecs: 45,

        launchContext: {
            launcher: firefox,
            launchOptions: camoufoxOptions,
        },

        browserPoolOptions: {
            useFingerprints: false,
            maxOpenPagesPerBrowser: 1,
            retireBrowserAfterPageCount: 3,
        },

        // Block unnecessary resources for speed
        preNavigationHooks: [
            async ({ page }) => {
                // FAST: Minimal delay (just enough to not trigger rate limits)
                await sleep(1000 + Math.random() * 1000);

                // Block resources for speed
                await page.route('**/*', (route) => {
                    const request = route.request();
                    const resourceType = request.resourceType();
                    const url = request.url();

                    // Block heavy resources
                    if (BLOCKED_RESOURCES.includes(resourceType)) {
                        return route.abort();
                    }

                    // Block tracking/analytics
                    if (BLOCKED_URLS.some(blocked => url.includes(blocked))) {
                        return route.abort();
                    }

                    return route.continue();
                });
            },
        ],

        postNavigationHooks: [
            async ({ page }) => {
                // FAST: Minimal wait for DOM
                await page.waitForLoadState('domcontentloaded');

                // Quick scroll to trigger lazy loading
                await page.evaluate(() => {
                    window.scrollTo(0, 1000);
                    window.scrollTo(0, 2000);
                    window.scrollTo(0, 0);
                });

                // Short wait for content
                await sleep(500);
            },
        ],

        async requestHandler({ request, page }) {
            const { page: pageNum } = request.userData;

            if (saved >= resultsWanted) {
                log.debug(`Skipping page ${pageNum}`);
                return;
            }

            const pageContent = await page.content();

            // Cloudflare check
            if (pageContent.includes('Just a moment') || pageContent.includes('Verify you are human')) {
                log.warning(`Cloudflare on page ${pageNum}, waiting...`);
                await sleep(5000);
                await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });
            }

            log.info(`Page ${pageNum}/${maxPages}`);

            const html = await page.content();
            const listings = extractListingsFromHtml(html);

            log.info(`Found ${listings.length} listings`);

            if (!listings.length) return;

            // Batch push for speed
            const toSave = [];
            for (const listing of listings) {
                if (saved >= resultsWanted) break;

                const key = listing.listingId;
                if (!key || seen.has(key)) continue;
                seen.add(key);

                toSave.push({
                    ...listing,
                    priceValue: parsePriceValue(listing.price) || null,
                    scrapedAt: new Date().toISOString(),
                });
                saved++;
            }

            // Push all at once (faster than one by one)
            if (toSave.length) {
                await Dataset.pushData(toSave);
                log.info(`Saved ${saved}/${resultsWanted}`);
            }
        },

        async failedRequestHandler({ request, error }) {
            log.error(`Failed: ${request.url} - ${error.message}`);
        },
    });

    await crawler.run(initialRequests);

    log.info(`Done! ${saved} listings`);
    await Actor.setStatusMessage(`Scraped ${saved} listings`);

} catch (error) {
    log.error(error.message);
    throw error;
} finally {
    await Actor.exit();
}
